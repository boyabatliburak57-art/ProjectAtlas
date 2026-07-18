/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createCoreIndicatorRegistry } from '@atlas/domain';
import type { Request } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { GlobalExceptionFilter } from '../common/http/global-exception.filter';
import { INDICATOR_REGISTRY } from '../indicators/indicator-catalog.service';
import { MARKET_RATE_LIMITER } from '../market/market-overview.ports';
import { SymbolDetailController } from './symbol-detail.controller';
import { SymbolResponseCache } from './symbol-detail.infrastructure';
import {
  SYMBOL_DETAIL_READER,
  type CorporateActionView,
  type SymbolDetailReader,
} from './symbol-detail.ports';
import { SymbolDetailService } from './symbol-detail.service';

const owner = '81000000-0000-4000-8000-000000000001';
const other = '81000000-0000-4000-8000-000000000002';
const instrumentId = '81000000-0000-4000-8000-000000000003';
const start = new Date('2026-04-01T07:00:00.000Z');

class FixtureReader implements SymbolDetailReader {
  nonFinite = false;
  readonly actions: CorporateActionView[] = [
    {
      eventKey: 'THYAO:2026-05-01:SPLIT',
      type: 'split',
      effectiveAt: new Date('2026-05-01T07:00:00.000Z'),
      factor: '2',
      cashAmount: null,
      sourceType: 'corporate_action',
    },
  ];

  profile(symbol: string) {
    return Promise.resolve(
      symbol === 'THYAO'
        ? {
            id: instrumentId,
            symbol: 'THYAO',
            name: 'Türk Hava Yolları',
            isin: 'TRATHYAO91M5',
            marketCode: 'BIST',
            currencyCode: 'TRY',
            status: 'active',
            sector: {
              id: '81000000-0000-4000-8000-000000000004',
              code: 'TRANSPORT',
              name: 'Transportation',
            },
          }
        : null,
    );
  }

  bars(input: Parameters<SymbolDetailReader['bars']>[0]) {
    const step = input.timeframe === '1d' ? 86_400_000 : 900_000;
    const base =
      input.timeframe === '1d' ? start : new Date('2026-07-16T07:00:00.000Z');
    const values = Array.from({ length: 90 }, (_, index) => {
      const value = 100 + index;
      const openTime = new Date(base.getTime() + index * step);
      return {
        openTime,
        closeTime: new Date(openTime.getTime() + step),
        open: String(value),
        high: String(value + 2),
        low: String(value - 2),
        close: this.nonFinite && index === 89 ? 'NaN' : String(value + 1),
        volume: String(1_000_000 + index),
        isClosed: index !== 89,
        sourceTimestamp: new Date(openTime.getTime() + step),
        qualityStatus: 'accepted',
      };
    });
    return Promise.resolve(
      values
        .filter((bar) => bar.openTime >= input.from && bar.openTime <= input.to)
        .slice(-input.limit),
    );
  }

  corporateActions() {
    return Promise.resolve(this.actions);
  }

  patterns() {
    return Promise.resolve([
      {
        id: '81000000-0000-4000-8000-000000000005',
        code: 'DOUBLE_BOTTOM',
        version: 1,
        algorithmVersion: 'pattern-v1',
        state: 'candidate',
        direction: 'bullish',
        startTime: new Date('2026-05-10T07:00:00.000Z'),
        endTime: new Date('2026-05-20T07:00:00.000Z'),
        detectedAt: new Date('2026-05-20T08:00:00.000Z'),
        dataCutoffAt: new Date('2026-05-20T08:00:00.000Z'),
        evidenceVersion: 1,
      },
    ]);
  }

  userMarkers(input: Parameters<SymbolDetailReader['userMarkers']>[0]) {
    return Promise.resolve([
      {
        time: new Date('2026-05-15T07:00:00.000Z'),
        type: 'transaction' as const,
        label: 'buy',
        sourceType: 'portfolio_transaction' as const,
        sourceId:
          input.userId === owner
            ? '81000000-0000-4000-8000-000000000011'
            : '81000000-0000-4000-8000-000000000012',
      },
    ]);
  }

  activeAlertCount(userId: string) {
    return Promise.resolve(userId === owner ? 2 : 0);
  }
}

describe('Symbol detail and chart API', () => {
  let app: INestApplication;
  let server: Server;
  let reader: FixtureReader;
  let cache: SymbolResponseCache;

  beforeAll(async () => {
    reader = new FixtureReader();
    cache = new SymbolResponseCache(
      new ConfigService({ MARKET_RESPONSE_CACHE_TTL_MS: 5_000 }),
    );
    const resolver: AuthenticatedUserResolver = (req: Request) =>
      String(req.headers['x-user-id'] ?? owner);
    const module = await Test.createTestingModule({
      controllers: [SymbolDetailController],
      providers: [
        SymbolDetailService,
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: SYMBOL_DETAIL_READER, useValue: reader },
        { provide: SymbolResponseCache, useValue: cache },
        {
          provide: INDICATOR_REGISTRY,
          useFactory: createCoreIndicatorRegistry,
        },
        {
          provide: MARKET_RATE_LIMITER,
          useValue: { consume: () => undefined },
        },
        { provide: AUTHENTICATED_USER_RESOLVER, useValue: resolver },
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => 5_000 },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    reader.nonFinite = false;
    cache.clear();
  });

  afterAll(() => app.close());

  const api = () => request(server);
  const range = {
    from: '2026-04-01T00:00:00.000Z',
    to: '2026-07-01T00:00:00.000Z',
    limit: 90,
  };

  it('returns symbol profile, quote cutoff and quality metadata', async () => {
    const profile = await api().get('/api/v1/symbols/THYAO').expect(200);
    expect(profile.body.data).toMatchObject({
      symbol: 'THYAO',
      name: 'Türk Hava Yolları',
      marketCode: 'BIST',
    });
    const quote = await api().get('/api/v1/symbols/THYAO/quote').expect(200);
    expect(quote.body.meta.dataCutoffAt).toMatch(/Z$/);
    expect(quote.body.meta.quality.status).toBe('accepted');
  });

  it('keeps raw and split-adjusted charts in separate cache identities', async () => {
    const raw = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .query({ ...range, adjustmentMode: 'raw' })
      .expect(200);
    const adjusted = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .query({ ...range, adjustmentMode: 'split-adjusted' })
      .expect(200);
    expect(raw.body.meta).toMatchObject({
      adjustmentMode: 'raw',
      cache: 'miss',
    });
    expect(adjusted.body.meta).toMatchObject({
      adjustmentMode: 'split-adjusted',
      cache: 'miss',
    });
    expect(adjusted.body.data.bars[0].close).not.toBe(
      raw.body.data.bars[0].close,
    );
    const replay = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .query({ ...range, adjustmentMode: 'raw' })
      .expect(200);
    expect(replay.body.meta.cache).toBe('hit');
  });

  it.each(['1d', '15m'])(
    'supports %s bars with ascending unique timestamps',
    async (timeframe) => {
      const response = await api()
        .get('/api/v1/symbols/THYAO/chart')
        .query(
          timeframe === '1d'
            ? { ...range, timeframe }
            : {
                timeframe,
                from: '2026-07-16T07:00:00.000Z',
                to: '2026-07-17T07:00:00.000Z',
                limit: 90,
              },
        )
        .expect(200);
      const times = response.body.data.bars.map(
        (bar: { time: number }) => bar.time,
      );
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(new Set(times).size).toBe(times.length);
    },
  );

  it('aligns overlay and multi-output panel timestamps and preserves versions', async () => {
    const response = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .query({ ...range, overlays: 'volume,SMA@1(period=14),MACD@1' })
      .expect(200);
    const axis = new Set(
      response.body.data.bars.map((bar: { time: number }) => bar.time),
    );
    const series = [
      ...response.body.data.overlays,
      ...response.body.data.panels,
    ];
    for (const item of series)
      expect(
        item.points.every((point: { time: number }) => axis.has(point.time)),
      ).toBe(true);
    expect(
      response.body.data.panels
        .filter(
          (item: { indicatorCode: string }) => item.indicatorCode === 'MACD',
        )
        .map((item: { outputName: string }) => item.outputName),
    ).toEqual(['macd', 'signal', 'histogram']);
    expect(response.body.meta.indicatorVersions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'SMA',
          version: 1,
          parameters: { period: 14 },
        }),
        expect.objectContaining({ code: 'MACD', version: 1 }),
      ]),
    );
  });

  it('marks the open bar separately from closed bars', async () => {
    const response = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .query(range)
      .expect(200);
    expect(response.body.data.bars.at(-1).isClosed).toBe(false);
    expect(response.body.meta.openBarIncluded).toBe(true);
  });

  it('adds one deduplicated corporate action marker on the chart axis', async () => {
    reader.actions.push({ ...reader.actions[0]! });
    const response = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .query({
        ...range,
        includeCorporateActions: 'true',
        includePatterns: 'true',
      })
      .expect(200);
    const markers = response.body.data.markers.filter(
      (marker: { type: string }) => marker.type === 'corporateAction',
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].sourceId).toBeUndefined();
    expect(
      response.body.data.markers.some(
        (marker: { type: string }) => marker.type === 'pattern',
      ),
    ).toBe(true);
    expect(
      response.body.data.bars.some(
        (bar: { time: number }) => bar.time === markers[0].time,
      ),
    ).toBe(true);
    reader.actions.pop();
  });

  it('enforces chart range and overlay count limits', async () => {
    const rangeError = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .query({
        timeframe: '5m',
        from: '2025-01-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      })
      .expect(400);
    expect(rangeError.body.error.code).toBe('CHART_RANGE_INVALID');
    const overlayError = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .query({
        ...range,
        overlays: 'SMA,EMA,WMA,RSI,ATR,MACD,OBV',
      })
      .expect(400);
    expect(overlayError.body.error.code).toBe('CHART_OVERLAY_LIMIT_EXCEEDED');
  });

  it('returns only the authenticated owner user markers', async () => {
    const ownerResponse = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .set('x-user-id', owner)
      .query({ ...range, includeUserMarkers: 'true' })
      .expect(200);
    const otherResponse = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .set('x-user-id', other)
      .query({ ...range, includeUserMarkers: 'true' })
      .expect(200);
    expect(ownerResponse.body.data.markers[0].sourceId).not.toBe(
      otherResponse.body.data.markers[0].sourceId,
    );
    expect(JSON.stringify(otherResponse.body)).not.toContain(
      '81000000-0000-4000-8000-000000000011',
    );
  });

  it('returns corporate actions and latest signals without duplicate provider payload', async () => {
    const actions = await api()
      .get('/api/v1/symbols/THYAO/corporate-actions')
      .expect(200);
    expect(actions.body.data.items[0]).toMatchObject({
      type: 'split',
      factor: '2',
    });
    const signals = await api()
      .get('/api/v1/symbols/THYAO/signals')
      .expect(200);
    expect(signals.body.data.signals[0]).toMatchObject({
      code: 'DOUBLE_BOTTOM',
      disclaimer: 'Not investment advice',
    });
    expect(JSON.stringify(signals.body)).not.toContain('providerRaw');
  });

  it('rejects an unknown symbol and non-finite public chart data', async () => {
    const missing = await api().get('/api/v1/symbols/UNKNOWN').expect(404);
    expect(missing.body.error.code).toBe('SYMBOL_NOT_FOUND');
    reader.nonFinite = true;
    const invalid = await api()
      .get('/api/v1/symbols/THYAO/chart')
      .query(range)
      .expect(422);
    expect(invalid.body.error.code).toBe('CHART_DATA_INVALID');
  });
});
