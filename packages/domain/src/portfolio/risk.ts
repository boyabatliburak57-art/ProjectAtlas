import type { DailyPortfolioValue } from './performance.js';
import { Decimal, parseLedgerDecimal } from './decimal.js';

export const RISK_POLICY = {
  methodologyVersion: 'historical-risk-v1',
  returnConvention: 'simple-daily-beginning-of-day-flow-adjusted',
  annualizationFactor: 252,
  alignment: 'exact-date-intersection-no-forward-fill',
  quantile: 'lower-tail-nearest-rank',
  minimumVolatilityObservations: 20,
  minimumMarketObservations: 20,
  minimumVarObservations: 100,
  staleInputAfterMilliseconds: 4 * 24 * 60 * 60 * 1000,
} as const;

export type RiskReasonCode =
  | 'INSUFFICIENT_OBSERVATIONS'
  | 'INVALID_INPUT'
  | 'ZERO_BENCHMARK_VARIANCE'
  | 'ZERO_SERIES_VARIANCE'
  | 'NO_DOWNSIDE_OBSERVATIONS'
  | 'NON_POSITIVE_VALUE'
  | 'STALE_INPUT';

export interface RiskMetric<T> {
  readonly value: T | null;
  readonly status: 'complete' | 'notEvaluable';
  readonly reasonCode: RiskReasonCode | null;
  readonly observationCount: number;
  readonly methodologyVersion: string;
  readonly warnings: readonly string[];
}

export interface DatedReturn {
  readonly date: string;
  readonly value: number;
}

export interface ReturnSeriesResult {
  readonly returns: readonly DatedReturn[];
  readonly status: 'complete' | 'notEvaluable';
  readonly reasonCode: RiskReasonCode | null;
  readonly observationCount: number;
  readonly methodologyVersion: string;
  readonly warnings: readonly string[];
}

export function buildReturnSeries(
  series: readonly DailyPortfolioValue[],
  methodologyVersion = RISK_POLICY.methodologyVersion,
): ReturnSeriesResult {
  try {
    const ordered = [...series].sort((left, right) =>
      left.date.localeCompare(right.date),
    );
    const returns: DatedReturn[] = [];
    const seen = new Set<string>();
    for (const point of ordered) {
      if (seen.has(point.date))
        return returnFailure('INVALID_INPUT', methodologyVersion);
      seen.add(point.date);
      finiteNumber(point.value);
      finiteNumber(point.externalFlow);
    }
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (!previous || !current) continue;
      const previousValue = finiteNumber(previous.value);
      const currentValue = finiteNumber(current.value);
      const flow = finiteNumber(current.externalFlow);
      const capital = previousValue + flow;
      if (capital <= 0 || currentValue < 0)
        return returnFailure('NON_POSITIVE_VALUE', methodologyVersion);
      const value = currentValue / capital - 1;
      if (!Number.isFinite(value))
        return returnFailure('INVALID_INPUT', methodologyVersion);
      returns.push({ date: current.date, value });
    }
    return {
      returns,
      status: 'complete',
      reasonCode: null,
      observationCount: returns.length,
      methodologyVersion,
      warnings: [],
    };
  } catch {
    return returnFailure('INVALID_INPUT', methodologyVersion);
  }
}

export function alignReturnSeries(
  portfolio: readonly DatedReturn[],
  benchmark: readonly DatedReturn[],
) {
  const benchmarkByDate = new Map(
    benchmark.map((point) => [point.date, point.value] as const),
  );
  const portfolioByDate = new Map(
    portfolio.map((point) => [point.date, point.value] as const),
  );
  const dates = [...portfolioByDate.keys()]
    .filter((date) => benchmarkByDate.has(date))
    .sort();
  const missingPortfolioDates = [...benchmarkByDate.keys()]
    .filter((date) => !portfolioByDate.has(date))
    .sort();
  const missingBenchmarkDates = [...portfolioByDate.keys()]
    .filter((date) => !benchmarkByDate.has(date))
    .sort();
  return {
    dates,
    portfolio: dates.map((date) => portfolioByDate.get(date)!),
    benchmark: dates.map((date) => benchmarkByDate.get(date)!),
    observationCount: dates.length,
    warnings: [
      ...(missingPortfolioDates.length ? ['MISSING_PORTFOLIO_DATES'] : []),
      ...(missingBenchmarkDates.length ? ['MISSING_BENCHMARK_DATES'] : []),
    ],
    missingPortfolioDates,
    missingBenchmarkDates,
  };
}

export function annualizedVolatility(
  returns: readonly number[],
  policy: {
    readonly methodologyVersion: string;
    readonly annualizationFactor: number;
    readonly minimumObservations: number;
  } = {
    methodologyVersion: RISK_POLICY.methodologyVersion,
    annualizationFactor: RISK_POLICY.annualizationFactor,
    minimumObservations: RISK_POLICY.minimumVolatilityObservations,
  },
): RiskMetric<string> {
  const checked = validateReturns(
    returns,
    policy.minimumObservations,
    policy.methodologyVersion,
  );
  if (checked) return checked;
  return completeMetric(
    formatRatio(
      sampleStandardDeviation(returns) * Math.sqrt(policy.annualizationFactor),
    ),
    returns.length,
    policy.methodologyVersion,
  );
}

export function beta(
  portfolio: readonly number[],
  benchmark: readonly number[],
  minimumObservations: number = RISK_POLICY.minimumMarketObservations,
): RiskMetric<string> {
  const invalid = validatePair(portfolio, benchmark, minimumObservations);
  if (invalid) return invalid;
  const benchmarkVariance = sampleVariance(benchmark);
  if (benchmarkVariance === 0)
    return failedMetric('ZERO_BENCHMARK_VARIANCE', portfolio.length);
  return completeMetric(
    formatRatio(sampleCovariance(portfolio, benchmark) / benchmarkVariance),
    portfolio.length,
  );
}

export function correlation(
  portfolio: readonly number[],
  benchmark: readonly number[],
  minimumObservations: number = RISK_POLICY.minimumMarketObservations,
): RiskMetric<string> {
  const invalid = validatePair(portfolio, benchmark, minimumObservations);
  if (invalid) return invalid;
  const denominator =
    sampleStandardDeviation(portfolio) * sampleStandardDeviation(benchmark);
  if (denominator === 0)
    return failedMetric('ZERO_SERIES_VARIANCE', portfolio.length);
  return completeMetric(
    formatRatio(sampleCovariance(portfolio, benchmark) / denominator),
    portfolio.length,
  );
}

export interface DrawdownResult {
  readonly maximumDrawdown: string;
  readonly currentDrawdown: string;
  readonly peakDate: string;
  readonly troughDate: string;
  readonly recoveryDate: string | null;
}

export function maximumDrawdown(
  series: readonly { readonly date: string; readonly value: string }[],
): RiskMetric<DrawdownResult> {
  try {
    const ordered = [...series].sort((left, right) =>
      left.date.localeCompare(right.date),
    );
    if (ordered.length < 2)
      return failedMetric('INSUFFICIENT_OBSERVATIONS', ordered.length);
    let peakValue = finiteNumber(ordered[0]?.value ?? '0');
    if (peakValue <= 0)
      return failedMetric('NON_POSITIVE_VALUE', ordered.length);
    let runningPeakDate = ordered[0]?.date ?? '';
    let maximum = 0;
    let maximumPeakDate = runningPeakDate;
    let troughDate = runningPeakDate;
    let recoveryDate: string | null = null;
    let maximumPeakValue = peakValue;
    for (const point of ordered.slice(1)) {
      const value = finiteNumber(point.value);
      if (value <= 0) return failedMetric('NON_POSITIVE_VALUE', ordered.length);
      if (value > peakValue) {
        peakValue = value;
        runningPeakDate = point.date;
      }
      const drawdown = value / peakValue - 1;
      if (drawdown < maximum) {
        maximum = drawdown;
        maximumPeakDate = runningPeakDate;
        maximumPeakValue = peakValue;
        troughDate = point.date;
        recoveryDate = null;
      } else if (
        recoveryDate === null &&
        point.date > troughDate &&
        value >= maximumPeakValue
      ) {
        recoveryDate = point.date;
      }
    }
    const last = finiteNumber(ordered.at(-1)?.value ?? '0');
    return completeMetric(
      {
        maximumDrawdown: formatRatio(maximum),
        currentDrawdown: formatRatio(last / peakValue - 1),
        peakDate: maximumPeakDate,
        troughDate,
        recoveryDate,
      },
      ordered.length,
    );
  } catch {
    return failedMetric('INVALID_INPUT', series.length);
  }
}

export function historicalVar(
  returns: readonly number[],
  confidence: 0.95 | 0.99,
  minimumObservations = RISK_POLICY.minimumVarObservations,
): RiskMetric<string> {
  const invalid = validateReturns(
    returns,
    minimumObservations,
    RISK_POLICY.methodologyVersion,
  );
  if (invalid) return invalid;
  const sorted = [...returns].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((1 - confidence) * sorted.length - 1e-12) - 1,
  );
  const quantile = sorted[index];
  if (quantile === undefined)
    return failedMetric('INSUFFICIENT_OBSERVATIONS', returns.length);
  return completeMetric(
    formatRatio(Math.max(0, -quantile)),
    returns.length,
    RISK_POLICY.methodologyVersion,
    ['HISTORICAL_VAR_IS_NOT_A_FORECAST'],
  );
}

export function expectedShortfall(
  returns: readonly number[],
  confidence: 0.95 = 0.95,
  minimumObservations = RISK_POLICY.minimumVarObservations,
): RiskMetric<string> {
  const invalid = validateReturns(
    returns,
    minimumObservations,
    RISK_POLICY.methodologyVersion,
  );
  if (invalid) return invalid;
  const sorted = [...returns].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.ceil((1 - confidence) * sorted.length - 1e-12) - 1,
  );
  const quantile = sorted[index];
  if (quantile === undefined)
    return failedMetric('INSUFFICIENT_OBSERVATIONS', returns.length);
  const tail = sorted.filter((value) => value <= quantile);
  if (tail.length === 0)
    return failedMetric('NO_DOWNSIDE_OBSERVATIONS', returns.length);
  return completeMetric(
    formatRatio(Math.max(0, -mean(tail))),
    returns.length,
    RISK_POLICY.methodologyVersion,
    ['HISTORICAL_ES_IS_NOT_A_FORECAST'],
  );
}

export interface PositionExposureInput {
  readonly instrumentId: string;
  readonly marketValue: string;
  readonly sectorId: string | null;
}

export interface RiskExposure {
  readonly type: 'instrument' | 'sector' | 'cash';
  readonly key: string;
  readonly weight: string;
  readonly marketValue: string;
  readonly rank: number | null;
}

export interface ConcentrationResult {
  readonly largestPositionWeight: string;
  readonly top3Weight: string;
  readonly top5Weight: string;
  readonly hhi: string;
  readonly cashWeight: string;
  readonly unknownSectorWeight: string;
  readonly exposures: readonly RiskExposure[];
}

export function concentrationRisk(
  positions: readonly PositionExposureInput[],
  cashValue: string,
): RiskMetric<ConcentrationResult> {
  try {
    const normalized = positions.map((position) => ({
      ...position,
      decimalValue: parseLedgerDecimal(position.marketValue, 'marketValue', {
        nonNegative: true,
      }),
    }));
    const cash = parseLedgerDecimal(cashValue, 'cashValue', {
      nonNegative: true,
    });
    const total = normalized.reduce(
      (sum, position) => sum.plus(position.decimalValue),
      cash,
    );
    if (total.isZero())
      return failedMetric('NON_POSITIVE_VALUE', positions.length);
    const ranked = [...normalized].sort(
      (left, right) =>
        right.decimalValue.compare(left.decimalValue) ||
        left.instrumentId.localeCompare(right.instrumentId),
    );
    const instruments = ranked.map((position, index) => ({
      type: 'instrument' as const,
      key: position.instrumentId,
      weight: decimalRatio(position.decimalValue, total),
      marketValue: position.decimalValue.toDatabaseString('marketValue'),
      rank: index + 1,
    }));
    const sectorValues = new Map<string, Decimal>();
    for (const position of normalized)
      sectorValues.set(
        position.sectorId ?? 'UNKNOWN',
        (sectorValues.get(position.sectorId ?? 'UNKNOWN') ?? Decimal.ZERO).plus(
          position.decimalValue,
        ),
      );
    const sectors = [...sectorValues.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({
        type: 'sector' as const,
        key,
        weight: decimalRatio(value, total),
        marketValue: value.toDatabaseString('sectorMarketValue'),
        rank: null,
      }));
    const weights = [
      ...instruments.map((position) => position.weight),
      decimalRatio(cash, total),
    ];
    const top = (count: number) =>
      instruments
        .slice(0, count)
        .reduce((sum, position) => sum + position.weight, 0);
    const exposures: RiskExposure[] = [
      ...instruments.map((item) => ({
        ...item,
        weight: formatRatio(item.weight),
      })),
      ...sectors.map((item) => ({ ...item, weight: formatRatio(item.weight) })),
      {
        type: 'cash',
        key: 'CASH_TRY',
        weight: formatRatio(decimalRatio(cash, total)),
        marketValue: cash.toDatabaseString('cashMarketValue'),
        rank: null,
      },
    ];
    return completeMetric(
      {
        largestPositionWeight: formatRatio(instruments[0]?.weight ?? 0),
        top3Weight: formatRatio(top(3)),
        top5Weight: formatRatio(top(5)),
        hhi: formatRatio(
          weights.reduce((sum, weight) => sum + weight * weight, 0),
        ),
        cashWeight: formatRatio(decimalRatio(cash, total)),
        unknownSectorWeight: formatRatio(
          decimalRatio(sectorValues.get('UNKNOWN') ?? Decimal.ZERO, total),
        ),
        exposures,
      },
      positions.length,
    );
  } catch {
    return failedMetric('INVALID_INPUT', positions.length);
  }
}

export interface PortfolioRiskSnapshot {
  readonly portfolioId: string;
  readonly ledgerVersion: number;
  readonly valuationSeriesVersion: number;
  readonly rangeStartAt: Date;
  readonly rangeEndAt: Date;
  readonly dataCutoffAt: Date;
  readonly benchmarkCode: string;
  readonly riskPolicyVersion: string;
  readonly status: 'complete' | 'partial' | 'notEvaluable';
  readonly observationCount: number;
  readonly volatility: RiskMetric<string>;
  readonly beta: RiskMetric<string>;
  readonly correlation: RiskMetric<string>;
  readonly drawdown: RiskMetric<DrawdownResult>;
  readonly historicalVar95: RiskMetric<string>;
  readonly historicalVar99: RiskMetric<string>;
  readonly expectedShortfall95: RiskMetric<string>;
  readonly concentration: RiskMetric<ConcentrationResult>;
  readonly cacheKey: string;
  readonly warnings: readonly string[];
}

export interface RiskSnapshotRepository {
  find(cacheKey: string): Promise<PortfolioRiskSnapshot | null>;
  save(snapshot: PortfolioRiskSnapshot): Promise<PortfolioRiskSnapshot>;
  invalidatePortfolio(
    portfolioId: string,
    currentLedgerVersion: number,
  ): Promise<number>;
}

export interface RiskLoggerPort {
  info(event: string, fields: Readonly<Record<string, unknown>>): void;
}

export class PortfolioRiskApplicationService {
  constructor(
    private readonly dependencies: {
      readonly repository?: RiskSnapshotRepository;
      readonly logger: RiskLoggerPort;
    },
  ) {}

  async calculate(input: {
    readonly portfolioId: string;
    readonly ledgerVersion: number;
    readonly valuationSeriesVersion: number;
    readonly rangeStartAt: Date;
    readonly rangeEndAt: Date;
    readonly dataCutoffAt: Date;
    readonly benchmarkCode: string;
    readonly portfolioValues: readonly DailyPortfolioValue[];
    readonly benchmarkValues: readonly DailyPortfolioValue[];
    readonly positions: readonly PositionExposureInput[];
    readonly cashValue: string;
    readonly inputUpdatedAt?: Date | undefined;
  }): Promise<PortfolioRiskSnapshot> {
    const cacheKey = riskCacheKey({
      ...input,
      riskPolicyVersion: RISK_POLICY.methodologyVersion,
    });
    const cached = await this.dependencies.repository?.find(cacheKey);
    if (cached) {
      this.dependencies.logger.info('portfolio.risk.cache_hit', {
        portfolioId: input.portfolioId,
        ledgerVersion: input.ledgerVersion,
      });
      return cached;
    }
    const portfolioReturns = buildReturnSeries(input.portfolioValues);
    const benchmarkReturns = buildReturnSeries(input.benchmarkValues);
    const aligned = alignReturnSeries(
      portfolioReturns.returns,
      benchmarkReturns.returns,
    );
    const values = portfolioReturns.returns.map((point) => point.value);
    const stale =
      input.inputUpdatedAt !== undefined &&
      input.dataCutoffAt.getTime() - input.inputUpdatedAt.getTime() >
        RISK_POLICY.staleInputAfterMilliseconds;
    const staleWarnings = stale ? ['STALE_INPUT'] : [];
    const metrics = {
      volatility: withWarnings(annualizedVolatility(values), staleWarnings),
      beta: withWarnings(beta(aligned.portfolio, aligned.benchmark), [
        ...aligned.warnings,
        ...staleWarnings,
      ]),
      correlation: withWarnings(
        correlation(aligned.portfolio, aligned.benchmark),
        [...aligned.warnings, ...staleWarnings],
      ),
      drawdown: withWarnings(
        maximumDrawdown(input.portfolioValues),
        staleWarnings,
      ),
      historicalVar95: withWarnings(historicalVar(values, 0.95), staleWarnings),
      historicalVar99: withWarnings(historicalVar(values, 0.99), staleWarnings),
      expectedShortfall95: withWarnings(
        expectedShortfall(values),
        staleWarnings,
      ),
      concentration: concentrationRisk(input.positions, input.cashValue),
    };
    const statuses = Object.values(metrics).map((metric) => metric.status);
    const completeCount = statuses.filter(
      (status) => status === 'complete',
    ).length;
    const snapshot: PortfolioRiskSnapshot = {
      portfolioId: input.portfolioId,
      ledgerVersion: input.ledgerVersion,
      valuationSeriesVersion: input.valuationSeriesVersion,
      rangeStartAt: input.rangeStartAt,
      rangeEndAt: input.rangeEndAt,
      dataCutoffAt: input.dataCutoffAt,
      benchmarkCode: input.benchmarkCode,
      riskPolicyVersion: RISK_POLICY.methodologyVersion,
      status:
        completeCount === statuses.length && !stale
          ? 'complete'
          : completeCount === 0
            ? 'notEvaluable'
            : 'partial',
      observationCount: values.length,
      ...metrics,
      cacheKey,
      warnings: [...new Set([...aligned.warnings, ...staleWarnings])],
    };
    const saved = this.dependencies.repository
      ? await this.dependencies.repository.save(snapshot)
      : snapshot;
    this.dependencies.logger.info('portfolio.risk.calculated', {
      portfolioId: input.portfolioId,
      ledgerVersion: input.ledgerVersion,
      observationCount: values.length,
      status: saved.status,
      methodologyVersion: saved.riskPolicyVersion,
    });
    return saved;
  }

  invalidate(portfolioId: string, currentLedgerVersion: number) {
    return (
      this.dependencies.repository?.invalidatePortfolio(
        portfolioId,
        currentLedgerVersion,
      ) ?? Promise.resolve(0)
    );
  }
}

export function riskCacheKey(input: {
  readonly portfolioId: string;
  readonly ledgerVersion: number;
  readonly valuationSeriesVersion: number;
  readonly rangeStartAt: Date;
  readonly rangeEndAt: Date;
  readonly dataCutoffAt: Date;
  readonly benchmarkCode: string;
  readonly riskPolicyVersion: string;
}): string {
  return [
    input.portfolioId,
    input.ledgerVersion,
    input.valuationSeriesVersion,
    input.rangeStartAt.toISOString(),
    input.rangeEndAt.toISOString(),
    input.benchmarkCode,
    input.riskPolicyVersion,
    input.dataCutoffAt.toISOString(),
  ].join(':');
}

function validatePair(
  left: readonly number[],
  right: readonly number[],
  minimum: number,
): RiskMetric<string> | null {
  if (left.length !== right.length)
    return failedMetric('INVALID_INPUT', Math.min(left.length, right.length));
  return validateReturns(
    [...left, ...right],
    minimum * 2,
    RISK_POLICY.methodologyVersion,
    left.length,
  );
}
function validateReturns(
  values: readonly number[],
  minimum: number,
  version: string,
  observationCount = values.length,
): RiskMetric<string> | null {
  if (values.length < minimum)
    return failedMetric('INSUFFICIENT_OBSERVATIONS', observationCount, version);
  if (values.some((value) => !Number.isFinite(value)))
    return failedMetric('INVALID_INPUT', observationCount, version);
  return null;
}
function sampleVariance(values: readonly number[]) {
  const average = mean(values);
  return (
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1)
  );
}
function sampleStandardDeviation(values: readonly number[]) {
  return Math.sqrt(sampleVariance(values));
}
function sampleCovariance(left: readonly number[], right: readonly number[]) {
  const leftMean = mean(left);
  const rightMean = mean(right);
  return (
    left.reduce(
      (sum, value, index) =>
        sum + (value - leftMean) * ((right[index] ?? 0) - rightMean),
      0,
    ) /
    (left.length - 1)
  );
}
function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function finiteNumber(value: string): number {
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    throw new Error('Invalid numeric input');
  const result = Number(value);
  if (!Number.isFinite(result) || Math.abs(result) > 1e18)
    throw new Error('Numeric input outside bounds');
  return result;
}
function formatRatio(value: number) {
  if (!Number.isFinite(value)) throw new Error('Non-finite risk output');
  return value.toFixed(12).replace(/\.?0+$/, '') || '0';
}
function decimalRatio(value: Decimal, total: Decimal) {
  const result = Number(value.dividedBy(total).toString());
  if (!Number.isFinite(result)) throw new Error('Non-finite exposure ratio');
  return result;
}
function completeMetric<T>(
  value: T,
  count: number,
  version: string = RISK_POLICY.methodologyVersion,
  warnings: readonly string[] = [],
): RiskMetric<T> {
  return {
    value,
    status: 'complete',
    reasonCode: null,
    observationCount: count,
    methodologyVersion: version,
    warnings,
  };
}
function failedMetric<T>(
  reasonCode: RiskReasonCode,
  count: number,
  version: string = RISK_POLICY.methodologyVersion,
): RiskMetric<T> {
  return {
    value: null,
    status: 'notEvaluable',
    reasonCode,
    observationCount: count,
    methodologyVersion: version,
    warnings: [],
  };
}
function returnFailure(
  reasonCode: RiskReasonCode,
  version: string,
): ReturnSeriesResult {
  return {
    returns: [],
    status: 'notEvaluable',
    reasonCode,
    observationCount: 0,
    methodologyVersion: version,
    warnings: [],
  };
}
function withWarnings<T>(
  metric: RiskMetric<T>,
  warnings: readonly string[],
): RiskMetric<T> {
  return {
    ...metric,
    warnings: [...new Set([...metric.warnings, ...warnings])],
  };
}
