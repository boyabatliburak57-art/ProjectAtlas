import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Decimal,
  IndicatorBatchExecutor,
  type IndicatorCalculationResult,
  type IndicatorRegistry,
} from '@atlas/domain';
import { z } from 'zod';

import { INDICATOR_REGISTRY } from '../indicators/indicator-catalog.service';
import {
  MARKET_RATE_LIMITER,
  type MarketRateLimiter,
} from '../market/market-overview.ports';
import { SymbolResponseCache } from './symbol-detail.infrastructure';
import {
  SYMBOL_DETAIL_READER,
  type ChartAdjustmentMode,
  type CorporateActionView,
  type SymbolBarView,
  type SymbolDetailReader,
  type SymbolProfileView,
} from './symbol-detail.ports';

const TIMEFRAMES = ['5m', '15m', '1h', '1d', '1w'] as const;
const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');
const chartQuerySchema = z.object({
  timeframe: z.enum(TIMEFRAMES).default('1d'),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(2_000).default(500),
  adjustmentMode: z
    .enum(['raw', 'split-adjusted', 'total-return'])
    .default('raw'),
  overlays: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value.join(',') : value))
    .default(''),
  includePatterns: booleanQuery.default(false),
  includeCorporateActions: booleanQuery.default(false),
  includeUserMarkers: booleanQuery.default(false),
});
const symbolSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/)
  .transform((value) => value.toUpperCase());
const MAX_OVERLAYS = 6;
const MAX_PATTERN_MARKERS = 100;
const ADJUSTMENT_POLICY_VERSION = 'chart-adjustment-v1';
const PANEL_CODES = new Set([
  'RSI',
  'MACD',
  'STOCHASTIC',
  'STOCHASTIC_RSI',
  'CCI',
  'WILLIAMS_R',
  'ATR',
  'ADX',
  'OBV',
  'CMF',
  'MFI',
  'RELATIVE_VOLUME',
  'VOLUME_SMA',
]);

interface OverlaySpec {
  readonly code: string;
  readonly version: number;
  readonly parameters: Readonly<Record<string, unknown>>;
}

@Injectable()
export class SymbolDetailService {
  private readonly indicatorExecutor: IndicatorBatchExecutor;

  constructor(
    @Inject(SYMBOL_DETAIL_READER) private readonly reader: SymbolDetailReader,
    @Inject(INDICATOR_REGISTRY) private readonly registry: IndicatorRegistry,
    @Inject(MARKET_RATE_LIMITER) private readonly limiter: MarketRateLimiter,
    @Inject(SymbolResponseCache) private readonly cache: SymbolResponseCache,
  ) {
    const indicatorCache = new Map<string, IndicatorCalculationResult>();
    this.indicatorExecutor = new IndicatorBatchExecutor(this.registry, {
      cache: {
        get: (key) => Promise.resolve(indicatorCache.get(key) ?? null),
        set: (key, value) => {
          indicatorCache.set(key, value);
          return Promise.resolve();
        },
      },
      metrics: { increment: () => undefined },
    });
  }

  async profile(clientKey: string, rawSymbol: string) {
    this.consume(clientKey, 'symbol-profile');
    const profile = await this.requireProfile(rawSymbol);
    const quote = await this.quoteFor(profile.id);
    return {
      data: {
        ...profile,
        indexMemberships: [],
        quote: quote.data,
      },
      meta: {
        ...quote.meta,
        quality: {
          status: quote.data ? 'complete' : 'partial',
          warnings: ['INDEX_MEMBERSHIP_UNAVAILABLE'],
        },
      },
    };
  }

  async quote(clientKey: string, rawSymbol: string) {
    this.consume(clientKey, 'symbol-quote');
    const profile = await this.requireProfile(rawSymbol);
    const quote = await this.quoteFor(profile.id);
    return {
      data: { instrumentId: profile.id, symbol: profile.symbol, ...quote.data },
      meta: quote.meta,
    };
  }

  async chart(
    clientKey: string,
    rawSymbol: string,
    rawQuery: unknown,
    userId: string | null,
  ) {
    this.consume(clientKey, 'symbol-chart');
    const profile = await this.requireProfile(rawSymbol);
    const query = parseChartQuery(rawQuery);
    if (query.includeUserMarkers && !userId)
      throw new BadRequestException({
        code: 'CHART_USER_CONTEXT_REQUIRED',
        message: 'Authenticated user context is required for user markers',
      });
    const overlaySpecs = this.parseOverlays(query.overlays);
    const { from, to } = chartRange(
      query.timeframe,
      query.limit,
      query.from,
      query.to,
    );
    const bars = await this.reader.bars({
      instrumentId: profile.id,
      timeframe: query.timeframe,
      from,
      to,
      limit: query.limit,
    });
    if (bars.length === 0)
      throw new NotFoundException({
        code: 'MARKET_DATA_NOT_AVAILABLE',
        message: 'Chart data is not available',
      });
    assertBarAxis(bars);
    const actions =
      query.adjustmentMode === 'raw' && !query.includeCorporateActions
        ? []
        : await this.reader.corporateActions({
            instrumentId: profile.id,
            from,
            to,
          });
    const adjusted = adjustBars(bars, actions, query.adjustmentMode);
    const cutoff = dataCutoff(adjusted.bars);
    const patterns = query.includePatterns
      ? await this.reader.patterns({
          instrumentId: profile.id,
          timeframe: query.timeframe,
          adjustmentMode: query.adjustmentMode,
          from,
          to,
          limit: MAX_PATTERN_MARKERS,
        })
      : [];
    const cacheKey = hash({
      instrumentId: profile.id,
      timeframe: query.timeframe,
      from: from.toISOString(),
      to: to.toISOString(),
      limit: query.limit,
      adjustmentMode: query.adjustmentMode,
      adjustmentPolicyVersion: ADJUSTMENT_POLICY_VERSION,
      dataCutoffAt: cutoff.toISOString(),
      overlays: overlaySpecs,
      includePatterns: query.includePatterns,
      includeCorporateActions: query.includeCorporateActions,
      corporateActionVersion: hash(
        actions.map((action) => ({
          eventKey: action.eventKey,
          type: action.type,
          effectiveAt: action.effectiveAt.toISOString(),
          factor: action.factor,
          cashAmount: action.cashAmount,
        })),
      ),
      patternVersion: hash(
        patterns.map((pattern) => ({
          id: pattern.id,
          version: pattern.version,
          algorithmVersion: pattern.algorithmVersion,
          state: pattern.state,
          dataCutoffAt: pattern.dataCutoffAt.toISOString(),
        })),
      ),
      markerUserId: query.includeUserMarkers ? userId : null,
    });
    const cached = this.cache.get<{
      data: unknown;
      meta: Record<string, unknown>;
    }>(cacheKey);
    if (cached) return { ...cached, meta: { ...cached.meta, cache: 'hit' } };

    const indicatorSections = await this.indicators(
      profile.id,
      query.timeframe,
      query.adjustmentMode,
      cutoff,
      adjusted.bars,
      overlaySpecs,
      query.overlays
        .toLowerCase()
        .split(',')
        .map((value) => value.trim())
        .includes('volume'),
    );
    const userMarkers = query.includeUserMarkers
      ? await this.reader.userMarkers({
          userId: userId!,
          instrumentId: profile.id,
          from,
          to,
        })
      : [];
    const axis = adjusted.bars.map((bar) => bar.openTime);
    const markers = deduplicateMarkers([
      ...(query.includeCorporateActions
        ? actions.map((action) => ({
            time: alignTime(action.effectiveAt, axis),
            type: 'corporateAction',
            label: action.type,
            sourceType: action.sourceType,
            metadataVersion: 1,
          }))
        : []),
      ...patterns.map((pattern) => ({
        time: alignTime(pattern.endTime, axis),
        type: 'pattern',
        label: `${pattern.code}:${pattern.state}`,
        sourceType: 'pattern',
        metadataVersion: pattern.evidenceVersion,
      })),
      ...userMarkers.map((marker) => ({
        time: alignTime(marker.time, axis),
        type: marker.type,
        label: marker.label,
        sourceType: marker.sourceType,
        sourceId: marker.sourceId,
        metadataVersion: 1,
      })),
    ]);
    const result = {
      data: {
        instrument: pickInstrument(profile),
        timeframe: query.timeframe,
        adjustmentMode: query.adjustmentMode,
        bars: adjusted.bars.map(mapBar),
        overlays: indicatorSections.overlays,
        panels: indicatorSections.panels,
        markers: markers.map((marker) => ({
          ...marker,
          time: unix(marker.time),
        })),
        warnings: [...adjusted.warnings, ...indicatorSections.warnings],
      },
      meta: {
        dataCutoffAt: cutoff.toISOString(),
        adjustmentMode: query.adjustmentMode,
        adjustmentPolicyVersion: ADJUSTMENT_POLICY_VERSION,
        barCount: adjusted.bars.length,
        indicatorVersions: indicatorSections.versions,
        openBarIncluded: adjusted.bars.some((bar) => !bar.isClosed),
        cache: 'miss',
      },
    };
    assertPublicFinite(result);
    this.cache.set(cacheKey, result);
    return result;
  }

  async signals(clientKey: string, rawSymbol: string, userId: string | null) {
    this.consume(clientKey, 'symbol-signals');
    const profile = await this.requireProfile(rawSymbol);
    const quote = await this.quoteFor(profile.id);
    const cutoff = quote.meta.dataCutoffAt
      ? new Date(String(quote.meta.dataCutoffAt))
      : new Date();
    const patterns = await this.reader.patterns({
      instrumentId: profile.id,
      timeframe: '1d',
      adjustmentMode: 'raw',
      from: new Date(cutoff.getTime() - 365 * 86_400_000),
      to: cutoff,
      limit: 20,
    });
    return {
      data: {
        symbol: profile.symbol,
        signals: patterns.map((pattern) => ({
          type: 'pattern',
          code: pattern.code,
          version: pattern.version,
          state: pattern.state,
          direction: pattern.direction,
          detectedAt: pattern.detectedAt.toISOString(),
          disclaimer: 'Not investment advice',
        })),
        activeAlertCount: userId
          ? await this.reader.activeAlertCount(userId, profile.id)
          : null,
      },
      meta: { ...quote.meta, quality: quote.meta.quality },
    };
  }

  async corporateActions(clientKey: string, rawSymbol: string) {
    this.consume(clientKey, 'symbol-corporate-actions');
    const profile = await this.requireProfile(rawSymbol);
    const from = new Date('1900-01-01T00:00:00.000Z');
    const to = new Date('2100-01-01T00:00:00.000Z');
    const actions = await this.reader.corporateActions({
      instrumentId: profile.id,
      from,
      to,
    });
    return {
      data: {
        symbol: profile.symbol,
        items: actions.map((action) => ({
          eventKey: action.eventKey,
          type: action.type,
          effectiveAt: action.effectiveAt.toISOString(),
          factor: action.factor,
          cashAmount: action.cashAmount,
          sourceType: action.sourceType,
        })),
      },
      meta: { count: actions.length },
    };
  }

  private async quoteFor(instrumentId: string) {
    const bars = await this.reader.bars({
      instrumentId,
      timeframe: '1d',
      from: new Date(Date.now() - 30 * 86_400_000),
      to: new Date(),
      limit: 2,
    });
    const latest = bars.at(-1);
    const previous = bars.length > 1 ? bars.at(-2) : undefined;
    if (!latest)
      return {
        data: null,
        meta: {
          dataCutoffAt: null,
          stale: false,
          partial: true,
          quality: { status: 'missing', warnings: ['QUOTE_NOT_AVAILABLE'] },
        },
      };
    const change = previous
      ? Decimal.parse(latest.close).minus(Decimal.parse(previous.close))
      : null;
    const percent =
      change && previous && !Decimal.parse(previous.close).isZero()
        ? change
            .dividedBy(Decimal.parse(previous.close))
            .times(Decimal.parse('100'))
        : null;
    const cutoff = latest.sourceTimestamp ?? latest.closeTime;
    return {
      data: {
        lastPrice: latest.close,
        dailyChange: change?.toString() ?? null,
        dailyChangePercent: percent?.toString() ?? null,
        dayHigh: latest.high,
        dayLow: latest.low,
        volume: latest.volume,
        isClosed: latest.isClosed,
      },
      meta: {
        dataCutoffAt: cutoff.toISOString(),
        sourceTimestamp: latest.sourceTimestamp?.toISOString() ?? null,
        stale: false,
        partial: previous === undefined,
        quality: { status: latest.qualityStatus, warnings: [] },
      },
    };
  }

  private async requireProfile(rawSymbol: string) {
    const parsed = symbolSchema.safeParse(rawSymbol);
    if (!parsed.success)
      throw new BadRequestException({
        code: 'SYMBOL_INVALID',
        message: 'Invalid symbol',
      });
    const profile = await this.reader.profile(parsed.data);
    if (!profile)
      throw new NotFoundException({
        code: 'SYMBOL_NOT_FOUND',
        message: 'Symbol was not found',
      });
    return profile;
  }

  private parseOverlays(value: string): readonly OverlaySpec[] {
    const tokens = value
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => token.toLowerCase() !== 'volume');
    if (tokens.length > MAX_OVERLAYS)
      throw new BadRequestException({
        code: 'CHART_OVERLAY_LIMIT_EXCEEDED',
        message: `At most ${MAX_OVERLAYS} indicator overlays are supported`,
      });
    return tokens.map((token) => parseOverlay(token, this.registry));
  }

  private async indicators(
    instrumentId: string,
    timeframe: (typeof TIMEFRAMES)[number],
    adjustmentMode: ChartAdjustmentMode,
    cutoff: Date,
    bars: readonly SymbolBarView[],
    specs: readonly OverlaySpec[],
    includeVolume: boolean,
  ) {
    const input = {
      instrumentId,
      timeframe,
      adjustmentMode,
      dataCutoffAt: cutoff,
      bars: bars.map((bar) => ({
        timestamp: bar.openTime,
        open: finiteNumber(bar.open),
        high: finiteNumber(bar.high),
        low: finiteNumber(bar.low),
        close: finiteNumber(bar.close),
        volume: finiteNumber(bar.volume),
        isClosed: bar.isClosed,
      })),
    } as const;
    const report = await this.indicatorExecutor.execute(
      specs.map((spec, index) => ({
        requestId: `chart-${index}`,
        indicatorCode: spec.code,
        indicatorVersion: spec.version,
        parameters: spec.parameters,
        input,
        closedBarPolicy: 'include-open' as const,
      })),
    );
    const overlays: Record<string, unknown>[] = [];
    const panels: Record<string, unknown>[] = [];
    const warnings: string[] = [];
    const versions: {
      code: string;
      version: number;
      parameters: Readonly<Record<string, unknown>>;
    }[] = [];
    if (includeVolume) {
      panels.push({
        id: 'volume',
        indicatorCode: 'VOLUME',
        indicatorVersion: 1,
        parameters: {},
        outputName: 'volume',
        panel: 'volume',
        points: bars.map((bar) => ({
          time: unix(bar.openTime),
          value: bar.volume,
        })),
      });
      versions.push({ code: 'VOLUME', version: 1, parameters: {} });
    }
    report.results.forEach((item, index) => {
      const spec = specs[index];
      if (!spec) return;
      if (item.status === 'failure') {
        warnings.push(`${item.error.code}:${spec.code}`);
        return;
      }
      versions.push({
        code: spec.code,
        version: spec.version,
        parameters: spec.parameters,
      });
      const output = item.result.output;
      const target = PANEL_CODES.has(spec.code) ? panels : overlays;
      const entries =
        output.kind === 'scalar'
          ? [['value', output.values] as const]
          : Object.entries(output.outputs);
      for (const [outputName, values] of entries) {
        target.push({
          id: `${spec.code.toLowerCase()}-${spec.version}-${outputName}`,
          indicatorCode: spec.code,
          indicatorVersion: spec.version,
          parameters: spec.parameters,
          outputName,
          panel: PANEL_CODES.has(spec.code) ? spec.code.toLowerCase() : 'price',
          points: values.flatMap((value, pointIndex) =>
            value === null
              ? []
              : [
                  {
                    time: unix(bars[pointIndex]!.openTime),
                    value: finiteString(value),
                  },
                ],
          ),
        });
      }
    });
    return { overlays, panels, warnings, versions };
  }

  private consume(clientKey: string, operation: string) {
    this.limiter.consume({ clientKey, operation, now: new Date() });
  }
}

function parseChartQuery(value: unknown) {
  const result = chartQuerySchema.safeParse(value);
  if (result.success) return result.data;
  throw new BadRequestException({
    code: 'CHART_RANGE_INVALID',
    message: 'Invalid chart query',
    details: result.error.issues,
  });
}

function chartRange(
  timeframe: (typeof TIMEFRAMES)[number],
  limit: number,
  rawFrom?: string,
  rawTo?: string,
) {
  const to = rawTo ? validDate(rawTo) : new Date();
  const unit = timeframeMs(timeframe);
  const from = rawFrom
    ? validDate(rawFrom)
    : new Date(to.getTime() - unit * limit);
  const maximum = maxRangeMs(timeframe);
  if (from >= to || to.getTime() - from.getTime() > maximum)
    throw new BadRequestException({
      code: 'CHART_RANGE_INVALID',
      message: 'Chart range is invalid or exceeds the timeframe limit',
    });
  return { from, to };
}

function validDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new BadRequestException({
      code: 'CHART_RANGE_INVALID',
      message: 'Invalid chart date',
    });
  return date;
}

function timeframeMs(timeframe: (typeof TIMEFRAMES)[number]) {
  return {
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '1d': 86_400_000,
    '1w': 604_800_000,
  }[timeframe];
}

function maxRangeMs(timeframe: (typeof TIMEFRAMES)[number]) {
  return {
    '5m': 31 * 86_400_000,
    '15m': 90 * 86_400_000,
    '1h': 366 * 86_400_000,
    '1d': 10 * 365 * 86_400_000,
    '1w': 20 * 365 * 86_400_000,
  }[timeframe];
}

function parseOverlay(token: string, registry: IndicatorRegistry): OverlaySpec {
  const match = /^([A-Za-z_]+)(?:@(\d+))?(?:\((.*)\))?$/.exec(token);
  if (!match)
    throw new UnprocessableEntityException({
      code: 'INDICATOR_PARAMETERS_INVALID',
      message: `Invalid overlay: ${token}`,
    });
  const alias = match[1]!.toUpperCase();
  const code = alias === 'BBANDS' ? 'BOLLINGER_BANDS' : alias;
  const version = match[2] ? Number(match[2]) : 1;
  try {
    const rawParameters = Object.fromEntries(
      (match[3] ?? '')
        .split(';')
        .filter(Boolean)
        .map((part) => {
          const [key, raw] = part.split('=');
          if (!key || raw === undefined) throw new Error('invalid parameter');
          const number = Number(raw);
          return [
            key,
            Number.isFinite(number) && raw.trim() !== '' ? number : raw,
          ];
        }),
    );
    const definition = registry.resolve(code, version);
    const parameters = definition.parseParameters(rawParameters) as Readonly<
      Record<string, unknown>
    >;
    return { code, version, parameters };
  } catch (error) {
    const codeValue = isErrorCode(error)
      ? error.code
      : 'INDICATOR_PARAMETERS_INVALID';
    throw new UnprocessableEntityException({
      code: codeValue,
      message: `Overlay could not be resolved: ${token}`,
    });
  }
}

function adjustBars(
  bars: readonly SymbolBarView[],
  actions: readonly CorporateActionView[],
  mode: ChartAdjustmentMode,
) {
  if (mode === 'raw') return { bars, warnings: [] as string[] };
  const warnings: string[] = [];
  if (
    mode === 'total-return' &&
    actions.some((action) => action.type === 'dividend')
  )
    warnings.push('TOTAL_RETURN_DIVIDEND_PER_SHARE_UNAVAILABLE');
  if (actions.some((action) => action.type === 'bonusShare'))
    warnings.push('BONUS_SHARE_ADJUSTMENT_FACTOR_UNAVAILABLE');
  return {
    bars: bars.map((bar) => {
      const factors = actions.filter(
        (action) =>
          action.type === 'split' &&
          action.factor !== null &&
          action.effectiveAt.getTime() > bar.openTime.getTime(),
      );
      const factor = factors.reduce(
        (current, action) => current.times(Decimal.parse(action.factor!)),
        Decimal.parse('1'),
      );
      if (factor.compare(Decimal.parse('1')) === 0) return bar;
      return {
        ...bar,
        open: Decimal.parse(bar.open).dividedBy(factor).toString(),
        high: Decimal.parse(bar.high).dividedBy(factor).toString(),
        low: Decimal.parse(bar.low).dividedBy(factor).toString(),
        close: Decimal.parse(bar.close).dividedBy(factor).toString(),
        volume: Decimal.parse(bar.volume).times(factor).toString(),
      };
    }),
    warnings,
  };
}

function assertBarAxis(bars: readonly SymbolBarView[]) {
  let previous = Number.NEGATIVE_INFINITY;
  for (const bar of bars) {
    const current = bar.openTime.getTime();
    if (current <= previous)
      throw new UnprocessableEntityException({
        code: 'CHART_DATA_INVALID',
        message: 'Chart bar timestamps must be ascending and unique',
      });
    previous = current;
  }
}

function dataCutoff(bars: readonly SymbolBarView[]) {
  const last = bars.at(-1)!;
  return last.sourceTimestamp ?? last.closeTime;
}

function mapBar(bar: SymbolBarView) {
  return {
    time: unix(bar.openTime),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    isClosed: bar.isClosed,
  };
}

function unix(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

function alignTime(value: Date, axis: readonly Date[]) {
  return axis.find((time) => time.getTime() >= value.getTime()) ?? axis.at(-1)!;
}

function deduplicateMarkers<
  T extends { time: Date; type: string; sourceType: string; label: string },
>(markers: readonly T[]) {
  return [
    ...new Map(
      markers.map((marker) => [
        `${marker.time.toISOString()}:${marker.type}:${marker.sourceType}:${marker.label}`,
        marker,
      ]),
    ).values(),
  ].sort((left, right) => left.time.getTime() - right.time.getTime());
}

function finiteNumber(value: string) {
  const result = Number(value);
  if (!Number.isFinite(result))
    throw new UnprocessableEntityException({
      code: 'CHART_DATA_INVALID',
      message: 'Chart contains a non-finite value',
    });
  return result;
}

function finiteString(value: number) {
  if (!Number.isFinite(value))
    throw new UnprocessableEntityException({
      code: 'INDICATOR_OUTPUT_INVALID',
      message: 'Indicator contains a non-finite value',
    });
  return String(value);
}

function assertPublicFinite(value: unknown) {
  const serialized = JSON.stringify(value);
  if (/NaN|Infinity/.test(serialized))
    throw new UnprocessableEntityException({
      code: 'CHART_DATA_INVALID',
      message: 'Public chart output contains a non-finite value',
    });
}

function pickInstrument(profile: SymbolProfileView) {
  return { id: profile.id, symbol: profile.symbol, name: profile.name };
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isErrorCode(value: unknown): value is { readonly code: string } {
  return typeof value === 'object' && value !== null && 'code' in value;
}
