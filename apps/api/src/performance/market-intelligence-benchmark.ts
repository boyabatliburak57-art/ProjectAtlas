import 'reflect-metadata';

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { hostname, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  createDatabase,
  dataProviders,
  instruments,
  marketOverviewSnapshots,
  marketRankSnapshots,
  patternDefinitions,
  patternInstances,
  portfolios,
  portfolioTransactions,
  priceBars,
  runMigrations,
} from '@atlas/database';
import { createCoreIndicatorRegistry } from '@atlas/domain';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';

import { GlobalExceptionFilter } from '../common/http/global-exception.filter';
import {
  AUTHENTICATED_USER_RESOLVER,
  trustedRequestUserResolver,
} from '../common/auth/authenticated-user';
import { parseEnvironment } from '../config/environment';
import { INDICATOR_REGISTRY } from '../indicators/indicator-catalog.service';
import { MarketOverviewController } from '../market/market-overview.controller';
import { MarketResponseCache } from '../market/market-overview.infrastructure';
import {
  InMemoryMarketRateLimiter,
  PostgresMarketOverviewReader,
} from '../market/market-overview.infrastructure';
import {
  MARKET_OVERVIEW_READER,
  MARKET_RATE_LIMITER,
} from '../market/market-overview.ports';
import { MarketOverviewService } from '../market/market-overview.service';
import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';
import { SymbolDetailController } from '../symbols/symbol-detail.controller';
import {
  PostgresSymbolDetailReader,
  SymbolResponseCache,
} from '../symbols/symbol-detail.infrastructure';
import { SYMBOL_DETAIL_READER } from '../symbols/symbol-detail.ports';
import { SymbolDetailService } from '../symbols/symbol-detail.service';

const ROOT = `${resolve(__dirname, '../../../..')}/`;
const REPORT_DIRECTORY = `${ROOT}reports/performance`;
const DATABASE_URL = requireTestDatabaseUrl();
const CUTOFF = new Date('2026-07-17T15:10:00.000Z');
const GENERATION_ID = '70000000-0000-4000-8000-000000000001';
const INSTRUMENT_COUNT = 650;
const SYMBOL_BAR_COUNT = 730;
const SYMBOL_ID = '71000000-0000-4000-8000-000000000001';
const PROVIDER_ID = '72000000-0000-4000-8000-000000000001';

interface Thresholds {
  readonly 'PERF-MKT-001': {
    readonly warmP95Ms: number;
    readonly coldP95Ms: number;
    readonly maximumErrors: number;
    readonly fixtureInstruments: number;
  };
  readonly 'PERF-MKT-002': {
    readonly p95Ms: number;
    readonly maximumErrors: number;
    readonly fixtureInstruments: number;
    readonly pageSize: number;
  };
  readonly 'PERF-MKT-003': {
    readonly p95Ms: number;
    readonly maximumErrors: number;
  };
  readonly 'PERF-MKT-004': {
    readonly p95Ms: number;
    readonly maximumErrors: number;
    readonly dailyBars: number;
    readonly indicatorOverlays: number;
  };
}

interface Summary {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

const thresholds = JSON.parse(
  readFileSync(
    `${ROOT}performance/thresholds/market-intelligence.json`,
    'utf8',
  ),
) as Thresholds;

process.env.DATABASE_URL = DATABASE_URL;
process.env.MARKET_PUBLIC_RATE_LIMIT = '10000';
process.env.MARKET_RESPONSE_CACHE_TTL_MS = '300000';
process.env.NODE_ENV = 'test';

@Module({
  controllers: [MarketOverviewController, SymbolDetailController],
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: parseEnvironment,
    }),
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ApiDatabase,
    PostgresMarketOverviewReader,
    InMemoryMarketRateLimiter,
    MarketResponseCache,
    MarketOverviewService,
    PostgresSymbolDetailReader,
    SymbolResponseCache,
    SymbolDetailService,
    { provide: INDICATOR_REGISTRY, useFactory: createCoreIndicatorRegistry },
    {
      provide: AUTHENTICATED_USER_RESOLVER,
      useValue: trustedRequestUserResolver,
    },
    {
      provide: MARKET_OVERVIEW_READER,
      useExisting: PostgresMarketOverviewReader,
    },
    { provide: MARKET_RATE_LIMITER, useExisting: InMemoryMarketRateLimiter },
    { provide: SYMBOL_DETAIL_READER, useExisting: PostgresSymbolDetailReader },
  ],
})
class MarketBenchmarkModule {}

async function main() {
  process.stderr.write('market benchmark: validating fixture\n');
  assertFixtureContract();
  const { db, pool } = createDatabase(DATABASE_URL);
  let application: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
  try {
    process.stderr.write('market benchmark: migrating database\n');
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await seedFixture(db);

    process.stderr.write('market benchmark: starting HTTP application\n');
    application = await NestFactory.create(MarketBenchmarkModule, {
      abortOnError: false,
      logger: ['error'],
    });
    application.setGlobalPrefix('api/v1');
    await application.listen(0, '127.0.0.1');
    const address = (
      application.getHttpServer() as Server
    ).address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const cache = application.get(MarketResponseCache);
    const symbolCache = application.get(SymbolResponseCache);
    try {
      await application.get(PostgresMarketOverviewReader).latestOverview({
        marketCode: 'BIST',
        timeframe: '1d',
      });
    } catch (error) {
      const cause =
        error instanceof Error && 'cause' in error
          ? String((error as Error & { readonly cause?: unknown }).cause)
          : '';
      throw new Error(
        `Market read-model probe failed: ${String(error)} ${cause}`,
      );
    }

    process.stderr.write('market benchmark: measuring scenarios\n');
    const overview = await benchmarkOverview(baseUrl, cache);
    const ranking = await benchmarkRanking(baseUrl, cache);
    const symbolAggregate = await benchmarkSymbolAggregate(baseUrl);
    const chart = await benchmarkChart(baseUrl, symbolCache);
    const scenarios = [overview, ranking, symbolAggregate, chart];
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      commitSha: command('git', ['rev-parse', 'HEAD']),
      status: scenarios.every(({ passed }) => passed) ? 'PASS' : 'FAIL',
      environment: {
        hostname: hostname(),
        platform: platform(),
        release: release(),
        cpu: command('sh', [
          '-c',
          'sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m',
        ]),
        memoryBytes: totalmem(),
        node: process.version,
        pnpm: command('pnpm', ['--version']),
        postgres: (await pool.query<{ version: string }>('show server_version'))
          .rows[0]?.version,
        route:
          'real Nest HTTP -> controller -> application service -> PostgreSQL read model -> DTO serialization',
        externalProvider: false,
      },
      fixture: {
        market: 'BIST',
        activeInstruments: INSTRUMENT_COUNT,
        rankingRows: INSTRUMENT_COUNT,
        generationId: GENERATION_ID,
        dataCutoffAt: CUTOFF.toISOString(),
        symbolDailyBars: SYMBOL_BAR_COUNT,
        chartOverlays: 6,
      },
      scenarios,
    } as const;
    await writeReports(report);
    process.stderr.write('market benchmark: reports written\n');
    for (const result of scenarios) {
      process.stdout.write(
        `${result.id} ${result.passed ? 'PASS' : 'FAIL'} p50=${result.p50Ms}ms p95=${result.p95Ms}ms max=${result.maxMs}ms errors=${result.errorCount}\n`,
      );
    }
    if (report.status === 'FAIL') process.exitCode = 1;
  } finally {
    if (application) await application.close();
    await pool.end();
  }
}

async function benchmarkOverview(baseUrl: string, cache: MarketResponseCache) {
  const coldDurations: number[] = [];
  const warmDurations: number[] = [];
  let errors = 0;
  for (let index = 0; index < 7; index += 1) {
    cache.clear();
    const result = await timedRequest(`${baseUrl}/api/v1/market/overview`);
    if (result.ok) coldDurations.push(result.duration);
    else errors += 1;
  }
  await assertOverview(`${baseUrl}/api/v1/market/overview`);
  for (let index = 0; index < 25; index += 1) {
    const result = await timedRequest(`${baseUrl}/api/v1/market/overview`);
    if (result.ok) warmDurations.push(result.duration);
    else errors += 1;
  }
  const cold = summarize(coldDurations);
  const warm = summarize(warmDurations);
  const threshold = thresholds['PERF-MKT-001'];
  return {
    id: 'PERF-MKT-001',
    name: 'Full BIST market overview over real HTTP/read-model path',
    fixtureSize: `${INSTRUMENT_COUNT} active BIST instruments`,
    cacheState:
      '7 response-cache cold repetitions; 25 response-cache warm repetitions',
    repetitions: { cold: 7, warm: 25 },
    p50Ms: warm.p50Ms,
    p95Ms: warm.p95Ms,
    maxMs: warm.maxMs,
    warm,
    cold,
    errorCount: errors,
    threshold: `warm p95 <= ${threshold.warmP95Ms} ms; cold p95 <= ${threshold.coldP95Ms} ms`,
    passed:
      errors <= threshold.maximumErrors &&
      warm.p95Ms <= threshold.warmP95Ms &&
      cold.p95Ms <= threshold.coldP95Ms,
  };
}

async function benchmarkRanking(baseUrl: string, cache: MarketResponseCache) {
  const durations: number[] = [];
  let errors = 0;
  let duplicateCount = 0;
  let missingCount = 0;
  for (let repetition = 0; repetition < 7; repetition += 1) {
    cache.clear();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const target = new URL(`${baseUrl}/api/v1/market/rankings/gainers`);
      target.searchParams.set(
        'limit',
        String(thresholds['PERF-MKT-002'].pageSize),
      );
      if (cursor) target.searchParams.set('cursor', cursor);
      const started = performance.now();
      try {
        const response = await fetch(target);
        durations.push(performance.now() - started);
        if (!response.ok) {
          errors += 1;
          break;
        }
        const body = (await response.json()) as {
          readonly data: {
            readonly items: readonly { readonly instrumentId: string }[];
          };
          readonly meta: { readonly nextCursor: string | null };
        };
        seen.push(...body.data.items.map(({ instrumentId }) => instrumentId));
        cursor = body.meta.nextCursor;
      } catch {
        errors += 1;
        break;
      }
    } while (cursor);
    duplicateCount += seen.length - new Set(seen).size;
    missingCount += Math.max(0, INSTRUMENT_COUNT - new Set(seen).size);
  }
  const summary = summarize(durations);
  const threshold = thresholds['PERF-MKT-002'];
  return {
    id: 'PERF-MKT-002',
    name: '650-instrument ranking cursor pagination',
    fixtureSize: `${INSTRUMENT_COUNT} ranking rows; page size ${threshold.pageSize}`,
    cacheState:
      'cold first page and warm subsequent traversal pages per repetition',
    repetitions: 7,
    ...summary,
    errorCount: errors,
    duplicateCount,
    missingCount,
    threshold: `p95 <= ${threshold.p95Ms} ms; duplicate = 0; missing = 0`,
    passed:
      errors <= threshold.maximumErrors &&
      summary.p95Ms <= threshold.p95Ms &&
      duplicateCount === 0 &&
      missingCount === 0,
  };
}

async function benchmarkSymbolAggregate(baseUrl: string) {
  const durations: number[] = [];
  let errors = 0;
  for (let repetition = 0; repetition < 12; repetition += 1) {
    const started = performance.now();
    const responses = await Promise.all([
      fetch(`${baseUrl}/api/v1/symbols/B0001`),
      fetch(`${baseUrl}/api/v1/symbols/B0001/quote`),
      fetch(`${baseUrl}/api/v1/symbols/B0001/signals`),
    ]);
    await Promise.all(responses.map((response) => response.arrayBuffer()));
    durations.push(performance.now() - started);
    if (responses.some((response) => !response.ok)) errors += 1;
  }
  const summary = summarize(durations);
  const threshold = thresholds['PERF-MKT-003'];
  return {
    id: 'PERF-MKT-003',
    name: 'Symbol profile, quote, signals and quality metadata',
    fixtureSize: '1 symbol / latest quote / latest pattern signal',
    cacheState: 'database read path; 12 repetitions',
    repetitions: 12,
    ...summary,
    errorCount: errors,
    queryCount: '7 logical read-model queries per aggregate repetition',
    cacheHits: 0,
    cacheMisses: 0,
    threshold: `p95 <= ${threshold.p95Ms} ms`,
    passed:
      errors <= threshold.maximumErrors && summary.p95Ms <= threshold.p95Ms,
  };
}

async function benchmarkChart(baseUrl: string, cache: SymbolResponseCache) {
  const coldDurations: number[] = [];
  const warmDurations: number[] = [];
  let errors = 0;
  let alignmentFailures = 0;
  const target = new URL(`${baseUrl}/api/v1/symbols/B0001/chart`);
  target.searchParams.set('timeframe', '1d');
  target.searchParams.set('from', '2024-07-18T07:00:00.000Z');
  target.searchParams.set('to', '2026-07-18T07:00:00.000Z');
  target.searchParams.set('limit', String(SYMBOL_BAR_COUNT));
  target.searchParams.set(
    'overlays',
    'volume,SMA@1,EMA@1,WMA@1,BOLLINGER_BANDS@1,RSI@1,MACD@1',
  );
  target.searchParams.set('includeCorporateActions', 'true');
  for (let repetition = 0; repetition < 7; repetition += 1) {
    cache.clear();
    const measured = await timedJsonRequest(target);
    if (!measured.ok || !measured.body) errors += 1;
    else alignmentFailures += chartAlignmentFailures(measured.body);
    coldDurations.push(measured.duration);
  }
  for (let repetition = 0; repetition < 20; repetition += 1) {
    const measured = await timedJsonRequest(target);
    if (!measured.ok || !measured.body) errors += 1;
    else alignmentFailures += chartAlignmentFailures(measured.body);
    warmDurations.push(measured.duration);
  }
  const cold = summarize(coldDurations);
  const warm = summarize(warmDurations);
  const threshold = thresholds['PERF-MKT-004'];
  const stats = cache.stats();
  return {
    id: 'PERF-MKT-004',
    name: 'Two-year daily chart with volume, six indicators and corporate action',
    fixtureSize: `${SYMBOL_BAR_COUNT} daily bars / volume + 6 indicators / 1 corporate action`,
    cacheState: '7 cold and 20 warm response-cache repetitions',
    repetitions: { cold: 7, warm: 20 },
    p50Ms: cold.p50Ms,
    p95Ms: cold.p95Ms,
    maxMs: cold.maxMs,
    cold,
    warm,
    errorCount: errors,
    queryCount: '3 logical read-model queries per HTTP request',
    cacheHits: stats.hits,
    cacheMisses: stats.misses,
    alignmentFailures,
    threshold: `cold p95 <= ${threshold.p95Ms} ms; alignment failure = 0`,
    passed:
      errors <= threshold.maximumErrors &&
      cold.p95Ms <= threshold.p95Ms &&
      alignmentFailures === 0,
  };
}

async function seedFixture(db: ReturnType<typeof createDatabase>['db']) {
  const instrumentRows = Array.from(
    { length: INSTRUMENT_COUNT },
    (_, index) => ({
      id: instrumentId(index),
      symbol: `B${String(index + 1).padStart(4, '0')}`,
      normalizedSymbol: `B${String(index + 1).padStart(4, '0')}`,
      name: `BIST Fixture ${index + 1}`,
      marketCode: 'BIST',
      currencyCode: 'TRY',
      status: 'active',
    }),
  );
  for (let offset = 0; offset < instrumentRows.length; offset += 200)
    await db
      .insert(instruments)
      .values(instrumentRows.slice(offset, offset + 200));
  await db.insert(dataProviders).values({
    id: PROVIDER_ID,
    code: 'TASK055_FIXTURE',
    name: 'Task 055 deterministic fixture',
    status: 'active',
  });
  await db.insert(marketOverviewSnapshots).values({
    id: '70000000-0000-4000-8000-000000000002',
    generationId: GENERATION_ID,
    marketCode: 'BIST',
    timeframe: '1d',
    universeVersion: 'bist-active-v1',
    policyVersion: 'market-overview-v1',
    dataCutoffAt: CUTOFF,
    sourceTimestamp: new Date(CUTOFF.getTime() + 60_000),
    status: 'complete',
    payload: {
      indices: [{ code: 'XU100', value: '10123.4500000000' }],
      breadth: { advancers: 330, decliners: 300, unchanged: 20 },
      topLists: { generation: GENERATION_ID },
    },
    evaluatedCount: INSTRUMENT_COUNT,
    excludedCount: 0,
    qualityMetadata: { warnings: [], versions: ['market-overview-v1'] },
  });
  const rankingRows = instrumentRows.map((instrument, index) => ({
    generationId: GENERATION_ID,
    marketCode: 'BIST',
    timeframe: '1d',
    policyVersion: 'market-overview-v1',
    dataCutoffAt: CUTOFF,
    rankingType: 'gainers',
    instrumentId: instrument.id,
    rank: index + 1,
    sortValue: index < 10 ? '1.0000000000' : String(INSTRUMENT_COUNT - index),
    status: 'complete',
    payload: { changePercent: `0.${String(index).padStart(12, '0')}` },
    evaluatedCount: INSTRUMENT_COUNT,
    excludedCount: 0,
    qualityMetadata: {},
  }));
  for (let offset = 0; offset < rankingRows.length; offset += 200)
    await db
      .insert(marketRankSnapshots)
      .values(rankingRows.slice(offset, offset + 200));
  const barStart = new Date('2024-07-18T07:00:00.000Z');
  const barRows = Array.from({ length: SYMBOL_BAR_COUNT }, (_, index) => {
    const openTime = new Date(barStart.getTime() + index * 86_400_000);
    const price = 100 + index / 10;
    return {
      instrumentId: SYMBOL_ID,
      providerId: PROVIDER_ID,
      timeframe: '1d',
      openTime,
      closeTime: new Date(openTime.getTime() + 86_400_000),
      open: price.toFixed(4),
      high: (price + 2).toFixed(4),
      low: (price - 2).toFixed(4),
      close: (price + 1).toFixed(4),
      volume: String(1_000_000 + index * 1_000),
      isClosed: index !== SYMBOL_BAR_COUNT - 1,
      sourceTimestamp: new Date(openTime.getTime() + 86_400_000),
      revision: 1,
      qualityStatus: 'accepted',
    };
  });
  for (let offset = 0; offset < barRows.length; offset += 200)
    await db.insert(priceBars).values(barRows.slice(offset, offset + 200));
  await db.insert(portfolios).values({
    id: '73000000-0000-4000-8000-000000000001',
    userId: '73000000-0000-4000-8000-000000000002',
    name: 'Corporate action fixture',
  });
  await db.insert(portfolioTransactions).values({
    id: '73000000-0000-4000-8000-000000000003',
    portfolioId: '73000000-0000-4000-8000-000000000001',
    instrumentId: SYMBOL_ID,
    type: 'split',
    status: 'posted',
    tradeAt: new Date('2025-07-18T07:00:00.000Z'),
    quantity: '2',
    source: 'corporate_action',
    externalReference: 'B0001:2025-07-18:SPLIT',
    idempotencyKeyHash: 'task055-split-idempotency',
    normalizedTransactionHash: 'task055-split-normalized',
    corporateActionIdentityHash: 'task055-split-identity',
    createdBy: '73000000-0000-4000-8000-000000000002',
    postedAt: new Date('2025-07-18T07:00:00.000Z'),
  });
  await db.insert(patternDefinitions).values({
    code: 'DOUBLE_BOTTOM',
    version: 1,
    algorithmVersion: 'pattern-v1',
    category: 'reversal',
    parameterSchema: {},
    evidenceSchemaVersion: 1,
    status: 'active',
  });
  await db.insert(patternInstances).values({
    id: '73000000-0000-4000-8000-000000000004',
    instrumentId: SYMBOL_ID,
    timeframe: '1d',
    adjustmentMode: 'raw',
    patternCode: 'DOUBLE_BOTTOM',
    patternVersion: 1,
    algorithmVersion: 'pattern-v1',
    state: 'candidate',
    direction: 'bullish',
    startTime: new Date('2026-06-01T07:00:00.000Z'),
    endTime: new Date('2026-06-20T07:00:00.000Z'),
    detectedAt: new Date('2026-06-20T08:00:00.000Z'),
    dataCutoffAt: new Date('2026-06-20T08:00:00.000Z'),
    confidence: '70',
    evidenceVersion: 1,
    evidence: { schemaVersion: 1 },
    deduplicationKey: 'task055-double-bottom',
  });
}

function instrumentId(index: number) {
  return `71000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

async function assertOverview(url: string) {
  const response = await fetch(url);
  const body = (await response.json()) as {
    readonly meta: {
      readonly generationId: string;
      readonly dataCutoffAt: string;
    };
  };
  if (
    !response.ok ||
    body.meta.generationId !== GENERATION_ID ||
    body.meta.dataCutoffAt !== CUTOFF.toISOString()
  )
    throw new Error('Overview response contract failed during benchmark');
}

async function timedRequest(url: string) {
  const started = performance.now();
  try {
    const response = await fetch(url);
    await response.arrayBuffer();
    return { ok: response.ok, duration: performance.now() - started };
  } catch {
    return { ok: false, duration: performance.now() - started };
  }
}

async function timedJsonRequest(url: URL) {
  const started = performance.now();
  try {
    const response = await fetch(url);
    const body = (await response.json()) as Record<string, unknown>;
    return { ok: response.ok, duration: performance.now() - started, body };
  } catch {
    return { ok: false, duration: performance.now() - started, body: null };
  }
}

function chartAlignmentFailures(body: Record<string, unknown>) {
  const data = body['data'] as {
    readonly bars: readonly { readonly time: number }[];
    readonly overlays: readonly {
      readonly points: readonly { readonly time: number }[];
    }[];
    readonly panels: readonly {
      readonly points: readonly { readonly time: number }[];
    }[];
    readonly markers: readonly { readonly time: number }[];
  };
  const axis = new Set(data.bars.map(({ time }) => time));
  return (
    [...data.overlays, ...data.panels]
      .flatMap(({ points }) => points)
      .filter(({ time }) => !axis.has(time)).length +
    data.markers.filter(({ time }) => !axis.has(time)).length
  );
}

function summarize(values: readonly number[]): Summary {
  const ordered = [...values].sort((left, right) => left - right);
  const at = (percentile: number) =>
    ordered[
      Math.min(ordered.length - 1, Math.ceil(ordered.length * percentile) - 1)
    ] ?? Number.POSITIVE_INFINITY;
  return {
    p50Ms: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(ordered.at(-1) ?? Number.POSITIVE_INFINITY),
  };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function assertFixtureContract() {
  if (
    thresholds['PERF-MKT-001'].fixtureInstruments !== INSTRUMENT_COUNT ||
    thresholds['PERF-MKT-002'].fixtureInstruments !== INSTRUMENT_COUNT ||
    thresholds['PERF-MKT-004'].dailyBars !== SYMBOL_BAR_COUNT ||
    thresholds['PERF-MKT-004'].indicatorOverlays !== 6
  )
    throw new Error('Market performance fixture size must remain 650');
}

async function writeReports(report: Record<string, unknown>) {
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  const jsonPath = `${REPORT_DIRECTORY}/market-intelligence-baseline.json`;
  const markdownPath = `${REPORT_DIRECTORY}/market-intelligence-baseline.md`;
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const scenarios = report['scenarios'] as readonly Record<string, unknown>[];
  const overview = scenarios.find((item) => item['id'] === 'PERF-MKT-001');
  const ranking = scenarios.find((item) => item['id'] === 'PERF-MKT-002');
  const symbolAggregate = scenarios.find(
    (item) => item['id'] === 'PERF-MKT-003',
  );
  const chart = scenarios.find((item) => item['id'] === 'PERF-MKT-004');
  const cold = overview?.['cold'] as Record<string, unknown> | undefined;
  const rows = scenarios.map((item) =>
    [
      item['id'],
      item['fixtureSize'],
      item['cacheState'],
      item['p50Ms'],
      item['p95Ms'],
      item['maxMs'],
      item['errorCount'],
      item['threshold'],
      item['passed'] ? 'PASS' : 'FAIL',
    ].join(' | '),
  );
  await writeFile(
    markdownPath,
    [
      `# Market Intelligence Performance Baseline`,
      '',
      `Status: **${String(report['status'])}**`,
      '',
      '| Scenario | Fixture | Cache / repetitions | p50 (ms) | p95 (ms) | max (ms) | Errors | Threshold | Result |',
      '| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
      ...rows,
      '',
      `PERF-MKT-001 cold response-cache: p50 ${String(cold?.['p50Ms'])} ms, p95 ${String(cold?.['p95Ms'])} ms, max ${String(cold?.['maxMs'])} ms.`,
      '',
      `PERF-MKT-002 cursor invariants: duplicate ${String(ranking?.['duplicateCount'])}, missing ${String(ranking?.['missingCount'])}.`,
      '',
      `PERF-MKT-003 queries: ${String(symbolAggregate?.['queryCount'])}; cache hits ${String(symbolAggregate?.['cacheHits'])}, misses ${String(symbolAggregate?.['cacheMisses'])}.`,
      '',
      `PERF-MKT-004 queries: ${String(chart?.['queryCount'])}; cache hits ${String(chart?.['cacheHits'])}, misses ${String(chart?.['cacheMisses'])}; alignment failures ${String(chart?.['alignmentFailures'])}.`,
      '',
      'The benchmark uses the real Nest HTTP controller, application service, PostgreSQL read model, cursor codec, DTO mapping, serialization, and a deterministic local fixture. No external provider is called.',
      '',
    ].join('\n'),
    'utf8',
  );
}

function requireTestDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value || !/_test(?:\?|$)/u.test(value))
    throw new Error(
      'TEST_DATABASE_URL must identify an isolated _test database',
    );
  return value;
}

function command(file: string, args: readonly string[]) {
  return execFileSync(file, [...args], { cwd: ROOT, encoding: 'utf8' }).trim();
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
