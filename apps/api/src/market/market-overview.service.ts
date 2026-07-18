import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { MarketResponseCache } from './market-overview.infrastructure';
import {
  MARKET_OVERVIEW_READER,
  MARKET_RATE_LIMITER,
  type MarketOverviewReader,
  type MarketRateLimiter,
  type MarketSnapshotView,
} from './market-overview.ports';

export const MARKET_RANKING_TYPES = [
  'gainers',
  'losers',
  'volume',
  'relativeVolume',
  'volatility',
  'breakoutCandidates',
] as const;

const marketQuery = z.object({
  market: z.string().trim().min(1).max(32).default('BIST'),
  timeframe: z.string().trim().min(1).max(16).default('1d'),
});
const rankingQuery = marketQuery.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2048).optional(),
});
const cursorSchema = z.object({
  version: z.literal(1),
  contextHash: z.string().length(64),
  rank: z.number().int().min(1),
  instrumentId: z.uuid(),
});

interface MarketServiceResult {
  readonly data: unknown;
  readonly meta: Record<string, unknown>;
}

@Injectable()
export class MarketOverviewService {
  constructor(
    @Inject(MARKET_OVERVIEW_READER)
    private readonly reader: MarketOverviewReader,
    @Inject(MARKET_RATE_LIMITER)
    private readonly rateLimiter: MarketRateLimiter,
    @Inject(MarketResponseCache) private readonly cache: MarketResponseCache,
  ) {}

  async overview(clientKey: string, query: unknown) {
    this.consume(clientKey, 'overview');
    const parsed = parse(marketQuery, query);
    const snapshot = await this.snapshot(parsed);
    const key = cacheKey('overview', snapshot);
    const cached = this.cache.get<ReturnType<typeof overviewResult>>(key);
    if (cached) return cached;
    const result = overviewResult(snapshot);
    this.cache.set(key, result);
    return result;
  }

  async breadth(clientKey: string, query: unknown) {
    this.consume(clientKey, 'breadth');
    const parsed = parse(marketQuery, query);
    const snapshot = await this.snapshot(parsed);
    const key = cacheKey('breadth', snapshot);
    const cached = this.cache.get<ReturnType<typeof breadthResult>>(key);
    if (cached) return cached;
    const result = breadthResult(snapshot);
    this.cache.set(key, result);
    return result;
  }

  async sectors(clientKey: string, query: unknown) {
    this.consume(clientKey, 'sectors');
    const parsed = parse(marketQuery, query);
    const snapshot = await this.snapshot(parsed);
    const key = cacheKey('sectors', snapshot);
    const cached = this.cache.get<MarketServiceResult>(key);
    if (cached) return cached;
    const items = await this.reader.sectors(snapshot.generationId);
    const result = {
      data: {
        items: items.map((item) => ({
          sectorId: item.sectorId,
          sectorCode: item.sectorCode,
          sectorName: item.sectorName,
          status: publicStatus(item.status),
          partial: item.status === 'partial',
          stale: item.status === 'stale',
          evaluatedCount: item.evaluatedCount,
          excludedCount: item.excludedCount,
          ...safeObject(item.payload),
        })),
      },
      meta: metadata(snapshot),
    };
    this.cache.set(key, result);
    return result;
  }

  async rankings(clientKey: string, rawType: string, query: unknown) {
    this.consume(clientKey, 'rankings');
    const type = rankingType(rawType);
    const parsed = parse(rankingQuery, query);
    const snapshot = await this.snapshot(parsed);
    const contextHash = hash({
      version: 1,
      generationId: snapshot.generationId,
      marketCode: snapshot.marketCode,
      timeframe: snapshot.timeframe,
      policyVersion: snapshot.policyVersion,
      dataCutoffAt: snapshot.dataCutoffAt.toISOString(),
      rankingType: type,
      sort: 'rank:asc,instrumentId:asc',
    });
    const cursor = parsed.cursor
      ? decodeCursor(parsed.cursor, contextHash)
      : null;
    const key = `${cacheKey(`ranking:${type}`, snapshot)}:${parsed.limit}:${parsed.cursor ?? 'first'}`;
    const cached = this.cache.get<MarketServiceResult>(key);
    if (cached) return cached;
    const page = await this.reader.rankingPage({
      generationId: snapshot.generationId,
      rankingType: type,
      limit: parsed.limit,
      cursor,
    });
    const result = {
      data: {
        items: page.items.map((item) => ({
          instrumentId: item.instrumentId,
          symbol: item.symbol,
          company: item.company,
          rank: item.rank,
          sortValue: item.sortValue,
          status: publicStatus(item.status),
          ...safeObject(item.payload),
        })),
      },
      meta: {
        ...metadata(snapshot),
        rankingType: type,
        limit: parsed.limit,
        nextCursor: page.nextPosition
          ? encodeCursor({
              version: 1,
              contextHash,
              ...page.nextPosition,
            })
          : null,
      },
    };
    this.cache.set(key, result);
    return result;
  }

  private consume(clientKey: string, operation: string) {
    this.rateLimiter.consume({ clientKey, operation, now: new Date() });
  }

  private async snapshot(input: { market: string; timeframe: string }) {
    const snapshot = await this.reader.latestOverview({
      marketCode: input.market.toUpperCase(),
      timeframe: input.timeframe,
    });
    if (!snapshot)
      throw new NotFoundException({
        code: 'MARKET_SNAPSHOT_NOT_AVAILABLE',
        message: 'Market snapshot is not available',
      });
    return snapshot;
  }
}

function overviewResult(snapshot: MarketSnapshotView) {
  return { data: safeObject(snapshot.payload), meta: metadata(snapshot) };
}

function breadthResult(snapshot: MarketSnapshotView) {
  const breadth = snapshot.payload['breadth'];
  return {
    data: {
      ...(isRecord(breadth) ? safeObject(breadth) : {}),
      evaluatedCount: snapshot.evaluatedCount,
      excludedCount: snapshot.excludedCount,
      universeCount: snapshot.evaluatedCount + snapshot.excludedCount,
    },
    meta: metadata(snapshot),
  };
}

function metadata(snapshot: MarketSnapshotView) {
  return {
    generationId: snapshot.generationId,
    marketCode: snapshot.marketCode,
    timeframe: snapshot.timeframe,
    universeVersion: snapshot.universeVersion,
    policyVersion: snapshot.policyVersion,
    dataCutoffAt: snapshot.dataCutoffAt.toISOString(),
    sourceTimestamp: snapshot.sourceTimestamp?.toISOString() ?? null,
    status: publicStatus(snapshot.status),
    partial: snapshot.status === 'partial',
    stale: snapshot.status === 'stale',
    evaluatedCount: snapshot.evaluatedCount,
    excludedCount: snapshot.excludedCount,
    quality: safeQuality(snapshot.qualityMetadata),
  };
}

function publicStatus(status: string) {
  return status === 'not_evaluable' ? 'notEvaluable' : status;
}

function cacheKey(operation: string, snapshot: MarketSnapshotView) {
  return [
    'market',
    operation,
    snapshot.marketCode,
    snapshot.timeframe,
    snapshot.universeVersion,
    snapshot.dataCutoffAt.toISOString(),
    snapshot.policyVersion,
    snapshot.generationId,
  ].join(':');
}

function rankingType(value: string): (typeof MARKET_RANKING_TYPES)[number] {
  if ((MARKET_RANKING_TYPES as readonly string[]).includes(value))
    return value as (typeof MARKET_RANKING_TYPES)[number];
  throw new BadRequestException({
    code: 'MARKET_RANKING_TYPE_INVALID',
    message: 'Unsupported market ranking type',
  });
}

function decodeCursor(value: string, contextHash: string) {
  let cursor: z.infer<typeof cursorSchema>;
  try {
    cursor = cursorSchema.parse(
      JSON.parse(Buffer.from(value, 'base64url').toString('utf8')),
    );
  } catch {
    throw new BadRequestException({
      code: 'MARKET_CURSOR_INVALID',
      message: 'Invalid market ranking cursor',
    });
  }
  if (cursor.contextHash !== contextHash)
    throw new BadRequestException({
      code: 'MARKET_CURSOR_CONTEXT_MISMATCH',
      message: 'Market ranking cursor does not match the snapshot context',
    });
  return { rank: cursor.rank, instrumentId: cursor.instrumentId };
}

function encodeCursor(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new BadRequestException({
    code: 'MARKET_REQUEST_INVALID',
    message: 'Invalid market request',
    details: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      reason: issue.message,
    })),
  });
}

function safeQuality(value: Readonly<Record<string, unknown>>) {
  const allowed = [
    'sourceTimestamp',
    'stale',
    'partial',
    'warnings',
    'versions',
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => key in value)
      .map((key) => [key, sanitize(value[key])]),
  );
}

function safeObject(value: Readonly<Record<string, unknown>>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKey(key))
      .map(([key, item]) => [key, sanitize(item)]),
  );
}

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (isRecord(value)) return safeObject(value);
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

function sensitiveKey(key: string) {
  return /(?:providerRaw|rawPayload|providerError|credential|secret|apiKey)/i.test(
    key,
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
