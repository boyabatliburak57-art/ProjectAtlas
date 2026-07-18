/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import type { Server } from 'node:http';

import {
  HttpException,
  HttpStatus,
  type INestApplication,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { GlobalExceptionFilter } from '../common/http/global-exception.filter';
import { MarketOverviewController } from './market-overview.controller';
import { MarketResponseCache } from './market-overview.infrastructure';
import {
  MARKET_OVERVIEW_READER,
  MARKET_RATE_LIMITER,
  type MarketOverviewReader,
  type MarketRateLimiter,
  type MarketSnapshotView,
} from './market-overview.ports';
import { MarketOverviewService } from './market-overview.service';

const cutoff = new Date('2026-07-17T15:10:00.000Z');

class FixtureReader implements MarketOverviewReader {
  snapshot: MarketSnapshotView | null = this.makeSnapshot(1);
  private sequence = 1;
  readonly rankingItems = Array.from({ length: 7 }, (_, index) => ({
    instrumentId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    symbol: `MKT${String(index + 1).padStart(2, '0')}`,
    company: `Market ${index + 1}`,
    rank: index + 1,
    sortValue: index < 3 ? '12.5000000000' : String(12 - index),
    status: 'complete' as const,
    payload: {
      changePercent: index < 3 ? '0.125000000000' : `0.0${index}`,
      providerRaw: { shouldNeverLeak: true },
    },
    qualityMetadata: {},
  }));

  reset() {
    this.sequence += 1;
    this.snapshot = this.makeSnapshot(this.sequence);
  }

  replaceForClosedBar() {
    const previous = this.snapshot;
    this.sequence += 1;
    this.snapshot = {
      ...this.makeSnapshot(this.sequence),
      dataCutoffAt: new Date(
        (previous?.dataCutoffAt ?? cutoff).getTime() + 86_400_000,
      ),
    };
  }

  latestOverview() {
    return Promise.resolve(this.snapshot);
  }

  sectors(generationId: string) {
    return Promise.resolve([
      {
        sectorId: '20000000-0000-4000-8000-000000000001',
        sectorCode: 'BANK',
        sectorName: 'Banks',
        status: 'complete' as const,
        payload: { changePercent: '0.012000000000' },
        evaluatedCount: 8,
        excludedCount: 1,
        qualityMetadata: { generationId },
      },
    ]);
  }

  rankingPage(input: Parameters<MarketOverviewReader['rankingPage']>[0]) {
    const rows = this.rankingItems.filter(
      (item) =>
        !input.cursor ||
        item.rank > input.cursor.rank ||
        (item.rank === input.cursor.rank &&
          item.instrumentId > input.cursor.instrumentId),
    );
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return Promise.resolve({
      items: page,
      nextPosition:
        rows.length > input.limit && last
          ? { rank: last.rank, instrumentId: last.instrumentId }
          : null,
    });
  }

  private makeSnapshot(sequence: number): MarketSnapshotView {
    return {
      generationId: `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
      marketCode: 'BIST',
      timeframe: '1d',
      universeVersion: 'bist-active-v1',
      policyVersion: 'market-overview-v1',
      dataCutoffAt: cutoff,
      sourceTimestamp: new Date(cutoff.getTime() + 60_000),
      status: 'complete',
      payload: {
        indices: [{ code: 'XU100', value: '10123.45' }],
        breadth: { advancers: 400, decliners: 220, unchanged: 20 },
        providerError: 'must not leak',
      },
      evaluatedCount: 640,
      excludedCount: 10,
      qualityMetadata: { warnings: [], providerRaw: 'must not leak' },
    };
  }
}

class FixtureRateLimiter implements MarketRateLimiter {
  limit = 100;
  private readonly calls = new Map<string, number>();

  reset() {
    this.limit = 100;
    this.calls.clear();
  }

  consume(input: Parameters<MarketRateLimiter['consume']>[0]) {
    const count = (this.calls.get(input.operation) ?? 0) + 1;
    this.calls.set(input.operation, count);
    if (count > this.limit)
      throw new HttpException(
        { code: 'MARKET_RATE_LIMITED', message: 'Rate limit exceeded' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }
}

describe('Market overview API', () => {
  let app: INestApplication;
  let server: Server;
  let reader: FixtureReader;
  let limiter: FixtureRateLimiter;

  beforeAll(async () => {
    reader = new FixtureReader();
    limiter = new FixtureRateLimiter();
    const module = await Test.createTestingModule({
      controllers: [MarketOverviewController],
      providers: [
        MarketOverviewService,
        MarketResponseCache,
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: MARKET_OVERVIEW_READER, useValue: reader },
        { provide: MARKET_RATE_LIMITER, useValue: limiter },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) =>
              key === 'MARKET_RESPONSE_CACHE_TTL_MS' ? 5_000 : undefined,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    reader.reset();
    limiter.reset();
  });

  afterAll(() => app.close());

  const api = () => request(server);

  it('returns complete overview metadata without provider payload leakage', async () => {
    const response = await api().get('/api/v1/market/overview').expect(200);
    expect(response.body.meta).toMatchObject({
      status: 'complete',
      partial: false,
      stale: false,
      dataCutoffAt: cutoff.toISOString(),
      generationId: reader.snapshot?.generationId,
    });
    expect(response.body.data.indices).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toMatch(
      /providerRaw|providerError/,
    );
  });

  it.each([
    ['partial', true, false],
    ['stale', false, true],
  ] as const)(
    'exposes %s snapshot state explicitly',
    async (status, partial, stale) => {
      reader.snapshot = { ...reader.snapshot!, status };
      const response = await api().get('/api/v1/market/overview').expect(200);
      expect(response.body.meta).toMatchObject({ status, partial, stale });
    },
  );

  it('uses only evaluated symbols in breadth and reports exclusions', async () => {
    const response = await api().get('/api/v1/market/breadth').expect(200);
    expect(response.body.data).toMatchObject({
      advancers: 400,
      evaluatedCount: 640,
      excludedCount: 10,
      universeCount: 650,
    });
  });

  it('returns sector aggregation from the same generation', async () => {
    const response = await api().get('/api/v1/market/sectors').expect(200);
    expect(response.body.data.items[0]).toMatchObject({
      sectorCode: 'BANK',
      evaluatedCount: 8,
      excludedCount: 1,
    });
    expect(response.body.meta.generationId).toBe(reader.snapshot?.generationId);
  });

  it('paginates first, middle and last pages without duplicates or omissions', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let page = 0;
    do {
      const response = await api()
        .get('/api/v1/market/rankings/gainers')
        .query({ limit: 3, ...(cursor ? { cursor } : {}) })
        .expect(200);
      page += 1;
      seen.push(
        ...response.body.data.items.map(
          (item: { instrumentId: string }) => item.instrumentId,
        ),
      );
      cursor = response.body.meta.nextCursor as string | null;
    } while (cursor);
    expect(page).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen)).toEqual(
      new Set(reader.rankingItems.map(({ instrumentId }) => instrumentId)),
    );
  });

  it('keeps equal sort values stable with rank and instrument tie-breakers', async () => {
    const response = await api()
      .get('/api/v1/market/rankings/gainers?limit=3')
      .expect(200);
    expect(
      response.body.data.items.map((item: { rank: number }) => item.rank),
    ).toEqual([1, 2, 3]);
    expect(
      new Set(
        response.body.data.items.map(
          (item: { instrumentId: string }) => item.instrumentId,
        ),
      ).size,
    ).toBe(3);
  });

  it('rejects unsupported ranking types and malformed cursors', async () => {
    const invalidType = await api()
      .get('/api/v1/market/rankings/unknown')
      .expect(400);
    expect(invalidType.body.error.code).toBe('MARKET_RANKING_TYPE_INVALID');
    const invalidCursor = await api()
      .get('/api/v1/market/rankings/gainers?cursor=invalid')
      .expect(400);
    expect(invalidCursor.body.error.code).toBe('MARKET_CURSOR_INVALID');
  });

  it.each([
    'gainers',
    'losers',
    'volume',
    'relativeVolume',
    'volatility',
    'breakoutCandidates',
  ])('accepts the allowlisted %s ranking type', async (type) => {
    const response = await api()
      .get(`/api/v1/market/rankings/${type}`)
      .expect(200);
    expect(response.body.meta.rankingType).toBe(type);
  });

  it('invalidates old cursor context when a new closed bar generation arrives', async () => {
    const first = await api()
      .get('/api/v1/market/rankings/gainers?limit=2')
      .expect(200);
    const oldGeneration = first.body.meta.generationId as string;
    reader.replaceForClosedBar();
    const mismatch = await api()
      .get('/api/v1/market/rankings/gainers')
      .query({ cursor: first.body.meta.nextCursor })
      .expect(400);
    expect(mismatch.body.error.code).toBe('MARKET_CURSOR_CONTEXT_MISMATCH');
    const overview = await api().get('/api/v1/market/overview').expect(200);
    expect(overview.body.meta.generationId).not.toBe(oldGeneration);
  });

  it('keeps overview, sectors and rankings generation-consistent', async () => {
    const [overview, sectors, rankings] = await Promise.all([
      api().get('/api/v1/market/overview').expect(200),
      api().get('/api/v1/market/sectors').expect(200),
      api().get('/api/v1/market/rankings/volume').expect(200),
    ]);
    expect(
      new Set([
        overview.body.meta.generationId,
        sectors.body.meta.generationId,
        rankings.body.meta.generationId,
      ]).size,
    ).toBe(1);
    expect(overview.body.meta.dataCutoffAt).toBe(
      rankings.body.meta.dataCutoffAt,
    );
  });

  it('returns the standard missing-snapshot error and enforces backend rate limit', async () => {
    reader.snapshot = null;
    const missing = await api().get('/api/v1/market/overview').expect(404);
    expect(missing.body.error.code).toBe('MARKET_SNAPSHOT_NOT_AVAILABLE');
    reader.reset();
    limiter.reset();
    limiter.limit = 1;
    await api().get('/api/v1/market/overview').expect(200);
    const limited = await api().get('/api/v1/market/overview').expect(429);
    expect(limited.body.error.code).toBe('MARKET_RATE_LIMITED');
  });
});
