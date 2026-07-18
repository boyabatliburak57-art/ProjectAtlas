import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  instruments,
  marketOverviewSnapshots,
  marketRankSnapshots,
  sectorMarketSnapshots,
  sectors,
} from '@atlas/database';
import { and, asc, desc, eq, gt, ne, or } from 'drizzle-orm';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';
import type {
  MarketOverviewReader,
  MarketRankingPageView,
  MarketRateLimiter,
} from './market-overview.ports';

@Injectable()
export class PostgresMarketOverviewReader implements MarketOverviewReader {
  constructor(@Inject(ApiDatabase) private readonly connection: ApiDatabase) {}

  async latestOverview(input: {
    readonly marketCode: string;
    readonly timeframe: string;
  }) {
    const row = (
      await this.connection.database
        .select()
        .from(marketOverviewSnapshots)
        .where(
          and(
            eq(marketOverviewSnapshots.marketCode, input.marketCode),
            eq(marketOverviewSnapshots.timeframe, input.timeframe),
            ne(marketOverviewSnapshots.status, 'invalidated'),
          ),
        )
        .orderBy(
          desc(marketOverviewSnapshots.dataCutoffAt),
          desc(marketOverviewSnapshots.createdAt),
          desc(marketOverviewSnapshots.id),
        )
        .limit(1)
    )[0];
    return row
      ? {
          generationId: row.generationId,
          marketCode: row.marketCode,
          timeframe: row.timeframe,
          universeVersion: row.universeVersion,
          policyVersion: row.policyVersion,
          dataCutoffAt: row.dataCutoffAt,
          sourceTimestamp: row.sourceTimestamp,
          status: row.status as
            | 'complete'
            | 'partial'
            | 'stale'
            | 'not_evaluable',
          payload: row.payload,
          evaluatedCount: row.evaluatedCount,
          excludedCount: row.excludedCount,
          qualityMetadata: row.qualityMetadata,
        }
      : null;
  }

  async sectors(generationId: string) {
    const rows = await this.connection.database
      .select({
        sectorId: sectorMarketSnapshots.sectorId,
        sectorCode: sectors.code,
        sectorName: sectors.name,
        status: sectorMarketSnapshots.status,
        payload: sectorMarketSnapshots.payload,
        evaluatedCount: sectorMarketSnapshots.evaluatedCount,
        excludedCount: sectorMarketSnapshots.excludedCount,
        qualityMetadata: sectorMarketSnapshots.qualityMetadata,
      })
      .from(sectorMarketSnapshots)
      .innerJoin(sectors, eq(sectors.id, sectorMarketSnapshots.sectorId))
      .where(eq(sectorMarketSnapshots.generationId, generationId))
      .orderBy(asc(sectors.code), asc(sectorMarketSnapshots.sectorId));
    return rows.map((row) => ({
      ...row,
      status: row.status as 'complete' | 'partial' | 'stale' | 'not_evaluable',
    }));
  }

  async rankingPage(input: {
    readonly generationId: string;
    readonly rankingType: string;
    readonly limit: number;
    readonly cursor: {
      readonly rank: number;
      readonly instrumentId: string;
    } | null;
  }): Promise<MarketRankingPageView> {
    const cursorCondition = input.cursor
      ? or(
          gt(marketRankSnapshots.rank, input.cursor.rank),
          and(
            eq(marketRankSnapshots.rank, input.cursor.rank),
            gt(marketRankSnapshots.instrumentId, input.cursor.instrumentId),
          ),
        )
      : undefined;
    const rows = await this.connection.database
      .select({
        instrumentId: marketRankSnapshots.instrumentId,
        symbol: instruments.symbol,
        company: instruments.name,
        rank: marketRankSnapshots.rank,
        sortValue: marketRankSnapshots.sortValue,
        status: marketRankSnapshots.status,
        payload: marketRankSnapshots.payload,
        qualityMetadata: marketRankSnapshots.qualityMetadata,
      })
      .from(marketRankSnapshots)
      .innerJoin(
        instruments,
        eq(instruments.id, marketRankSnapshots.instrumentId),
      )
      .where(
        and(
          eq(marketRankSnapshots.generationId, input.generationId),
          eq(marketRankSnapshots.rankingType, input.rankingType),
          cursorCondition,
        ),
      )
      .orderBy(
        asc(marketRankSnapshots.rank),
        asc(marketRankSnapshots.instrumentId),
      )
      .limit(input.limit + 1);
    const hasNext = rows.length > input.limit;
    const page = hasNext ? rows.slice(0, input.limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...row,
        status: row.status as
          | 'complete'
          | 'partial'
          | 'stale'
          | 'not_evaluable',
      })),
      nextPosition:
        hasNext && last
          ? { rank: last.rank, instrumentId: last.instrumentId }
          : null,
    };
  }
}

@Injectable()
export class InMemoryMarketRateLimiter implements MarketRateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.limit = config.getOrThrow<number>('MARKET_PUBLIC_RATE_LIMIT');
    this.windowMs = config.getOrThrow<number>('MARKET_PUBLIC_RATE_WINDOW_MS');
  }

  consume(input: {
    readonly clientKey: string;
    readonly operation: string;
    readonly now: Date;
  }): void {
    const key = `${input.clientKey}:${input.operation}`;
    const cutoff = input.now.getTime() - this.windowMs;
    const active = (this.windows.get(key) ?? []).filter(
      (time) => time > cutoff,
    );
    if (active.length >= this.limit)
      throw new HttpException(
        {
          code: 'MARKET_RATE_LIMITED',
          message: 'Market request rate limit exceeded',
          details: {
            retryAfterMs: Math.max(
              1,
              (active[0] ?? cutoff) + this.windowMs - input.now.getTime(),
            ),
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    active.push(input.now.getTime());
    this.windows.set(key, active);
  }
}

@Injectable()
export class MarketResponseCache {
  private readonly values = new Map<
    string,
    { readonly expiresAt: number; readonly value: unknown }
  >();
  private readonly ttlMs: number;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.ttlMs = config.getOrThrow<number>('MARKET_RESPONSE_CACHE_TTL_MS');
  }

  get<T>(key: string, now = Date.now()): T | null {
    const entry = this.values.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this.values.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set(key: string, value: unknown, now = Date.now()): void {
    const oldestKey = this.values.keys().next().value;
    if (this.values.size >= 512 && oldestKey) this.values.delete(oldestKey);
    this.values.set(key, { expiresAt: now + this.ttlMs, value });
  }

  clear(): void {
    this.values.clear();
  }
}
