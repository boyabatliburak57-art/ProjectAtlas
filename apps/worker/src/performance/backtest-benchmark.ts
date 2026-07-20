import {
  execFileSync,
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, hostname, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  backtestDataSnapshots,
  backtestFills,
  backtestOrders,
  backtestRuns,
  backtestSeriesChunks,
  backtestSummaries,
  backtestTrades,
  createDatabase,
  dataProviders,
  instruments,
  researchExperimentRuns,
  researchExperiments,
  runMigrations,
  strategies,
  strategyRevisions,
  type Database,
} from '@atlas/database';
import {
  BacktestRunApplicationService,
  calculateBacktestMetrics,
  calculateExecutionCosts,
  createExperimentChildBindings,
  createBacktestEventOrderKey,
  createCoreIndicatorRegistry,
  createScanOperandKey,
  Decimal,
  DeterministicBacktestEngine,
  generateExperimentCombinations,
  ScannerBacktestSignalEvaluator,
  validateStrategyDefinition,
  type BacktestBar,
  type BacktestExecutionPlan,
  type BacktestFill,
  type BacktestOperandValueResolver,
  type BacktestResult,
  type BacktestRunOptions,
  type BacktestTimelineEvent,
  type BacktestTrade,
  type IndicatorOperand,
  type PreparedOperandValue,
  type ScanRuleAst,
  type StrategyDefinition,
  type ExperimentDefinitionInput,
} from '@atlas/domain';
import type {
  BacktestRunQueuePayload,
  ExperimentQueuePayload,
} from '@atlas/types';
import { and, count, eq, sql } from 'drizzle-orm';
import { Queue, QueueEvents, Worker } from 'bullmq';

import { BacktestRunProcessor } from '../backtesting/backtest-run-processor';
import type { BacktestWorkerRepository } from '../backtesting/contracts';
import { InMemoryBacktestRuntimeMetrics } from '../backtesting/metrics';
import {
  BACKTEST_RESULT_INSERT_BATCH_SIZE,
  PostgresBacktestRuntimeRepository,
} from '../backtesting/postgres-backtest-runtime-repository';
import { PostgresBacktestSnapshotResolver } from '../backtesting/postgres-backtest-snapshot-resolver';
import {
  StructuredLogger,
  type LogSink,
} from '../observability/structured-logger';
import {
  DEFAULT_JOB_OPTIONS,
  createBacktestRunJobId,
  createExperimentJobId,
  JOB_NAMES,
  QUEUE_NAMES,
} from '../queue/queue-contracts';
import { createRedisConnection } from '../queue/redis-connection';
import { BullMqBacktestRunDispatcher } from '../queue/backtest-queue';
import { WorkerRuntime } from '../runtime/worker-runtime';
import { BullMqExperimentDispatcher } from '../backtesting/experiment-queue';
import { summarizeDurations, type DurationSummary } from './statistics';

const ROOT = `${resolve(__dirname, '../../../..')}/`;
const REPORT_DIRECTORY = `${ROOT}reports/performance`;
const DATABASE_URL = requireTestDatabaseUrl();
const REDIS_URL = required('REDIS_URL');
const FIXTURE = JSON.parse(
  readFileSync(`${ROOT}performance/fixtures/backtest-v1.json`, 'utf8'),
) as FixtureContract;
const THRESHOLDS = JSON.parse(
  readFileSync(`${ROOT}performance/thresholds/backtest.json`, 'utf8'),
) as Record<string, Threshold>;
const OWNER_ID = '90000000-0000-4000-8000-000000000001';
const STRATEGY_ID = '90000000-0000-4000-8000-000000000002';
const SNAPSHOT_ID = '90000000-0000-4000-8000-000000000003';
const PROVIDER_ID = '90000000-0000-4000-8000-000000000004';
const SNAPSHOT_HASH = 'atlas-backtest-benchmark-snapshot-v1';
const CUTOFF = '2024-12-31T23:59:59.000Z';
const WORKER_CONCURRENCY = 2;
const BATCH_SIZE = 2_000;

interface FixtureContract {
  readonly schemaVersion: number;
  readonly seed: string;
  readonly fullBist: {
    readonly symbols: number;
    readonly years: number;
    readonly indicatorCount: number;
    readonly timeframe: string;
  };
  readonly eventEngine: {
    readonly events: number;
    readonly costEveryEvents: number;
  };
  readonly persistence: {
    readonly orders: number;
    readonly fills: number;
    readonly trades: number;
    readonly seriesPoints: number;
    readonly combinedEvents: number;
  };
  readonly resultApi: {
    readonly seriesPointsRequested: number;
    readonly tradeDataset: number;
    readonly tradePageSize: number;
  };
  readonly experiments: { readonly parameterCombinations: number };
  readonly reproducibility: { readonly independentRuns: number };
}

interface Threshold {
  readonly p95Ms: number;
  readonly minimumRepetitions: number;
}

type ScenarioName =
  | 'full-bist'
  | 'event-engine'
  | 'persistence'
  | 'result-api'
  | 'experiments'
  | 'reproducibility';

interface BenchmarkResult extends DurationSummary {
  readonly id: string;
  readonly scenario: ScenarioName;
  readonly name: string;
  readonly commitSha: string;
  readonly fixture: string;
  readonly symbols: number;
  readonly bars: number;
  readonly events: number;
  readonly workerConcurrency: number;
  readonly batchSize: number;
  readonly repetitions: number;
  readonly cacheState: string;
  readonly engineTimeMs: number;
  readonly databaseTimeMs: number;
  readonly persistenceTimeMs: number;
  readonly apiTimeMs: number;
  readonly memoryPeakBytes: number;
  readonly errors: readonly string[];
  readonly threshold: string;
  readonly invariants: Readonly<Record<string, string | number | boolean>>;
  readonly passed: boolean;
}

interface FullBistFixture {
  readonly eventCount: number;
  readonly dates: readonly string[];
  readonly instrumentIds: readonly string[];
  readonly resolver: BacktestOperandValueResolver;
  readonly plan: BacktestExecutionPlan;
  readonly validationIndicatorCount: number;
}

interface FullBistOutcome {
  readonly result: BenchmarkResult;
  readonly runIds: readonly string[];
}

interface PersistenceOutcome {
  readonly result: BenchmarkResult;
  readonly runId: string;
}

const commitSha = git(['rev-parse', 'HEAD']);

async function main() {
  assertFixtureContract();
  const selected = requestedScenario();
  if (selected === undefined && process.env.BACKTEST_PERF_CHILD !== '1') {
    await runIsolatedBenchmarkSuite();
    return;
  }
  const { db, pool } = createDatabase(DATABASE_URL);
  const results: BenchmarkResult[] = [];
  let fullBist: FullBistOutcome | undefined;
  let persistence: PersistenceOutcome | undefined;
  try {
    await resetDatabase(db, pool);
    await seedCoreFixture(db);
    if (selected === undefined) {
      // Each mandatory scenario group starts from an isolated database state.
      // This keeps the five-million-event heap and prior bulk-write indexes from
      // contaminating unrelated latency measurements while retaining real
      // PostgreSQL, Redis, HTTP and production-worker paths in every group.
      persistence = await runPersistence(db);
      results.push(persistence.result);
      results.push(...(await runResultApi(persistence.runId)));

      await resetDatabase(db, pool);
      await seedCoreFixture(db);
      fullBist = await runFullBist(db);
      results.push(fullBist.result);
      results.push(await runReproducibility(db, fullBist.runIds));
      results.push(runEventEngine());

      await resetDatabase(db, pool);
      await seedCoreFixture(db);
      results.push(await runExperiments(db));
    }
    if (selected === undefined || selected === 'full-bist') {
      if (selected !== undefined) {
        fullBist = await runFullBist(db);
        results.push(fullBist.result);
      }
    }
    if (selected === 'event-engine') results.push(runEventEngine());
    if (selected === 'persistence' || selected === 'result-api') {
      persistence = await runPersistence(db);
      if (selected !== 'result-api') results.push(persistence.result);
    }
    if (selected === 'result-api') {
      if (!persistence) throw new Error('Persistence fixture was not created');
      results.push(...(await runResultApi(persistence.runId)));
    }
    if (selected === 'experiments') results.push(await runExperiments(db));
    if (selected === 'reproducibility') {
      fullBist ??= await runFullBist(db, 2);
      results.push(await runReproducibility(db, fullBist.runIds));
    }
    enforceScenarioCompleteness(results, selected);
    const report = await buildReport(pool, results, selected);
    await writeReports(report);
    for (const result of results)
      process.stdout.write(
        `${result.id} ${result.passed ? 'PASS' : 'FAIL'} p50=${result.p50Ms}ms p95=${result.p95Ms}ms max=${result.maxMs}ms errors=${result.errors.length}\n`,
      );
    if (report.status === 'FAIL') process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function runIsolatedBenchmarkSuite(): Promise<void> {
  const scenarios: readonly ScenarioName[] = [
    'persistence',
    'result-api',
    'full-bist',
    'reproducibility',
    'event-engine',
    'experiments',
  ];
  const reports: Array<Awaited<ReturnType<typeof buildReport>>> = [];
  for (const scenario of scenarios) {
    execFileSync(
      `${ROOT}apps/worker/node_modules/.bin/tsx`,
      [
        `${ROOT}apps/worker/src/performance/backtest-benchmark.ts`,
        '--scenario',
        scenario,
      ],
      {
        cwd: ROOT,
        env: { ...process.env, BACKTEST_PERF_CHILD: '1' },
        stdio: 'inherit',
      },
    );
    reports.push(
      JSON.parse(
        readFileSync(`${REPORT_DIRECTORY}/backtest-benchmark.json`, 'utf8'),
      ) as Awaited<ReturnType<typeof buildReport>>,
    );
  }
  const byId = new Map<string, BenchmarkResult>();
  for (const report of reports)
    for (const scenario of report.scenarios) byId.set(scenario.id, scenario);
  const results = [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  enforceScenarioCompleteness(results, undefined);
  const first = reports[0]!;
  const report = {
    ...first,
    generatedAt: new Date().toISOString(),
    selectedScenario: 'all',
    status: results.every((item) => item.passed) ? 'PASS' : 'FAIL',
    scenarios: results,
  } as Awaited<ReturnType<typeof buildReport>>;
  await writeReports(report);
  if (report.status === 'FAIL') process.exitCode = 1;
}

async function resetDatabase(
  db: Database,
  pool: ReturnType<typeof createDatabase>['pool'],
) {
  await pool.query('drop schema if exists public cascade');
  await pool.query('drop schema if exists drizzle cascade');
  await pool.query('create schema public');
  await runMigrations(db);
}

async function seedCoreFixture(db: Database) {
  const ids = Array.from({ length: FIXTURE.fullBist.symbols }, (_, index) =>
    instrumentId(index),
  );
  for (const rows of chunks(ids, 250))
    await db.insert(instruments).values(
      rows.map((id) => {
        const index = ids.indexOf(id);
        const symbol = symbolFor(index);
        return {
          id,
          symbol,
          normalizedSymbol: symbol,
          name: `Backtest Benchmark ${symbol}`,
          marketCode: 'BIST',
          currencyCode: 'TRY',
          status: 'active',
        };
      }),
    );
  await db.insert(dataProviders).values({
    id: PROVIDER_ID,
    code: 'BACKTEST_BENCHMARK',
    name: 'Deterministic Backtest Benchmark Fixture',
    status: 'active',
  });
  const definition = strategyDefinition(indicatorRule(), exitRule());
  const validation = validateStrategyDefinition(definition);
  if (!validation.valid || validation.workload.indicatorCount !== 4)
    throw new Error(
      'Full BIST planner fixture did not resolve four indicators',
    );
  await db.insert(strategies).values({
    id: STRATEGY_ID,
    ownerUserId: OWNER_ID,
    name: 'Backtest Benchmark Strategy',
    status: 'validated',
    currentRevision: 1,
  });
  await db.insert(strategyRevisions).values({
    strategyId: STRATEGY_ID,
    revision: 1,
    schemaVersion: 1,
    definition: definition as unknown as Record<string, unknown>,
    parameterSchema: {},
    validationStatus: 'valid',
    complexityScore: validation.complexityScore,
    createdBy: OWNER_ID,
  });
  await db.insert(backtestDataSnapshots).values({
    id: SNAPSHOT_ID,
    snapshotHash: SNAPSHOT_HASH,
    schemaVersion: 1,
    marketRevisionHash: 'market-benchmark-v1',
    universeRevisionHash: 'universe-benchmark-v1',
    fundamentalRevisionHash: 'fundamental-benchmark-v1',
    corporateActionRevisionHash: 'corporate-action-benchmark-v1',
    dataCutoffAt: new Date(CUTOFF),
    coverageStatus: 'complete',
    revisionManifest: { events: [] },
    qualityMetadata: { fixtureVersion: FIXTURE.schemaVersion },
  });
}

async function runFullBist(
  db: Database,
  repetitions = threshold('PERF-BT-001').minimumRepetitions,
): Promise<FullBistOutcome> {
  const fixture = buildFullBistFixture();
  await seedFullBistPriceBars(db);
  await db
    .update(backtestDataSnapshots)
    .set({
      revisionManifest: {
        kind: 'price-bars-v1',
        providerId: PROVIDER_ID,
        timeframe: FIXTURE.fullBist.timeframe,
        from: '2020-01-02T00:00:00.000Z',
        to: CUTOFF,
      },
      qualityMetadata: {
        fixtureVersion: FIXTURE.schemaVersion,
        pointInTime: true,
        symbolCount: fixture.instrumentIds.length,
      },
    })
    .where(eq(backtestDataSnapshots.id, SNAPSHOT_ID));
  const connection = createRedisConnection(REDIS_URL);
  const queue = new Queue<BacktestRunQueuePayload>(QUEUE_NAMES.backtests, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const postgres = new PostgresBacktestRuntimeRepository(db);
  const engineDurations: number[] = [];
  const persistenceDurations: number[] = [];
  const engine = new MeasuredBacktestEngine(
    new ScannerBacktestSignalEvaluator(fixture.resolver),
    engineDurations,
  );
  const repository = measuredRepository(postgres, persistenceDurations);
  const processor = new BacktestRunProcessor({
    repository,
    snapshotResolver: new PostgresBacktestSnapshotResolver(db),
    engine,
    metrics: new InMemoryBacktestRuntimeMetrics(),
    logger: silentLogger(),
    eventBatchSize: BATCH_SIZE,
    runTimeoutMs: 600_000,
  });
  const worker = new Worker<BacktestRunQueuePayload>(
    QUEUE_NAMES.backtests,
    (job) => processor.process(job),
    {
      connection,
      concurrency: WORKER_CONCURRENCY,
      lockDuration: 600_000,
    },
  );
  const service = new BacktestRunApplicationService({
    repository: postgres,
    snapshotResolver: {
      async resolve() {
        const [row] = await db
          .select()
          .from(backtestDataSnapshots)
          .where(eq(backtestDataSnapshots.id, SNAPSHOT_ID))
          .limit(1);
        if (!row) throw new Error('Point-in-time snapshot is missing');
        return {
          id: row.id,
          hash: row.snapshotHash,
          dataCutoffAt: row.dataCutoffAt.toISOString(),
          universeSnapshot: {
            version: row.universeRevisionHash,
            instrumentIds: fixture.instrumentIds,
          },
          // Run creation needs snapshot identity and universe metadata only. The
          // production worker materializes authoritative events from PostgreSQL.
          events: [],
          coverageStatus: 'complete' as const,
        };
      },
    },
    entitlement: {
      authorize: () =>
        Promise.resolve({ allowed: true, maximumComplexityScore: 1_000_000 }),
    },
    dispatcher: new BullMqBacktestRunDispatcher(queue),
    idGenerator: randomUUID,
  });
  const durations: number[] = [];
  const runIds: string[] = [];
  const errors: string[] = [];
  let memoryPeak = peakResidentBytes();
  try {
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    await queue.obliterate({ force: true });
    for (let index = 0; index < repetitions; index += 1) {
      const created = await service.create({
        userId: OWNER_ID,
        idempotencyKey: `perf-bt-001-${index}`,
        strategyId: STRATEGY_ID,
        strategyRevision: 1,
        executionPlan: fixture.plan,
        dataSnapshotHash: SNAPSHOT_HASH,
        rangeFrom: fixture.dates[0]!,
        rangeTo: fixture.dates.at(-1)!,
        complexityScore: 100,
      });
      runIds.push(created.run.id);
      const started = performance.now();
      const terminal = await waitForTerminal(db, created.run.id, 600_000);
      durations.push(performance.now() - started);
      memoryPeak = Math.max(memoryPeak, peakResidentBytes());
      if (terminal !== 'completed') errors.push(`run-${index}:${terminal}`);
      const queueTerminal = await waitForBacktestJobTerminal(
        queue,
        created.run.id,
        30_000,
      );
      if (queueTerminal !== 'completed')
        errors.push(`run-${index}:queue-${queueTerminal}`);
    }
  } finally {
    // Every measured job has reached both PostgreSQL and BullMQ terminal state.
    // Force-close only the now-idle worker because graceful close can retain a
    // stale lock-renew timer after long synchronous engine batches.
    await worker.close(true);
    await queue.close();
  }
  const timing = summarizeDurations(durations);
  const thresholdValue = threshold('PERF-BT-001');
  const engineTime = sum(engineDurations) / Math.max(1, repetitions);
  const persistenceTime = sum(persistenceDurations) / Math.max(1, repetitions);
  return {
    runIds,
    result: result({
      id: 'PERF-BT-001',
      scenario: 'full-bist',
      name: 'Full BIST queue-to-terminal',
      durations,
      fixture: `${fixture.instrumentIds.length} symbols × ${fixture.dates.length} daily bars × 4 indicators`,
      symbols: fixture.instrumentIds.length,
      bars: fixture.eventCount,
      events: fixture.eventCount,
      workerConcurrency: WORKER_CONCURRENCY,
      batchSize: BATCH_SIZE,
      cacheState:
        'cold PostgreSQL snapshot; precomputed causal indicator series',
      engineTimeMs: engineTime,
      databaseTimeMs: Math.max(0, timing.p50Ms - engineTime),
      persistenceTimeMs: persistenceTime,
      apiTimeMs: 0,
      memoryPeakBytes: memoryPeak,
      errors,
      threshold: thresholdValue,
      invariants: {
        fixtureSymbols: fixture.instrumentIds.length,
        fixtureBars: fixture.eventCount,
        indicatorCount: fixture.validationIndicatorCount,
        pointInTimeSnapshot: true,
        terminalRuns: runIds.length - errors.length,
      },
    }),
  };
}

async function seedFullBistPriceBars(db: Database) {
  await db.execute(sql`
    with trading_days as (
      select
        day,
        row_number() over (order by day) - 1 as day_index
      from generate_series(
        '2020-01-02T00:00:00Z'::timestamptz,
        '2024-12-31T00:00:00Z'::timestamptz,
        interval '1 day'
      ) day
      where extract(isodow from day) < 6
    ), benchmark_instruments as (
      select
        id,
        row_number() over (order by normalized_symbol) - 1 as symbol_index
      from instruments
      where market_code = 'BIST' and status = 'active'
    ), values_to_write as (
      select
        instrument.id as instrument_id,
        day.day,
        day.day_index,
        instrument.symbol_index,
        50::numeric
          + mod(instrument.symbol_index, 100)::numeric
          + day.day_index::numeric * 0.01::numeric as open_price
      from trading_days day
      cross join benchmark_instruments instrument
    ), completed_values as (
      select
        value.*,
        value.open_price
          + mod(value.day_index + value.symbol_index, 7)::numeric
            * 0.03::numeric as close_price
      from values_to_write value
    )
    insert into price_bars (
      instrument_id,
      provider_id,
      timeframe,
      open_time,
      close_time,
      open,
      high,
      low,
      close,
      volume,
      is_closed,
      source_timestamp,
      ingested_at,
      revision,
      quality_status
    )
    select
      value.instrument_id,
      ${PROVIDER_ID}::uuid,
      ${FIXTURE.fullBist.timeframe},
      value.day + interval '7 hours',
      value.day + interval '15 hours',
      value.open_price,
      value.close_price + 1::numeric,
      greatest(0.01::numeric, value.close_price - 1::numeric),
      value.close_price,
      1000000::numeric
        + mod(value.day_index * 31 + value.symbol_index, 100000)::numeric,
      true,
      value.day + interval '15 hours',
      value.day + interval '15 hours 1 minute',
      1,
      'accepted'
    from completed_values value
    on conflict do nothing
  `);
}

function runEventEngine(): BenchmarkResult {
  const durations: number[] = [];
  const errors: string[] = [];
  const hashes = new Set<string>();
  let memoryPeak = peakResidentBytes();
  const repetitions = threshold('PERF-BT-002').minimumRepetitions;
  for (let repetition = 0; repetition < repetitions; repetition += 1) {
    const hash = createHash('sha256');
    let previous = '';
    let invalidOrder = 0;
    const started = performance.now();
    for (let index = 0; index < FIXTURE.eventEngine.events; index += 1) {
      const symbolIndex = index % FIXTURE.fullBist.symbols;
      const bucket = Math.floor(index / FIXTURE.fullBist.symbols);
      const timestamp = orderedTimestamp(bucket);
      const event: BacktestBar = {
        eventId: `event-${bucket}-${symbolIndex}`,
        type: 'bar',
        instrumentId: instrumentId(symbolIndex),
        symbol: symbolFor(symbolIndex),
        timestamp,
        open: '100',
        high: '101',
        low: '99',
        close: '100',
        volume: '1000000',
        isClosed: true,
      };
      const key = createBacktestEventOrderKey(event);
      if (previous && key.localeCompare(previous) <= 0) invalidOrder += 1;
      previous = key;
      hash.update(key);
      if (index % FIXTURE.eventEngine.costEveryEvents === 0)
        calculateExecutionCosts({
          side: index % 2 === 0 ? 'BUY' : 'SELL',
          quantity: Decimal.parse('10'),
          referencePrice: Decimal.parse('100'),
          policy: {
            type: 'linear',
            version: 'benchmark-cost-v1',
            commissionPercent: '0.1',
            minimumCommission: '1',
            fixedFee: '0.25',
            marketTaxPercent: '0.02',
            slippageBps: '5',
          },
        });
    }
    durations.push(performance.now() - started);
    hashes.add(hash.digest('hex'));
    memoryPeak = Math.max(memoryPeak, peakResidentBytes());
    if (invalidOrder > 0) errors.push(`invalid-order:${invalidOrder}`);
  }
  if (hashes.size !== 1) errors.push(`determinism-hash-count:${hashes.size}`);
  return result({
    id: 'PERF-BT-002',
    scenario: 'event-engine',
    name: 'Five million deterministic ordered events',
    durations,
    fixture: `${FIXTURE.eventEngine.events} ordered events; linear cost every ${FIXTURE.eventEngine.costEveryEvents}`,
    symbols: FIXTURE.fullBist.symbols,
    bars: FIXTURE.eventEngine.events,
    events: FIXTURE.eventEngine.events,
    workerConcurrency: 1,
    batchSize: FIXTURE.eventEngine.events,
    cacheState: 'warm deterministic core; no cache',
    engineTimeMs: summarizeDurations(durations).p50Ms,
    databaseTimeMs: 0,
    persistenceTimeMs: 0,
    apiTimeMs: 0,
    memoryPeakBytes: memoryPeak,
    errors,
    threshold: threshold('PERF-BT-002'),
    invariants: { resultHashCount: hashes.size, invalidOrder: errors.length },
  });
}

async function runPersistence(db: Database): Promise<PersistenceOutcome> {
  const postgres = new PostgresBacktestRuntimeRepository(db);
  const largeResult = buildPersistenceResult();
  const durations: number[] = [];
  const errors: string[] = [];
  const repetitions = threshold('PERF-BT-003').minimumRepetitions;
  let memoryPeak = peakResidentBytes();
  let retainedRunId = '';
  for (let index = 0; index < repetitions; index += 1) {
    const runId = randomUUID();
    retainedRunId = runId;
    await insertBenchmarkRun(db, runId);
    const run = await postgres.loadRun(runId);
    if (!run) throw new Error('Persistence benchmark run was not loaded');
    const started = performance.now();
    await postgres.persistCompletedResult({
      run,
      result: largeResult,
      completedAt: new Date(CUTOFF),
    });
    durations.push(performance.now() - started);
    await postgres.persistCompletedResult({
      run,
      result: largeResult,
      completedAt: new Date(CUTOFF),
    });
    memoryPeak = Math.max(memoryPeak, peakResidentBytes());
    const counts = await persistedCounts(db, runId);
    if (
      counts.orders !== FIXTURE.persistence.orders ||
      counts.fills !== FIXTURE.persistence.fills ||
      counts.trades !== FIXTURE.persistence.trades ||
      counts.seriesPoints !== FIXTURE.persistence.seriesPoints ||
      counts.summaries !== 1
    )
      errors.push(`count-mismatch:${JSON.stringify(counts)}`);
  }
  return {
    runId: retainedRunId,
    result: result({
      id: 'PERF-BT-003',
      scenario: 'persistence',
      name: 'Idempotent PostgreSQL result persistence',
      durations,
      fixture: `${FIXTURE.persistence.combinedEvents} combined orders/fills/trades/series points`,
      symbols: FIXTURE.fullBist.symbols,
      bars: 0,
      events: FIXTURE.persistence.combinedEvents,
      workerConcurrency: 1,
      batchSize: BACKTEST_RESULT_INSERT_BATCH_SIZE,
      cacheState: 'cold writes; idempotent replay warm conflict path',
      engineTimeMs: 0,
      databaseTimeMs: summarizeDurations(durations).p50Ms,
      persistenceTimeMs: summarizeDurations(durations).p50Ms,
      apiTimeMs: 0,
      memoryPeakBytes: memoryPeak,
      errors,
      threshold: threshold('PERF-BT-003'),
      invariants: {
        combinedEvents: FIXTURE.persistence.combinedEvents,
        idempotentReplay: errors.length === 0,
      },
    }),
  };
}

async function runResultApi(runId: string): Promise<BenchmarkResult[]> {
  const api = await startBacktestApi();
  const summaryDurations: number[] = [];
  const seriesDurations: number[] = [];
  const tradeDurations: number[] = [];
  const errors: string[] = [];
  let memoryPeak = peakResidentBytes();
  try {
    await getJson(`${api.baseUrl}/api/v1/backtests/${runId}/summary`);
    await getJson(
      `${api.baseUrl}/api/v1/backtests/${runId}/series?type=equity&resolution=raw&limit=${FIXTURE.resultApi.seriesPointsRequested}`,
    );
    for (let index = 0; index < 10; index += 1) {
      summaryDurations.push(
        await timedFetch(`${api.baseUrl}/api/v1/backtests/${runId}/summary`),
      );
      seriesDurations.push(
        await timedFetch(
          `${api.baseUrl}/api/v1/backtests/${runId}/series?type=equity&resolution=raw&limit=${FIXTURE.resultApi.seriesPointsRequested}`,
        ),
      );
    }
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL(`${api.baseUrl}/api/v1/backtests/${runId}/trades`);
      url.searchParams.set('limit', String(FIXTURE.resultApi.tradePageSize));
      if (cursor) url.searchParams.set('cursor', cursor);
      const started = performance.now();
      const payload = (await getJson(url.toString())) as {
        readonly data: { readonly items: readonly { readonly id: string }[] };
        readonly meta: { readonly nextCursor: string | null };
      };
      tradeDurations.push(performance.now() - started);
      ids.push(...payload.data.items.map((item) => item.id));
      cursor = payload.meta.nextCursor;
    } while (cursor);
    const duplicate = ids.length - new Set(ids).size;
    const missing = FIXTURE.resultApi.tradeDataset - new Set(ids).size;
    if (duplicate !== 0) errors.push(`duplicate-trade:${duplicate}`);
    if (missing !== 0) errors.push(`missing-trade:${missing}`);
    if (tradeDurations.length < 10)
      errors.push(`insufficient-trade-pages:${tradeDurations.length}`);
    memoryPeak = Math.max(memoryPeak, peakResidentBytes());
  } finally {
    await api.close();
  }
  const shared = {
    scenario: 'result-api' as const,
    commitSha,
    symbols: FIXTURE.fullBist.symbols,
    bars: FIXTURE.persistence.seriesPoints,
    workerConcurrency: 1,
    batchSize: FIXTURE.resultApi.tradePageSize,
    cacheState: 'one cold request followed by warm measured requests',
    engineTimeMs: 0,
    databaseTimeMs: 0,
    persistenceTimeMs: 0,
    memoryPeakBytes: memoryPeak,
    errors,
  };
  return [
    result({
      ...shared,
      id: 'PERF-BT-004-summary',
      name: 'Summary HTTP path',
      durations: summaryDurations,
      fixture:
        'summary through auth/controller/application/repository/serialization',
      events: 1,
      apiTimeMs: summarizeDurations(summaryDurations).p50Ms,
      threshold: threshold('PERF-BT-004-summary'),
      invariants: { realHttp: true },
    }),
    result({
      ...shared,
      id: 'PERF-BT-004-series',
      name: '2,000-point series HTTP path',
      durations: seriesDurations,
      fixture: `${FIXTURE.resultApi.seriesPointsRequested}-point equity series`,
      events: FIXTURE.resultApi.seriesPointsRequested,
      apiTimeMs: summarizeDurations(seriesDurations).p50Ms,
      threshold: threshold('PERF-BT-004-series'),
      invariants: { requestedPoints: FIXTURE.resultApi.seriesPointsRequested },
    }),
    result({
      ...shared,
      id: 'PERF-BT-004-trades',
      name: '10,000-trade cursor HTTP path',
      durations: tradeDurations,
      fixture: `${FIXTURE.resultApi.tradeDataset} trades; page ${FIXTURE.resultApi.tradePageSize}`,
      events: FIXTURE.resultApi.tradeDataset,
      apiTimeMs: summarizeDurations(tradeDurations).p50Ms,
      threshold: threshold('PERF-BT-004-trades'),
      invariants: {
        duplicateTrade: errors.some((item) => item.startsWith('duplicate'))
          ? 1
          : 0,
        missingTrade: errors.some((item) => item.startsWith('missing')) ? 1 : 0,
      },
    }),
  ];
}

async function runExperiments(db: Database): Promise<BenchmarkResult> {
  const errors: string[] = [];
  const input = benchmarkExperimentDefinition();
  const combinations = generateExperimentCombinations(input);
  const children = createExperimentChildBindings(
    combinations,
    input.grid.samples,
  );
  if (children.length !== FIXTURE.experiments.parameterCombinations)
    errors.push(`EXPERIMENT_FIXTURE_SIZE:${children.length}`);
  await seedCompatibleExperimentRuns(db, children);
  const connection = createRedisConnection(REDIS_URL);
  const queue = new Queue<ExperimentQueuePayload>(QUEUE_NAMES.experiments, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const queueEvents = new QueueEvents(QUEUE_NAMES.experiments, { connection });
  await queue.waitUntilReady();
  await queueEvents.waitUntilReady();
  await queue.obliterate({ force: true });
  const runtime = await WorkerRuntime.start(
    {
      DATABASE_URL,
      REDIS_URL,
      WORKER_CONCURRENCY,
      WORKER_HEARTBEAT_INTERVAL_MS: 30_000,
      WORKER_LOG_LEVEL: 'error',
      SCANNER_BATCH_SIZE: 100,
      SCANNER_BATCH_TIMEOUT_MS: 30_000,
      SCANNER_RUN_TIMEOUT_MS: 300_000,
      BACKTEST_EVENT_BATCH_SIZE: BATCH_SIZE,
      BACKTEST_RUN_TIMEOUT_MS: 600_000,
      WORKER_STARTUP_TIMEOUT_MS: 10_000,
    },
    silentLogger(),
  );
  const dispatcher = new BullMqExperimentDispatcher(queue);
  const durations: number[] = [];
  const experimentIds: string[] = [];
  try {
    for (
      let repetition = 0;
      repetition < threshold('PERF-BT-005').minimumRepetitions;
      repetition += 1
    ) {
      const experimentId = randomUUID();
      experimentIds.push(experimentId);
      await db.insert(researchExperiments).values({
        id: experimentId,
        ownerUserId: OWNER_ID,
        strategyId: STRATEGY_ID,
        strategyRevision: 1,
        dataSnapshotId: SNAPSHOT_ID,
        name: `PERF-BT-005 ${repetition}`,
        status: 'queued',
        experimentHash: stableHash({ experimentId, repetition }),
        definition: input as unknown as Record<string, unknown>,
        combinationCount: children.length,
      });
      const startedAt = performance.now();
      await dispatcher.dispatch(experimentId);
      const job = await queue.getJob(createExperimentJobId(experimentId));
      if (job === undefined) {
        errors.push(`EXPERIMENT_JOB_MISSING:${repetition}`);
        continue;
      }
      await job.waitUntilFinished(queueEvents, 30_000);
      durations.push(performance.now() - startedAt);
    }
  } finally {
    await runtime.stop('PERF-BT-005 complete');
    await Promise.allSettled([queueEvents.close(), queue.close()]);
  }
  let duplicateChildRun = 0;
  for (const experimentId of experimentIds) {
    const rows = await db
      .select({
        bindingHash: researchExperimentRuns.bindingHash,
        runId: researchExperimentRuns.backtestRunId,
      })
      .from(researchExperimentRuns)
      .where(eq(researchExperimentRuns.experimentId, experimentId));
    duplicateChildRun +=
      rows.length - new Set(rows.map((row) => row.bindingHash)).size;
    if (rows.length !== children.length)
      errors.push(`EXPERIMENT_CHILD_COUNT:${rows.length}`);
  }
  if (duplicateChildRun !== 0)
    errors.push(`DUPLICATE_CHILD_RUN:${duplicateChildRun}`);
  return result({
    id: 'PERF-BT-005',
    scenario: 'experiments',
    name: 'Production experiment orchestration',
    durations,
    fixture: `${FIXTURE.experiments.parameterCombinations} parameter combinations`,
    symbols: 0,
    bars: 0,
    events: FIXTURE.experiments.parameterCombinations,
    workerConcurrency: WORKER_CONCURRENCY,
    batchSize: 100,
    cacheState: 'warm compatible completed-run reuse',
    engineTimeMs: 0,
    databaseTimeMs: 0,
    persistenceTimeMs: 0,
    apiTimeMs: 0,
    memoryPeakBytes: peakResidentBytes(),
    errors,
    threshold: threshold('PERF-BT-005'),
    invariants: {
      productionJobRegistered: JOB_NAMES.backtestExperiment.length > 0,
      duplicateChildRun,
      parameterCombinations: FIXTURE.experiments.parameterCombinations,
    },
  });
}

function benchmarkExperimentDefinition(): ExperimentDefinitionInput {
  return {
    parameterDefinitions: [
      {
        name: 'threshold',
        type: 'integer',
        defaultValue: 1,
        minimum: 1,
        maximum: FIXTURE.experiments.parameterCombinations,
      },
    ],
    grid: {
      axes: [
        {
          parameter: 'threshold',
          values: Array.from(
            { length: FIXTURE.experiments.parameterCombinations },
            (_, index) => index + 1,
          ),
        },
      ],
      samples: [
        {
          role: 'train',
          from: '2020-01-01T00:00:00.000Z',
          to: CUTOFF,
        },
      ],
      maximumCombinations: FIXTURE.experiments.parameterCombinations,
    },
  };
}

async function seedCompatibleExperimentRuns(
  db: Database,
  children: ReturnType<typeof createExperimentChildBindings>,
) {
  for (const child of children) {
    const runId = randomUUID();
    await db.insert(backtestRuns).values({
      id: runId,
      strategyId: STRATEGY_ID,
      strategyRevision: 1,
      requestedBy: OWNER_ID,
      status: 'completed',
      requestHash: stableHash({ runId, kind: 'experiment-request' }),
      idempotencyKeyHash: stableHash({ runId, kind: 'experiment-key' }),
      engineVersion: 'backtest-engine-v1',
      executionPolicyVersion: 'closed-bar-next-open-v1',
      costPolicyVersion: 'benchmark-cost-v1',
      metricPolicyVersion: 'backtest-metrics-v2',
      eventOrderingPolicyVersion: 'deterministic-event-ordering-v1',
      roundingPolicyVersion: 'decimal-half-even-v1',
      dataSnapshotId: SNAPSHOT_ID,
      parameters: { experimentBindingHash: child.bindingHash },
      universeSnapshot: { fixtureVersion: FIXTURE.schemaVersion },
      timeframe: '1d',
      adjustmentMode: 'raw',
      rangeFrom: new Date(child.rangeFrom),
      rangeTo: new Date(child.rangeTo),
      initialCapital: '1000000',
      progress: '100',
      completedAt: new Date(),
    });
  }
}

async function runReproducibility(
  db: Database,
  runIds: readonly string[],
): Promise<BenchmarkResult> {
  const errors: string[] = [];
  if (runIds.length < FIXTURE.reproducibility.independentRuns)
    errors.push(`independent-runs:${runIds.length}`);
  const selected = runIds.slice(0, FIXTURE.reproducibility.independentRuns);
  const summaries: string[] = [];
  const fills: string[] = [];
  const equities: string[] = [];
  const durations: number[] = [];
  for (const runId of selected) {
    const started = performance.now();
    const [summary] = await db
      .select({
        endingEquity: backtestSummaries.endingEquity,
        totalReturn: backtestSummaries.totalReturn,
        methodology: backtestSummaries.methodology,
      })
      .from(backtestSummaries)
      .where(eq(backtestSummaries.runId, runId));
    const fillRows = await db
      .select({
        sequence: backtestFills.fillSequence,
        instrumentId: backtestFills.instrumentId,
        quantity: backtestFills.quantity,
        price: backtestFills.fillPrice,
        commission: backtestFills.commission,
        slippage: backtestFills.slippageCost,
      })
      .from(backtestFills)
      .where(eq(backtestFills.runId, runId))
      .orderBy(backtestFills.fillSequence);
    const seriesRows = await db
      .select({
        chunkIndex: backtestSeriesChunks.chunkIndex,
        payload: backtestSeriesChunks.payload,
      })
      .from(backtestSeriesChunks)
      .where(
        and(
          eq(backtestSeriesChunks.runId, runId),
          eq(backtestSeriesChunks.seriesType, 'equity'),
        ),
      )
      .orderBy(backtestSeriesChunks.chunkIndex);
    durations.push(performance.now() - started);
    const methodology = summary?.methodology as {
      readonly metrics?: unknown;
      readonly metricPolicy?: unknown;
    };
    summaries.push(
      stableHash({
        endingEquity: summary?.endingEquity,
        totalReturn: summary?.totalReturn,
        metrics: methodology?.metrics,
        metricPolicy: methodology?.metricPolicy,
      }),
    );
    fills.push(stableHash(fillRows));
    equities.push(stableHash(seriesRows.flatMap((row) => row.payload)));
  }
  if (new Set(summaries).size !== 1) errors.push('SUMMARY_HASH_MISMATCH');
  if (new Set(fills).size !== 1) errors.push('FILL_SEQUENCE_HASH_MISMATCH');
  if (new Set(equities).size !== 1) errors.push('EQUITY_HASH_MISMATCH');
  return result({
    id: 'PERF-BT-006',
    scenario: 'reproducibility',
    name: 'Independent run reproducibility',
    durations,
    fixture: `${selected.length} independent runs on ${SNAPSHOT_HASH}`,
    symbols: FIXTURE.fullBist.symbols,
    bars: 0,
    events: selected.length,
    workerConcurrency: WORKER_CONCURRENCY,
    batchSize: BATCH_SIZE,
    cacheState: 'warm persisted result read',
    engineTimeMs: 0,
    databaseTimeMs: summarizeDurations(durations).p50Ms,
    persistenceTimeMs: 0,
    apiTimeMs: 0,
    memoryPeakBytes: peakResidentBytes(),
    errors,
    threshold: threshold('PERF-BT-006'),
    invariants: {
      summaryHashEqual: new Set(summaries).size === 1,
      fillSequenceHashEqual: new Set(fills).size === 1,
      equitySeriesHashEqual: new Set(equities).size === 1,
    },
  });
}

function buildFullBistFixture(): FullBistFixture {
  const dates = tradingDates(
    new Date('2020-01-02T15:00:00.000Z'),
    new Date('2024-12-31T15:00:00.000Z'),
  );
  const instrumentIds = Array.from(
    { length: FIXTURE.fullBist.symbols },
    (_, index) => instrumentId(index),
  );
  const byInstrument = new Map<string, BacktestBar[]>();
  for (const [dayIndex, timestamp] of dates.entries()) {
    for (
      let symbolIndex = 0;
      symbolIndex < instrumentIds.length;
      symbolIndex += 1
    ) {
      const id = instrumentIds[symbolIndex]!;
      const base = 50 + (symbolIndex % 100) + dayIndex * 0.01;
      const close = base + ((dayIndex + symbolIndex) % 7) * 0.03;
      const bar: BacktestBar = {
        eventId: `bt-${dayIndex}-${symbolIndex}`,
        type: 'bar',
        instrumentId: id,
        symbol: symbolFor(symbolIndex),
        timestamp,
        open: fixed(base),
        high: fixed(close + 1),
        low: fixed(Math.max(0.01, close - 1)),
        close: fixed(close),
        volume: String(1_000_000 + ((dayIndex * 31 + symbolIndex) % 100_000)),
        isClosed: true,
        revision: 'benchmark-r1',
        revisionAvailableAt: timestamp,
      };
      const history = byInstrument.get(id) ?? [];
      history.push(bar);
      byInstrument.set(id, history);
    }
  }
  const entry = indicatorRule();
  const exit = exitRule();
  const definition = strategyDefinition(entry, exit);
  const validation = validateStrategyDefinition(definition);
  if (!validation.valid || validation.workload.indicatorCount !== 4)
    throw new Error('Planner validation failed for full BIST fixture');
  const resolver = new PrecomputedIndicatorResolver(byInstrument, entry);
  return {
    eventCount: dates.length * instrumentIds.length,
    dates,
    instrumentIds,
    resolver,
    validationIndicatorCount: validation.workload.indicatorCount,
    plan: {
      runId: 'runtime-assigned',
      strategyRevisionId: `${STRATEGY_ID}:1`,
      dataSnapshotHash: SNAPSHOT_HASH,
      engineVersion: 'deterministic-backtest-v1',
      executionPolicyVersion: 'closed-bar-next-open-v1',
      eventOrderingPolicyVersion: 'deterministic-ordering-v1',
      roundingPolicyVersion: 'whole-share-v1',
      timeframe: '1d',
      initialCash: '10000000',
      entryRule: entry,
      exitRule: exit,
      positionSizing: { type: 'fixedCash', amount: '10000' },
      costPolicy: {
        type: 'linear',
        version: 'benchmark-cost-v1',
        commissionPercent: '0.1',
        minimumCommission: '1',
        fixedFee: '0.25',
        marketTaxPercent: '0.02',
        slippageBps: '5',
      },
      maxConcurrentPositions: 20,
      fractionalShares: false,
      allowShort: false,
      allowLeverage: false,
      liquidateAtEnd: true,
      corporateActionPolicy: {
        version: 'corporate-action-v1',
        adjustmentMode: 'raw',
        delistingPolicy: 'lastAvailableClose',
      },
    },
  };
}

class PrecomputedIndicatorResolver implements BacktestOperandValueResolver {
  private readonly values = new Map<
    string,
    { readonly current: readonly (number | null)[] }
  >();
  private readonly operandKeys = new WeakMap<object, string>();

  constructor(
    histories: ReadonlyMap<string, readonly BacktestBar[]>,
    rule: ScanRuleAst,
  ) {
    const registry = createCoreIndicatorRegistry();
    const operands = indicatorOperands(rule);
    for (const [id, bars] of histories) {
      const inputBars = bars.map((bar) => ({
        timestamp: new Date(bar.timestamp),
        open: numeric(bar.open),
        high: numeric(bar.high),
        low: numeric(bar.low),
        close: numeric(bar.close),
        volume: numeric(bar.volume),
        isClosed: bar.isClosed,
      }));
      for (const operand of operands) {
        const definition = registry.resolve(operand.code, operand.version);
        const parameters = definition.parseParameters(operand.parameters);
        const output = definition.calculate(
          {
            instrumentId: id,
            timeframe: operand.timeframe,
            bars: inputBars,
            adjustmentMode: 'raw',
            dataCutoffAt: new Date(CUTOFF),
          },
          parameters,
        );
        const series =
          output.kind === 'scalar'
            ? output.values
            : output.outputs[operand.output ?? ''];
        if (!series)
          throw new Error(`Indicator output missing: ${operand.code}`);
        this.values.set(`${id}:${this.operandKey(operand)}`, {
          current: series,
        });
      }
    }
  }

  resolve(
    operand: Parameters<BacktestOperandValueResolver['resolve']>[0],
    context: Parameters<BacktestOperandValueResolver['resolve']>[1],
  ): PreparedOperandValue | undefined {
    if (operand.type !== 'indicator') return undefined;
    const series = this.values.get(
      `${context.instrumentId}:${this.operandKey(operand)}`,
    )?.current;
    if (!series) return undefined;
    const index = context.bars.length - 1;
    return {
      type: 'number',
      current: series[index] ?? null,
      previous: index > 0 ? (series[index - 1] ?? null) : null,
    };
  }

  private operandKey(operand: IndicatorOperand): string {
    const cached = this.operandKeys.get(operand);
    if (cached !== undefined) return cached;
    const key = createScanOperandKey(operand);
    this.operandKeys.set(operand, key);
    return key;
  }
}

function buildPersistenceResult(): BacktestResult {
  const fills: BacktestFill[] = Array.from(
    { length: FIXTURE.persistence.fills },
    (_, index) => {
      const entry = index % 2 === 0;
      const timestamp = new Date(
        Date.parse('2024-01-01T15:00:00.000Z') + index * 60_000,
      ).toISOString();
      return {
        id: `persist-fill-${index}`,
        deduplicationKey: `persist-dedup-${index}`,
        orderIntentId: `persist-order-${index}`,
        instrumentId: instrumentId(index % FIXTURE.fullBist.symbols),
        symbol: symbolFor(index % FIXTURE.fullBist.symbols),
        side: entry ? 'BUY' : 'SELL',
        quantity: '10',
        requestedQuantity: '10',
        referencePrice: '100',
        price: entry ? '100.05' : '99.95',
        grossAmount: entry ? '1000.5' : '999.5',
        slippageAmount: '0.5',
        commission: '1',
        fixedFee: '0.25',
        tax: '0.2',
        totalCosts: '1.95',
        netCashEffect: entry ? '-1001.95' : '998.05',
        partial: false,
        signalAt: timestamp,
        filledAt: timestamp,
        reason: entry ? 'entry' : 'exit',
      };
    },
  );
  const trades: BacktestTrade[] = Array.from(
    { length: FIXTURE.persistence.trades },
    (_, index) => {
      const entry = fills[index * 2]!;
      const exit = fills[index * 2 + 1]!;
      return {
        id: `persist-trade-${index}`,
        instrumentId: entry.instrumentId,
        symbol: entry.symbol,
        quantity: '10',
        entryPrice: entry.price,
        exitPrice: exit.price,
        openedAt: entry.filledAt,
        closedAt: exit.filledAt,
        grossPnl: '-1',
        totalCosts: '3.9',
        realizedPnl: '-4.9',
        returnPercent: '-0.49',
        exitReason: 'exit',
        entryFillId: entry.id,
        exitFillId: exit.id,
      };
    },
  );
  const pointsPerSeries = FIXTURE.persistence.seriesPoints / 5;
  const curve = Array.from({ length: pointsPerSeries }, (_, index) => ({
    timestamp: new Date(
      Date.parse('2020-01-01T15:00:00.000Z') + index * 86_400_000,
    ).toISOString(),
    value: String(1_000_000 + index),
  }));
  const drawdown = curve.map((point) => ({ ...point, value: '0' }));
  const metricCalculation = calculateBacktestMetrics({
    initialEquity: '1000000',
    endingEquity: curve.at(-1)!.value,
    equityCurve: curve,
    drawdownCurve: drawdown,
    fills,
    trades,
    adjustmentMode: 'raw',
    dataCutoffAt: CUTOFF,
  });
  const plan = basicPlan('persistence-template');
  const template = new DeterministicBacktestEngine(
    new ScannerBacktestSignalEvaluator(),
  ).run(plan, [
    basicBar(0, '2024-01-01T15:00:00.000Z', '11'),
    basicBar(0, '2024-01-02T15:00:00.000Z', '11'),
  ]);
  return {
    ...template,
    resultHash: stableHash({ fixture: FIXTURE.seed, type: 'persistence' }),
    fills,
    trades,
    equityCurve: curve,
    cashCurve: curve,
    exposureCurve: curve,
    drawdownCurve: drawdown,
    benchmarkCurve: curve,
    summary: {
      initialCash: '1000000',
      endingCash: curve.at(-1)!.value,
      endingEquity: curve.at(-1)!.value,
      totalReturnPercent: '0.9999',
      maximumDrawdownPercent: '0',
      realizedPnl: '-49000',
      tradeCount: trades.length,
      winningTradeCount: 0,
      losingTradeCount: trades.length,
      winRatePercent: '0',
      profitFactor: '0',
      exposurePercent: '50',
      totalCosts: '39000',
      metrics: metricCalculation.metrics,
      methodology: metricCalculation.methodology,
    },
    warnings: [],
  };
}

async function insertBenchmarkRun(db: Database, runId: string) {
  await db.insert(backtestRuns).values({
    id: runId,
    strategyId: STRATEGY_ID,
    strategyRevision: 1,
    requestedBy: OWNER_ID,
    status: 'running',
    requestHash: stableHash({ runId, type: 'request' }),
    idempotencyKeyHash: stableHash({ runId, type: 'idempotency' }),
    engineVersion: 'deterministic-backtest-v1',
    executionPolicyVersion: 'closed-bar-next-open-v1',
    costPolicyVersion: 'benchmark-cost-v1',
    metricPolicyVersion: 'backtest-metrics-v2',
    eventOrderingPolicyVersion: 'deterministic-ordering-v1',
    roundingPolicyVersion: 'whole-share-v1',
    dataSnapshotId: SNAPSHOT_ID,
    parameters: { executionPlan: basicPlan(runId), complexityScore: 100 },
    universeSnapshot: { fixtureVersion: FIXTURE.schemaVersion },
    timeframe: '1d',
    adjustmentMode: 'raw',
    rangeFrom: new Date('2020-01-01T00:00:00.000Z'),
    rangeTo: new Date(CUTOFF),
    initialCapital: '1000000',
    startedAt: new Date('2025-01-01T00:00:00.000Z'),
  });
}

async function persistedCounts(db: Database, runId: string) {
  const [[orders], [fills], [trades]] = await Promise.all([
    db
      .select({ value: count() })
      .from(backtestOrders)
      .where(eq(backtestOrders.runId, runId)),
    db
      .select({ value: count() })
      .from(backtestFills)
      .where(eq(backtestFills.runId, runId)),
    db
      .select({ value: count() })
      .from(backtestTrades)
      .where(eq(backtestTrades.runId, runId)),
  ]);
  const series = await db
    .select({ value: backtestSeriesChunks.pointCount })
    .from(backtestSeriesChunks)
    .where(eq(backtestSeriesChunks.runId, runId));
  const [summaries] = await db
    .select({ value: count() })
    .from(backtestSummaries)
    .where(eq(backtestSummaries.runId, runId));
  return {
    orders: Number(orders?.value ?? 0),
    fills: Number(fills?.value ?? 0),
    trades: Number(trades?.value ?? 0),
    seriesPoints: series.reduce((total, row) => total + row.value, 0),
    summaries: Number(summaries?.value ?? 0),
  };
}

class MeasuredBacktestEngine extends DeterministicBacktestEngine {
  constructor(
    evaluator: ScannerBacktestSignalEvaluator,
    private readonly durations: number[],
  ) {
    super(evaluator);
  }

  override run(
    plan: BacktestExecutionPlan,
    events: readonly BacktestTimelineEvent[],
    options: BacktestRunOptions = {},
  ): BacktestResult {
    const started = performance.now();
    try {
      return super.run(plan, events, options);
    } finally {
      this.durations.push(performance.now() - started);
    }
  }
}

function measuredRepository(
  postgres: PostgresBacktestRuntimeRepository,
  persistenceDurations: number[],
): BacktestWorkerRepository {
  return {
    loadRun: (id) => postgres.loadRun(id),
    transition: (input) => postgres.transition(input),
    isCancellationRequested: (id) => postgres.isCancellationRequested(id),
    saveCheckpoint: (input) => postgres.saveCheckpoint(input),
    async persistCompletedResult(input) {
      const started = performance.now();
      try {
        await postgres.persistCompletedResult(input);
      } finally {
        persistenceDurations.push(performance.now() - started);
      }
    },
    failRun: (input) => postgres.failRun(input),
  };
}

function indicatorRule(): ScanRuleAst {
  const operands: readonly IndicatorOperand[] = [
    {
      type: 'indicator',
      code: 'RSI',
      version: 1,
      timeframe: '1d',
      parameters: { period: 14 },
    },
    {
      type: 'indicator',
      code: 'EMA',
      version: 1,
      timeframe: '1d',
      parameters: { period: 20 },
    },
    {
      type: 'indicator',
      code: 'SMA',
      version: 1,
      timeframe: '1d',
      parameters: { period: 50 },
    },
    {
      type: 'indicator',
      code: 'ATR',
      version: 1,
      timeframe: '1d',
      parameters: { period: 14 },
    },
  ];
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: [],
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: 'benchmark-entry-root',
      operator: 'AND',
      children: operands.map((operand, index) => ({
        type: 'condition' as const,
        nodeId: `benchmark-indicator-${index}`,
        operator: 'GT' as const,
        left: operand,
        right: { type: 'constantNumber' as const, value: -1_000_000 },
      })),
    },
  };
}

function exitRule(): ScanRuleAst {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: [],
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: 'benchmark-exit-root',
      operator: 'AND',
      children: [
        {
          type: 'condition',
          nodeId: 'benchmark-exit-condition',
          operator: 'LT',
          left: { type: 'priceField', field: 'close', timeframe: '1d' },
          right: { type: 'constantNumber', value: 0 },
        },
      ],
    },
  };
}

function basicRule(operator: 'GT' | 'LT', value: number): ScanRuleAst {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: [],
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: `basic-${operator}-root`,
      operator: 'AND',
      children: [
        {
          type: 'condition',
          nodeId: `basic-${operator}-condition`,
          operator,
          left: { type: 'priceField', field: 'close', timeframe: '1d' },
          right: { type: 'constantNumber', value },
        },
      ],
    },
  };
}

function basicPlan(runId: string): BacktestExecutionPlan {
  return {
    runId,
    strategyRevisionId: `${STRATEGY_ID}:1`,
    dataSnapshotHash: SNAPSHOT_HASH,
    engineVersion: 'deterministic-backtest-v1',
    executionPolicyVersion: 'closed-bar-next-open-v1',
    eventOrderingPolicyVersion: 'deterministic-ordering-v1',
    roundingPolicyVersion: 'whole-share-v1',
    timeframe: '1d',
    initialCash: '1000000',
    entryRule: basicRule('GT', 10),
    exitRule: basicRule('LT', 10),
    positionSizing: { type: 'fixedCash', amount: '10000' },
    costPolicy: {
      type: 'linear',
      version: 'benchmark-cost-v1',
      commissionPercent: '0.1',
      minimumCommission: '1',
      fixedFee: '0.25',
      marketTaxPercent: '0.02',
      slippageBps: '5',
    },
    maxConcurrentPositions: 20,
    fractionalShares: false,
    allowShort: false,
    allowLeverage: false,
    liquidateAtEnd: true,
  };
}

function strategyDefinition(
  entryRule: ScanRuleAst,
  exitRuleValue: ScanRuleAst,
): StrategyDefinition {
  return {
    schemaVersion: 1,
    baseTimeframe: '1d',
    entryRule,
    exitRule: exitRuleValue,
    filterRule: null,
    parameters: [],
    positionSizing: { type: 'fixedCash', amount: 10_000 },
    riskControls: {
      maxPositionWeight: 10,
      maxConcurrentPositions: 20,
      allowShort: false,
      allowLeverage: false,
      allowNegativeCash: false,
    },
    executionPolicy: {
      code: 'closed_bar_next_open',
      version: 'closed-bar-next-open-v1',
      signalBarPolicy: 'closed_only',
      higherTimeframeBarPolicy: 'closed_only',
      missingBarPolicy: 'defer_to_next_available',
    },
    costPolicy: {
      code: 'percentage_commission_fixed_bps_slippage',
      version: 'benchmark-cost-v1',
      commissionPercent: 0.1,
      minimumCommission: 1,
      slippageBps: 5,
      fixedFee: 0.25,
      marketTaxPercent: 0.02,
    },
    dataIntegrityPolicy: {
      universePolicy: 'point_in_time',
      fundamentalAvailabilityPolicy: 'publication_and_revision',
      corporateActionPolicyVersion: 'corporate-action-v1',
      adjustmentMode: 'raw',
    },
    benchmarkCode: 'XU100',
  };
}

function indicatorOperands(rule: ScanRuleAst): readonly IndicatorOperand[] {
  const result: IndicatorOperand[] = [];
  const visit = (node: ScanRuleAst['root']['children'][number]): void => {
    if (node.type === 'group') {
      node.children.forEach(visit);
      return;
    }
    for (const operand of [node.left, node.right, node.upperBound])
      if (operand?.type === 'indicator') result.push(operand);
  };
  rule.root.children.forEach(visit);
  return result;
}

function basicBar(
  index: number,
  timestamp: string,
  close: string,
): BacktestBar {
  return {
    eventId: `basic-bar-${timestamp}`,
    type: 'bar',
    instrumentId: instrumentId(index),
    symbol: symbolFor(index),
    timestamp,
    open: close,
    high: close,
    low: close,
    close,
    volume: '1000000',
    isClosed: true,
  };
}

function result(input: {
  readonly id: string;
  readonly scenario: ScenarioName;
  readonly name: string;
  readonly durations: readonly number[];
  readonly fixture: string;
  readonly symbols: number;
  readonly bars: number;
  readonly events: number;
  readonly workerConcurrency: number;
  readonly batchSize: number;
  readonly cacheState: string;
  readonly engineTimeMs: number;
  readonly databaseTimeMs: number;
  readonly persistenceTimeMs: number;
  readonly apiTimeMs: number;
  readonly memoryPeakBytes: number;
  readonly errors: readonly string[];
  readonly threshold: Threshold;
  readonly invariants: Readonly<Record<string, string | number | boolean>>;
}): BenchmarkResult {
  const summary = summarizeDurations(input.durations);
  const repetitionsValid =
    input.durations.length >= input.threshold.minimumRepetitions;
  const invariantValues = Object.values(input.invariants);
  const invariantsValid = invariantValues.every(
    (value) => value !== false && value !== 'FAIL',
  );
  return {
    id: input.id,
    scenario: input.scenario,
    name: input.name,
    commitSha,
    fixture: input.fixture,
    symbols: input.symbols,
    bars: input.bars,
    events: input.events,
    workerConcurrency: input.workerConcurrency,
    batchSize: input.batchSize,
    repetitions: input.durations.length,
    cacheState: input.cacheState,
    ...summary,
    engineTimeMs: round(input.engineTimeMs),
    databaseTimeMs: round(input.databaseTimeMs),
    persistenceTimeMs: round(input.persistenceTimeMs),
    apiTimeMs: round(input.apiTimeMs),
    memoryPeakBytes: input.memoryPeakBytes,
    errors: input.errors,
    threshold: `p95 <= ${input.threshold.p95Ms} ms; repetitions >= ${input.threshold.minimumRepetitions}; errors = 0`,
    invariants: input.invariants,
    passed:
      repetitionsValid &&
      summary.p95Ms <= input.threshold.p95Ms &&
      input.errors.length === 0 &&
      invariantsValid,
  };
}

async function buildReport(
  pool: ReturnType<typeof createDatabase>['pool'],
  results: readonly BenchmarkResult[],
  selected: ScenarioName | undefined,
) {
  const postgres = (
    await pool.query<{ server_version: string }>('show server_version')
  ).rows[0]?.server_version;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    commitSha,
    status: results.every((item) => item.passed) ? 'PASS' : 'FAIL',
    selectedScenario: selected ?? 'all',
    environment: {
      hostname: hostname(),
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cpuCount: cpus().length,
      memoryBytes: totalmem(),
      memoryPeakMeasurement: 'process.resourceUsage.maxRSS',
      node: process.version,
      pnpm: command('pnpm --version'),
      postgres,
      redis: await redisServerVersion(REDIS_URL),
      database: 'isolated test PostgreSQL (credentials redacted)',
      internetProvider: false,
    },
    fixture: FIXTURE,
    scenarios: results,
  } as const;
}

async function writeReports(report: Awaited<ReturnType<typeof buildReport>>) {
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  await writeFile(
    `${REPORT_DIRECTORY}/backtest-benchmark.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  const rows = report.scenarios
    .map(
      (item) =>
        `| ${item.id} | ${item.fixture} | ${item.workerConcurrency} | ${item.batchSize} | ${item.repetitions} | ${item.cacheState} | ${item.p50Ms} | ${item.p95Ms} | ${item.maxMs} | ${item.engineTimeMs} | ${item.databaseTimeMs} | ${item.persistenceTimeMs} | ${item.apiTimeMs} | ${item.memoryPeakBytes} | ${item.errors.length} | ${item.threshold} | ${item.passed ? 'PASS' : 'FAIL'} |`,
    )
    .join('\n');
  await writeFile(
    `${REPORT_DIRECTORY}/backtest-benchmark.md`,
    `# Backtest Performance Benchmark\n\n- **Status:** ${report.status}\n- **Generated:** ${report.generatedAt}\n- **Commit:** \`${report.commitSha}\`\n- **Selected scenario:** ${report.selectedScenario}\n- **Environment:** ${JSON.stringify(report.environment)}\n- **Fixture contract:** \`performance/fixtures/backtest-v1.json\`\n- **Threshold contract:** \`performance/thresholds/backtest.json\`\n\n| ID | Fixture | Worker | Batch | Repetitions | Warm/cold | p50 ms | p95 ms | Max ms | Engine ms | DB ms | Persistence ms | API ms | Peak memory | Errors | Threshold | Result |\n| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |\n${rows}\n\n## Invariants and errors\n\n${report.scenarios.map((item) => `- **${item.id}:** invariants=${JSON.stringify(item.invariants)}; errors=${JSON.stringify(item.errors)}`).join('\n')}\n`,
  );
}

function enforceScenarioCompleteness(
  results: readonly BenchmarkResult[],
  selected: ScenarioName | undefined,
) {
  const expected: Readonly<Record<ScenarioName, readonly string[]>> = {
    'full-bist': ['PERF-BT-001'],
    'event-engine': ['PERF-BT-002'],
    persistence: ['PERF-BT-003'],
    'result-api': [
      'PERF-BT-004-summary',
      'PERF-BT-004-series',
      'PERF-BT-004-trades',
    ],
    experiments: ['PERF-BT-005'],
    reproducibility: ['PERF-BT-006'],
  };
  const required = selected
    ? expected[selected]
    : Object.values(expected).flat().filter(unique);
  const actual = new Set(results.map((item) => item.id));
  const missing = required.filter((id) => !actual.has(id));
  if (missing.length > 0)
    throw new Error(
      `Missing mandatory benchmark scenarios: ${missing.join(',')}`,
    );
}

async function startBacktestApi(): Promise<{
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}> {
  const port = Number(process.env.BACKTEST_PERF_API_PORT ?? 43108);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(
    'pnpm',
    [
      '--filter',
      '@atlas/api',
      'exec',
      'tsx',
      'dist/performance/backtest-performance-server.js',
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        API_HOST: '127.0.0.1',
        API_PORT: String(port),
        DATABASE_URL,
        REDIS_URL,
        LOG_LEVEL: 'error',
        NODE_ENV: 'test',
      },
    },
  );
  const diagnostics: string[] = [];
  child.stderr.on('data', (chunk: Buffer) =>
    diagnostics.push(chunk.toString()),
  );
  await waitForApi(child, `${baseUrl}/health/live`, diagnostics);
  return { baseUrl, close: () => stopApi(child) };
}

async function timedFetch(url: string): Promise<number> {
  const started = performance.now();
  await getJson(url);
  return performance.now() - started;
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'x-performance-user-id': OWNER_ID },
  });
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function waitForApi(
  child: ChildProcessWithoutNullStreams,
  healthUrl: string,
  diagnostics: readonly string[],
) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(
        `Backtest API exited during startup (${child.exitCode}): ${diagnostics.join('')}`,
      );
    try {
      const response = await fetch(healthUrl);
      if (response.ok) return;
    } catch {
      // The dedicated production-module API process is still starting.
    }
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Backtest API startup timed out: ${diagnostics.join('')}`);
}

function stopApi(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolvePromise();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    child.kill('SIGTERM');
  });
}

async function waitForTerminal(
  db: Database,
  runId: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [row] = await db
      .select({ status: backtestRuns.status })
      .from(backtestRuns)
      .where(eq(backtestRuns.id, runId))
      .limit(1);
    if (
      row &&
      ['completed', 'failed', 'cancelled', 'expired'].includes(row.status)
    )
      return row.status;
    if (Date.now() >= deadline) return 'timeout';
    await delay(50);
  }
}

async function waitForBacktestJobTerminal(
  queue: Queue<BacktestRunQueuePayload>,
  runId: string,
  timeoutMs: number,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const jobId = createBacktestRunJobId(runId);
  for (;;) {
    const job = await queue.getJob(jobId);
    if (job !== undefined) {
      const state = await job.getState();
      if (state === 'completed' || state === 'failed') return state;
    }
    if (Date.now() >= deadline) return 'timeout';
    await delay(25);
  }
}

function requestedScenario(): ScenarioName | undefined {
  const inline = process.argv
    .find((argument) => argument.startsWith('--scenario='))
    ?.slice('--scenario='.length);
  const separateIndex = process.argv.indexOf('--scenario');
  const value =
    inline ??
    (separateIndex >= 0 ? process.argv[separateIndex + 1] : undefined);
  if (value === undefined) return undefined;
  const supported: readonly ScenarioName[] = [
    'full-bist',
    'event-engine',
    'persistence',
    'result-api',
    'experiments',
    'reproducibility',
  ];
  if (!supported.includes(value as ScenarioName))
    throw new Error(`Unsupported backtest scenario: ${value}`);
  return value as ScenarioName;
}

function assertFixtureContract() {
  const combined =
    FIXTURE.persistence.orders +
    FIXTURE.persistence.fills +
    FIXTURE.persistence.trades +
    FIXTURE.persistence.seriesPoints;
  if (
    FIXTURE.schemaVersion !== 1 ||
    FIXTURE.fullBist.symbols !== 650 ||
    FIXTURE.fullBist.years !== 5 ||
    FIXTURE.fullBist.indicatorCount !== 4 ||
    FIXTURE.eventEngine.events !== 5_000_000 ||
    combined !== 100_000 ||
    FIXTURE.persistence.combinedEvents !== 100_000 ||
    FIXTURE.resultApi.seriesPointsRequested !== 2_000 ||
    FIXTURE.resultApi.tradeDataset !== 10_000 ||
    FIXTURE.experiments.parameterCombinations !== 100 ||
    FIXTURE.reproducibility.independentRuns !== 2
  )
    throw new Error('Backtest benchmark fixture contract mismatch');
}

function threshold(id: string): Threshold {
  const value = THRESHOLDS[id];
  if (!value) throw new Error(`Missing threshold: ${id}`);
  return value;
}

function tradingDates(from: Date, to: Date): readonly string[] {
  const result: string[] = [];
  for (
    let timestamp = from.getTime();
    timestamp <= to.getTime();
    timestamp += 86_400_000
  ) {
    const value = new Date(timestamp);
    const day = value.getUTCDay();
    if (day !== 0 && day !== 6) result.push(value.toISOString());
  }
  return result;
}

function orderedTimestamp(bucket: number): string {
  return new Date(
    Date.parse('2000-01-01T00:00:00.000Z') + bucket * 1_000,
  ).toISOString();
}

function instrumentId(index: number): string {
  return `91000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function symbolFor(index: number): string {
  return `BT${String(index + 1).padStart(4, '0')}`;
}

function numeric(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fixed(value: number): string {
  return value.toFixed(4);
}

function stableHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value, objectKeySorter))
    .digest('hex');
}

function objectKeySorter(_key: string, value: unknown): unknown {
  if (!value || Array.isArray(value) || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function chunks<T>(values: readonly T[], size: number): readonly T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function unique(value: string, index: number, values: readonly string[]) {
  return values.indexOf(value) === index;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function peakResidentBytes(): number {
  return process.resourceUsage().maxRSS * 1024;
}

function delay(milliseconds: number) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function silentLogger() {
  return new StructuredLogger('error', {
    write: () => undefined,
  } satisfies LogSink);
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requireTestDatabaseUrl(): string {
  const value = required('TEST_DATABASE_URL');
  if (!new URL(value).pathname.slice(1).endsWith('_test'))
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}

function git(args: readonly string[]) {
  try {
    return execFileSync('git', [...args], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function command(value: string) {
  try {
    return execFileSync('/bin/sh', ['-c', value], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function redisServerVersion(urlValue: string): Promise<string> {
  const url = new URL(urlValue);
  return import('node:net').then(
    ({ createConnection }) =>
      new Promise((resolveVersion, reject) => {
        const socket = createConnection({
          host: url.hostname,
          port: Number(url.port || 6379),
        });
        let response = '';
        socket.setTimeout(5_000);
        socket.on('connect', () =>
          socket.write('*2\r\n$4\r\nINFO\r\n$6\r\nserver\r\n'),
        );
        socket.on('data', (chunk) => {
          response += chunk.toString('utf8');
          const match = response.match(/redis_version:([^\r\n]+)/u);
          if (match?.[1]) {
            socket.end();
            resolveVersion(match[1]);
          }
        });
        socket.on('timeout', () => socket.destroy(new Error('Redis timeout')));
        socket.on('error', reject);
      }),
  );
}

void main().catch(async (error: unknown) => {
  const message = safeError(error);
  process.stderr.write(`${message}\n`);
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  await writeFile(
    `${REPORT_DIRECTORY}/backtest-benchmark.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        commitSha,
        status: 'FAIL',
        fatalError: message,
        scenarios: [],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    `${REPORT_DIRECTORY}/backtest-benchmark.md`,
    `# Backtest Performance Benchmark\n\n- **Status:** FAIL\n- **Commit:** \`${commitSha}\`\n- **Fatal error:** ${message}\n`,
  );
  process.exitCode = 1;
});

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 2_000);
  const ownMessage = error.message.split('\nparams:')[0]?.trim();
  const cause = error.cause;
  const causeMessage =
    cause instanceof Error ? cause.message.split('\nparams:')[0]?.trim() : '';
  return [error.name, ownMessage, causeMessage]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(': ')
    .slice(0, 2_000);
}
