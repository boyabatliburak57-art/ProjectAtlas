import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, freemem, hostname, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';

import {
  createDatabase,
  dataProviders,
  instruments,
  PostgresScanRunRepository,
  priceBars,
  runMigrations,
  scanResults,
  scanRuns,
} from '@atlas/database';
import {
  createCoreIndicatorRegistry,
  planScanExecution,
  ScanRunApplicationService,
  type IndicatorOperand,
  type ScanExecutionPlan,
  type ScanRuleAst,
} from '@atlas/domain';
import { and, asc, count, eq, gt } from 'drizzle-orm';
import { Queue, QueueEvents } from 'bullmq';

import { parseEnvironment } from '../config/environment';
import { StructuredLogger } from '../observability/structured-logger';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from '../queue/queue-contracts';
import { createRedisConnection } from '../queue/redis-connection';
import { enqueueScannerRun } from '../queue/scanner-queue';
import { WorkerRuntime } from '../runtime/worker-runtime';
import type { ScannerRunJobData } from '../scanner/contracts';
import { createScannerComposition } from '../scanner/scanner-composition';
import { InMemoryScannerMetrics } from '../scanner/metrics';
import { PostgresScannerRuntimeRepository } from '../scanner/postgres-scanner-runtime-repository';
import { summarizeDurations, type DurationSummary } from './statistics';

const REPOSITORY_ROOT = `${resolve(__dirname, '../../../..')}/`;
const REPORT_DIRECTORY = `${REPOSITORY_ROOT}reports/performance`;
const DATABASE_URL = requireTestDatabaseUrl();
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const WORKER_CONCURRENCY = 2;
const BATCH_SIZE = 100;
const CUTOFF = new Date('2026-03-31T18:00:00.000Z');
const USER_ID = '40000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '40000000-0000-4000-8000-000000000002';
const SCENARIOS = [
  'small-sync',
  'full-bist',
  'medium-complexity',
  'pagination',
  'progress-polling',
  'idempotent-replay',
] as const;
type ScenarioName = (typeof SCENARIOS)[number];

interface FixtureDefinition {
  readonly version: number;
  readonly seed: string;
  readonly instrumentCount: number;
  readonly shortHistoryInstrumentCount: number;
  readonly dailyBarsPerInstrument: number;
  readonly hourlyBarsPerInstrument: number;
  readonly shortHistoryBarsPerTimeframe: number;
  readonly timeframes: readonly ['1d', '1h'];
  readonly market: 'BIST';
  readonly externalProvider: false;
}

interface ThresholdDefinition {
  readonly 'PERF-SCN-001': {
    readonly coldP95Ms: number;
    readonly warmP95Ms: number;
    readonly maximumErrors: number;
  };
  readonly 'PERF-SCN-002': {
    readonly p95Ms: number;
    readonly maximumErrors: number;
    readonly maximumDuplicateResults: number;
    readonly requiredProgressMonotonicityPercent: number;
  };
  readonly 'PERF-SCN-003': {
    readonly p95Ms: number;
    readonly maximumErrors: number;
    readonly maximumWorkerCrashes: number;
    readonly maximumHeapGrowthBytes: number;
  };
  readonly 'PERF-SCN-004': {
    readonly p95Ms: number;
    readonly maximumErrors: number;
    readonly maximumDuplicateOrMissingRows: number;
  };
  readonly 'PERF-SCN-005': {
    readonly p95Ms: number;
    readonly maximumErrors: number;
    readonly maximumUnauthorizedAccesses: number;
    readonly maximumTerminalChanges: number;
  };
  readonly 'PERF-SCN-006': {
    readonly p95Ms: number;
    readonly maximumErrors: number;
    readonly maximumNewRuns: number;
  };
}

const fixtureDefinition = readJson<FixtureDefinition>(
  `${REPOSITORY_ROOT}performance/fixtures/scanner-runtime-v1.json`,
);
const thresholds = readJson<ThresholdDefinition>(
  `${REPOSITORY_ROOT}performance/thresholds/scanner-runtime.json`,
);
const INSTRUMENT_COUNT = fixtureDefinition.instrumentCount;
const SHORT_HISTORY_COUNT = fixtureDefinition.shortHistoryInstrumentCount;
const BAR_COUNT =
  (INSTRUMENT_COUNT - SHORT_HISTORY_COUNT) *
    (fixtureDefinition.dailyBarsPerInstrument +
      fixtureDefinition.hourlyBarsPerInstrument) +
  SHORT_HISTORY_COUNT *
    fixtureDefinition.shortHistoryBarsPerTimeframe *
    fixtureDefinition.timeframes.length;

interface WorkerRunMeasurement {
  readonly durationMs: number;
  readonly runId: string;
  readonly processed: number;
  readonly matched: number;
  readonly notEvaluable: number;
  readonly resultCount: number;
  readonly progressMonotonic: boolean;
}

interface ScenarioResult extends DurationSummary {
  readonly id: string;
  readonly name: string;
  readonly fixtureSize: string;
  readonly workerConcurrency: number;
  readonly batchSize: number;
  readonly cacheMode: string;
  readonly repetitions: number;
  readonly errorCount: number;
  readonly processedInstruments: number;
  readonly matchedInstruments: number;
  readonly threshold: string;
  readonly passed: boolean;
  readonly notes: readonly string[];
}

interface BaselineReport {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly status: 'PASS' | 'FAIL';
  readonly environment: Readonly<Record<string, unknown>>;
  readonly fixture: Readonly<Record<string, unknown>>;
  readonly scenarios: readonly ScenarioResult[];
}

async function main(): Promise<void> {
  const selected = selectedScenarios(process.argv.slice(2));
  const { db, pool } = createDatabase(DATABASE_URL);
  const connection = createRedisConnection(REDIS_URL);
  const queue = new Queue<ScannerRunJobData>(QUEUE_NAMES.scanner, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const queueEvents = new QueueEvents(QUEUE_NAMES.scanner, { connection });
  const logger = new StructuredLogger('error', { write: () => undefined });
  const metrics = new InMemoryScannerMetrics();
  const repository = new PostgresScannerRuntimeRepository(db);
  const scannerComposition = createScannerComposition({
    database: db,
    repository,
    metrics,
    logger,
    batchSize: BATCH_SIZE,
    batchTimeoutMs: 60_000,
    runTimeoutMs: 180_000,
  });
  let runtime: WorkerRuntime | undefined;

  try {
    await resetInfrastructure(pool, db, queue, queueEvents);
    const instrumentIds = await seedFixture(db);
    runtime = await WorkerRuntime.start(
      parseEnvironment({
        DATABASE_URL,
        REDIS_URL,
        WORKER_CONCURRENCY,
        WORKER_HEARTBEAT_INTERVAL_MS: 60_000,
        SCANNER_BATCH_SIZE: BATCH_SIZE,
        SCANNER_BATCH_TIMEOUT_MS: 60_000,
        SCANNER_RUN_TIMEOUT_MS: 180_000,
      }),
      logger,
      undefined,
      scannerComposition,
    );

    const results: ScenarioResult[] = [];
    if (selected.has('small-sync')) {
      results.push(
        await benchmarkSmall(
          db,
          queue,
          queueEvents,
          instrumentIds.slice(0, 25),
        ),
      );
    }

    let fullRun: WorkerRunMeasurement | undefined;
    if (
      selected.has('full-bist') ||
      selected.has('pagination') ||
      selected.has('progress-polling')
    ) {
      const full = await benchmarkFull(
        db,
        queue,
        queueEvents,
        instrumentIds,
        selected.has('full-bist'),
      );
      fullRun = full.lastRun;
      if (full.report !== undefined) results.push(full.report);
    }
    if (selected.has('medium-complexity')) {
      results.push(
        await benchmarkMedium(db, queue, queueEvents, instrumentIds),
      );
    }
    if (selected.has('pagination') && fullRun !== undefined) {
      results.push(await benchmarkPagination(db, fullRun));
    }
    if (selected.has('progress-polling') && fullRun !== undefined) {
      results.push(await benchmarkProgress(db, queue, fullRun));
    }
    if (selected.has('idempotent-replay')) {
      results.push(await benchmarkReplay(db, instrumentIds.slice(0, 25)));
    }

    const report: BaselineReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: results.every(({ passed }) => passed) ? 'PASS' : 'FAIL',
      environment: await environmentMetadata(pool, queue),
      fixture: {
        version: fixtureDefinition.version,
        seed: fixtureDefinition.seed,
        instrumentCount: INSTRUMENT_COUNT,
        shortHistoryInstrumentCount: SHORT_HISTORY_COUNT,
        barCount: BAR_COUNT,
        timeframes: fixtureDefinition.timeframes,
        externalProvider: fixtureDefinition.externalProvider,
      },
      scenarios: results,
    };
    await writeReports(report);
    process.stdout.write(`${markdownReport(report)}\n`);
    if (report.status === 'FAIL') {
      throw new Error('Scanner performance threshold failure');
    }
  } finally {
    await runtime?.stop('scanner-performance-complete');
    await Promise.allSettled([queueEvents.close(), queue.close(), pool.end()]);
  }
}

async function benchmarkSmall(
  db: ReturnType<typeof createDatabase>['db'],
  queue: Queue<ScannerRunJobData>,
  events: QueueEvents,
  instrumentIds: readonly string[],
): Promise<ScenarioResult> {
  const plan = createPlan(smallRule(), instrumentIds.length, true);
  const cold = await runWorker(
    db,
    queue,
    events,
    plan,
    instrumentIds,
    'small-cold',
  );
  const warmRuns = await repeat(5, (index) =>
    runWorker(db, queue, events, plan, instrumentIds, `small-warm-${index}`),
  );
  const summary = summarizeDurations(
    warmRuns.values.map(({ durationMs }) => durationMs),
  );
  const configured = thresholds['PERF-SCN-001'];
  const coldLimit = tightened(configured.coldP95Ms);
  const warmLimit = tightened(configured.warmP95Ms);
  return scenario({
    id: 'PERF-SCN-001',
    name: 'Small synchronous scan',
    fixtureSize: `25 instruments · ${fixtureDefinition.dailyBarsPerInstrument} daily bars`,
    cacheMode: '1 cold + 5 warm runs',
    repetitions: 6,
    summary,
    errors: warmRuns.errors,
    measurement: warmRuns.values.at(-1) ?? cold,
    threshold: `cold p95 ≤ ${coldLimit} ms; warm p95 ≤ ${warmLimit} ms; errors = 0`,
    passed:
      cold.durationMs <= coldLimit &&
      summary.p95Ms <= warmLimit &&
      warmRuns.errors <= configured.maximumErrors,
    notes: [`cold p95: ${round(cold.durationMs)} ms`, 'execution mode: sync'],
  });
}

async function benchmarkFull(
  db: ReturnType<typeof createDatabase>['db'],
  queue: Queue<ScannerRunJobData>,
  events: QueueEvents,
  instrumentIds: readonly string[],
  includeReport: boolean,
): Promise<{
  readonly report?: ScenarioResult;
  readonly lastRun: WorkerRunMeasurement;
}> {
  const plan = createPlan(fullRule(), instrumentIds.length, false);
  await runWorker(db, queue, events, plan, instrumentIds, 'full-warmup');
  const runs = await repeat(includeReport ? 5 : 1, (index) =>
    runWorker(db, queue, events, plan, instrumentIds, `full-${index}`),
  );
  const lastRun = runs.values.at(-1);
  if (lastRun === undefined)
    throw new Error('Full BIST benchmark produced no run');
  if (!includeReport) return { lastRun };
  const summary = summarizeDurations(
    runs.values.map(({ durationMs }) => durationMs),
  );
  const configured = thresholds['PERF-SCN-002'];
  const limit = tightened(configured.p95Ms);
  const duplicateResults = runs.values.reduce(
    (sum, run) =>
      sum + Math.max(0, run.resultCount - run.matched - run.notEvaluable),
    0,
  );
  const monotonic = runs.values.every(
    ({ progressMonotonic }) => progressMonotonic,
  );
  return {
    lastRun,
    report: scenario({
      id: 'PERF-SCN-002',
      name: 'Full BIST fixture scan',
      fixtureSize: `${INSTRUMENT_COUNT} instruments · ${BAR_COUNT.toLocaleString('en-US')} persisted bars`,
      cacheMode: 'warm after 1 warm-up run',
      repetitions: 5,
      summary,
      errors: runs.errors,
      measurement: lastRun,
      threshold: `queue-to-terminal p95 ≤ ${limit} ms; errors/duplicates = 0; progress monotonic = 100%`,
      passed:
        summary.p95Ms <= limit &&
        runs.errors <= configured.maximumErrors &&
        duplicateResults <= configured.maximumDuplicateResults &&
        monotonic,
      notes: [
        `duplicate results: ${duplicateResults}`,
        `progress monotonicity: ${monotonic ? 100 : 0}%`,
        '3 unique indicators · 7 AST nodes',
      ],
    }),
  };
}

async function benchmarkMedium(
  db: ReturnType<typeof createDatabase>['db'],
  queue: Queue<ScannerRunJobData>,
  events: QueueEvents,
  instrumentIds: readonly string[],
): Promise<ScenarioResult> {
  const plan = createPlan(mediumRule(), instrumentIds.length, false);
  await runWorker(db, queue, events, plan, instrumentIds, 'medium-warmup');
  const heapBefore = process.memoryUsage().heapUsed;
  const runs = await repeat(5, (index) =>
    runWorker(db, queue, events, plan, instrumentIds, `medium-${index}`),
  );
  const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
  const summary = summarizeDurations(
    runs.values.map(({ durationMs }) => durationMs),
  );
  const last = runs.values.at(-1);
  if (last === undefined) throw new Error('Medium benchmark produced no run');
  const matchedCounts = new Set(runs.values.map(({ matched }) => matched));
  const configured = thresholds['PERF-SCN-003'];
  const limit = tightened(configured.p95Ms);
  return scenario({
    id: 'PERF-SCN-003',
    name: 'Medium complexity scan',
    fixtureSize: `${INSTRUMENT_COUNT} instruments · ${fixtureDefinition.timeframes.length} timeframes · ${SHORT_HISTORY_COUNT} short-history instruments`,
    cacheMode: 'warm after 1 warm-up run',
    repetitions: 5,
    summary,
    errors: runs.errors,
    measurement: last,
    threshold: `queue-to-terminal p95 ≤ ${limit} ms; errors/crashes = 0; deterministic matches; heap growth ≤ ${round(configured.maximumHeapGrowthBytes / 1_048_576)} MiB`,
    passed:
      summary.p95Ms <= limit &&
      runs.errors <= configured.maximumErrors &&
      matchedCounts.size === 1 &&
      heapGrowth <= configured.maximumHeapGrowthBytes,
    notes: [
      `heap growth: ${round(heapGrowth / 1_048_576)} MiB`,
      `notEvaluable: ${last.notEvaluable}`,
      '6 unique indicators · 10 AST nodes · nested groups · cross operator',
    ],
  });
}

async function benchmarkPagination(
  db: ReturnType<typeof createDatabase>['db'],
  source: WorkerRunMeasurement,
): Promise<ScenarioResult> {
  const durations: number[] = [];
  const seen = new Set<string>();
  let cursor: bigint | undefined;
  let errors = 0;
  do {
    const started = performance.now();
    try {
      const rows = await db
        .select({ id: scanResults.id, instrumentId: scanResults.instrumentId })
        .from(scanResults)
        .where(
          cursor === undefined
            ? eq(scanResults.scanRunId, source.runId)
            : and(
                eq(scanResults.scanRunId, source.runId),
                gt(scanResults.id, cursor),
              ),
        )
        .orderBy(asc(scanResults.id))
        .limit(50);
      durations.push(performance.now() - started);
      for (const row of rows) seen.add(row.instrumentId);
      cursor = rows.at(-1)?.id;
      if (rows.length < 50) break;
    } catch {
      errors += 1;
      break;
    }
  } while (cursor !== undefined);
  const summary = summarizeDurations(durations);
  const duplicateOrMissing = Math.abs(source.resultCount - seen.size);
  const configured = thresholds['PERF-SCN-004'];
  const limit = tightened(configured.p95Ms);
  return scenario({
    id: 'PERF-SCN-004',
    name: 'Result pagination',
    fixtureSize: `${source.resultCount} results · 50 rows/page`,
    cacheMode: 'warm database',
    repetitions: durations.length,
    summary,
    errors,
    measurement: source,
    threshold: `p95 ≤ ${limit} ms; duplicate/missing rows = 0`,
    passed:
      summary.p95Ms <= limit &&
      errors <= configured.maximumErrors &&
      duplicateOrMissing <= configured.maximumDuplicateOrMissingRows,
    notes: [`duplicate/missing rows: ${duplicateOrMissing}`],
  });
}

async function benchmarkProgress(
  db: ReturnType<typeof createDatabase>['db'],
  queue: Queue<ScannerRunJobData>,
  source: WorkerRunMeasurement,
): Promise<ScenarioResult> {
  const durations: number[] = [];
  let errors = 0;
  const snapshots: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const started = performance.now();
    try {
      const [rows, job] = await Promise.all([
        db
          .select({
            status: scanRuns.status,
            processed: scanRuns.progressProcessed,
            requestedBy: scanRuns.requestedBy,
          })
          .from(scanRuns)
          .where(
            and(
              eq(scanRuns.id, source.runId),
              eq(scanRuns.requestedBy, USER_ID),
            ),
          )
          .limit(1),
        queue.getJob(scannerJobId(source.runId)),
      ]);
      durations.push(performance.now() - started);
      snapshots.push(
        JSON.stringify({
          status: rows[0]?.status,
          processed: rows[0]?.processed,
          fastProgress: job?.progress,
        }),
      );
    } catch {
      errors += 1;
    }
  }
  const unauthorized = await db
    .select({ value: count() })
    .from(scanRuns)
    .where(
      and(
        eq(scanRuns.id, source.runId),
        eq(scanRuns.requestedBy, OTHER_USER_ID),
      ),
    );
  const unauthorizedAccesses = Number(unauthorized[0]?.value ?? 0);
  const terminalChanges = Math.max(0, new Set(snapshots).size - 1);
  const summary = summarizeDurations(durations);
  const configured = thresholds['PERF-SCN-005'];
  const limit = tightened(configured.p95Ms);
  return scenario({
    id: 'PERF-SCN-005',
    name: 'Progress polling',
    fixtureSize: `completed ${INSTRUMENT_COUNT}-instrument run · PostgreSQL + Redis`,
    cacheMode: 'warm terminal polling',
    repetitions: 10,
    summary,
    errors,
    measurement: source,
    threshold: `p95 ≤ ${limit} ms; unauthorized access/terminal changes = 0`,
    passed:
      summary.p95Ms <= limit &&
      errors <= configured.maximumErrors &&
      unauthorizedAccesses <= configured.maximumUnauthorizedAccesses &&
      terminalChanges <= configured.maximumTerminalChanges,
    notes: [
      `unauthorized accesses: ${unauthorizedAccesses}`,
      `terminal changes: ${terminalChanges}`,
    ],
  });
}

async function benchmarkReplay(
  db: ReturnType<typeof createDatabase>['db'],
  instrumentIds: readonly string[],
): Promise<ScenarioResult> {
  const application = new ScanRunApplicationService({
    repository: new PostgresScanRunRepository(db),
    universeResolver: {
      resolve: (filter) =>
        Promise.resolve({
          instrumentIds,
          filter,
          resolvedAt: new Date('2026-03-31T17:59:00.000Z'),
        }),
    },
    sourceAuthorization: { authorize: () => Promise.resolve(true) },
    planner: {
      indicatorRegistry: createCoreIndicatorRegistry(),
      entitlement: { check: () => ({ allowed: true }) },
      limits: {
        maximumComplexityScore: Number.MAX_SAFE_INTEGER,
        asynchronousComplexityThreshold: Number.MAX_SAFE_INTEGER,
      },
    },
    now: () => CUTOFF,
  });
  const request = {
    userId: USER_ID,
    idempotencyKey: 'performance-idempotent-replay',
    rule: smallRule(),
  } as const;
  const created = await application.create(request);
  const durations: number[] = [];
  const runIds = new Set([created.run.id]);
  const requestHashes = new Set([created.run.requestHash]);
  let errors = 0;
  for (let index = 0; index < 10; index += 1) {
    const started = performance.now();
    try {
      const replay = await application.create(request);
      durations.push(performance.now() - started);
      runIds.add(replay.run.id);
      requestHashes.add(replay.run.requestHash);
      if (!replay.replayed) errors += 1;
    } catch {
      errors += 1;
    }
  }
  const summary = summarizeDurations(durations);
  const newRuns = Math.max(0, runIds.size - 1);
  const configured = thresholds['PERF-SCN-006'];
  const limit = tightened(configured.p95Ms);
  return {
    id: 'PERF-SCN-006',
    name: 'Idempotent replay',
    fixtureSize: '25-instrument normalized request',
    workerConcurrency: WORKER_CONCURRENCY,
    batchSize: BATCH_SIZE,
    cacheMode: 'warm PostgreSQL idempotency lookup',
    repetitions: 10,
    ...summary,
    errorCount: errors,
    processedInstruments: 0,
    matchedInstruments: 0,
    threshold: `response p95 ≤ ${limit} ms; new runs = 0; request hash stable`,
    passed:
      summary.p95Ms <= limit &&
      errors <= configured.maximumErrors &&
      newRuns <= configured.maximumNewRuns &&
      requestHashes.size === 1,
    notes: [
      `new runs: ${newRuns}`,
      `request hash variants: ${requestHashes.size}`,
    ],
  };
}

function scenario(input: {
  readonly id: string;
  readonly name: string;
  readonly fixtureSize: string;
  readonly cacheMode: string;
  readonly repetitions: number;
  readonly summary: DurationSummary;
  readonly errors: number;
  readonly measurement: WorkerRunMeasurement;
  readonly threshold: string;
  readonly passed: boolean;
  readonly notes: readonly string[];
}): ScenarioResult {
  return {
    id: input.id,
    name: input.name,
    fixtureSize: input.fixtureSize,
    workerConcurrency: WORKER_CONCURRENCY,
    batchSize: BATCH_SIZE,
    cacheMode: input.cacheMode,
    repetitions: input.repetitions,
    ...input.summary,
    errorCount: input.errors,
    processedInstruments: input.measurement.processed,
    matchedInstruments: input.measurement.matched,
    threshold: input.threshold,
    passed: input.passed,
    notes: input.notes,
  };
}

async function runWorker(
  db: ReturnType<typeof createDatabase>['db'],
  queue: Queue<ScannerRunJobData>,
  events: QueueEvents,
  plan: ScanExecutionPlan,
  instrumentIds: readonly string[],
  key: string,
): Promise<WorkerRunMeasurement> {
  const runId = await insertRun(db, plan, instrumentIds, key);
  const progress: number[] = [];
  const listener = ({ jobId, data }: { jobId: string; data: unknown }) => {
    if (jobId === scannerJobId(runId) && isProgress(data)) {
      progress.push(data.processed);
    }
  };
  events.on('progress', listener);
  const started = performance.now();
  const job = await enqueueScannerRun(queue, {
    runId,
    correlationId: `performance-${key}`,
  });
  await job.waitUntilFinished(events, 180_000);
  const durationMs = performance.now() - started;
  events.off('progress', listener);
  const [rows, resultCounts] = await Promise.all([
    db.select().from(scanRuns).where(eq(scanRuns.id, runId)).limit(1),
    db
      .select({ value: count() })
      .from(scanResults)
      .where(eq(scanResults.scanRunId, runId)),
  ]);
  const row = rows[0];
  if (row?.status !== 'completed') {
    throw new Error(
      `Run ${runId} did not complete (${row?.status ?? 'missing'})`,
    );
  }
  return {
    durationMs,
    runId,
    processed: row.progressProcessed,
    matched: row.matchedCount,
    notEvaluable: row.notEvaluableCount,
    resultCount: Number(resultCounts[0]?.value ?? 0),
    progressMonotonic:
      progress.length > 0 &&
      progress.at(-1) === row.progressProcessed &&
      progress.every(
        (value, index) => index === 0 || value >= (progress[index - 1] ?? 0),
      ),
  };
}

async function insertRun(
  db: ReturnType<typeof createDatabase>['db'],
  plan: ScanExecutionPlan,
  instrumentIds: readonly string[],
  key: string,
): Promise<string> {
  const inserted = await db
    .insert(scanRuns)
    .values({
      sourceType: 'ad_hoc',
      requestedBy: USER_ID,
      idempotencyKeyHash: `performance-${key}`,
      requestHash: `performance-${key}`,
      executionMode: plan.executionMode,
      planVersion: plan.planVersion,
      ruleVersion: plan.normalizedRule.version,
      normalizedRuleAst: plan.normalizedRule as unknown as Record<
        string,
        unknown
      >,
      executionPlan: plan as unknown as Record<string, unknown>,
      universeSnapshot: {
        instrumentIds,
        filter: plan.universe.filter,
        resolvedAt: '2026-03-31T17:59:00.000Z',
      },
      complexityScore: String(plan.complexity.score),
      dataCutoffAt: CUTOFF,
      progressTotal: instrumentIds.length,
    })
    .returning({ id: scanRuns.id });
  const id = inserted[0]?.id;
  if (id === undefined) throw new Error('Could not insert performance run');
  return id;
}

function createPlan(
  rule: ScanRuleAst,
  instrumentCount: number,
  synchronous: boolean,
): ScanExecutionPlan {
  return planScanExecution(
    { rule, universeInstrumentCount: instrumentCount },
    {
      indicatorRegistry: createCoreIndicatorRegistry(),
      entitlement: { check: () => ({ allowed: true }) },
      limits: {
        maximumComplexityScore: Number.MAX_SAFE_INTEGER,
        asynchronousComplexityThreshold: synchronous
          ? Number.MAX_SAFE_INTEGER
          : 0,
      },
    },
  );
}

function smallRule(): ScanRuleAst {
  return rule([
    indicatorCondition('small-sma', 'SMA', { period: 3 }, 'GT', 0),
    indicatorCondition('small-ema', 'EMA', { period: 3 }, 'GT', 0),
  ]);
}

function fullRule(): ScanRuleAst {
  return rule([
    indicatorCondition('full-sma', 'SMA', { period: 3 }, 'GT', 0),
    indicatorCondition('full-ema', 'EMA', { period: 3 }, 'GT', 0),
    indicatorCondition('full-rsi', 'RSI', { period: 2 }, 'GTE', 0),
    {
      type: 'condition',
      nodeId: 'full-close',
      operator: 'GT',
      left: { type: 'priceField', field: 'close', timeframe: '1d' },
      right: { type: 'constantNumber', value: 0 },
    },
    {
      type: 'condition',
      nodeId: 'full-volume',
      operator: 'GT',
      left: { type: 'volumeField', field: 'volume', timeframe: '1d' },
      right: { type: 'constantNumber', value: 0 },
    },
    {
      type: 'condition',
      nodeId: 'full-active',
      operator: 'IS_TRUE',
      left: { type: 'marketField', field: 'isActive' },
    },
  ]);
}

function mediumRule(): ScanRuleAst {
  const emaDaily = indicator('EMA', { period: 20 }, '1d');
  const smaDaily = indicator('SMA', { period: 10 }, '1d');
  return {
    version: 1,
    universe: universe(),
    root: {
      type: 'group',
      nodeId: 'medium-root',
      operator: 'AND',
      children: [
        {
          type: 'group',
          nodeId: 'medium-daily',
          operator: 'AND',
          children: [
            operandCondition('medium-sma', smaDaily, 'GT', 0),
            operandCondition('medium-ema', emaDaily, 'GT', 0),
            indicatorCondition('medium-rsi', 'RSI', { period: 14 }, 'GT', 0),
            indicatorCondition('medium-atr', 'ATR', { period: 14 }, 'GT', 0),
          ],
        },
        {
          type: 'group',
          nodeId: 'medium-hourly',
          operator: 'OR',
          children: [
            operandCondition(
              'medium-roc',
              indicator('ROC', { period: 5 }, '1h'),
              'GT',
              -100,
            ),
            operandCondition(
              'medium-ema-hourly',
              indicator('EMA', { period: 20 }, '1h'),
              'GT',
              0,
            ),
          ],
        },
        {
          type: 'condition',
          nodeId: 'medium-cross',
          operator: 'CROSSES_ABOVE',
          left: smaDaily,
          right: emaDaily,
        },
      ],
    },
  };
}

function rule(children: ScanRuleAst['root']['children']): ScanRuleAst {
  return {
    version: 1,
    universe: universe(),
    root: { type: 'group', nodeId: 'root', operator: 'AND', children },
  };
}

function universe(): ScanRuleAst['universe'] {
  return {
    market: 'BIST',
    statuses: ['active'],
    indexCodes: [],
    sectorIds: [],
  };
}

function indicator(
  code: string,
  parameters: Readonly<Record<string, unknown>>,
  timeframe: IndicatorOperand['timeframe'],
): IndicatorOperand {
  return { type: 'indicator', code, version: 1, timeframe, parameters };
}

function indicatorCondition(
  nodeId: string,
  code: string,
  parameters: Readonly<Record<string, unknown>>,
  operator: 'GT' | 'GTE',
  value: number,
) {
  return operandCondition(
    nodeId,
    indicator(code, parameters, '1d'),
    operator,
    value,
  );
}

function operandCondition(
  nodeId: string,
  left: IndicatorOperand,
  operator: 'GT' | 'GTE',
  value: number,
) {
  return {
    type: 'condition' as const,
    nodeId,
    operator,
    left,
    right: { type: 'constantNumber' as const, value },
  };
}

async function resetInfrastructure(
  pool: ReturnType<typeof createDatabase>['pool'],
  db: ReturnType<typeof createDatabase>['db'],
  queue: Queue<ScannerRunJobData>,
  events: QueueEvents,
): Promise<void> {
  await pool.query('drop schema if exists public cascade');
  await pool.query('drop schema if exists drizzle cascade');
  await pool.query('create schema public');
  await runMigrations(db);
  await queue.waitUntilReady();
  await events.waitUntilReady();
  await queue.obliterate({ force: true });
}

async function seedFixture(
  db: ReturnType<typeof createDatabase>['db'],
): Promise<readonly string[]> {
  const provider = await db
    .insert(dataProviders)
    .values({
      code: 'scanner-performance-v1',
      name: 'Scanner Performance V1',
      status: 'active',
    })
    .returning({ id: dataProviders.id });
  const providerId = provider[0]?.id;
  if (providerId === undefined)
    throw new Error('Fixture provider insert failed');
  const ids = Array.from(
    { length: INSTRUMENT_COUNT },
    (_, index) =>
      `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  );
  await db.insert(instruments).values(
    ids.map((id, index) => ({
      id,
      symbol: `PF${String(index + 1).padStart(4, '0')}`,
      normalizedSymbol: `PF${String(index + 1).padStart(4, '0')}`,
      name: `Performance Fixture ${index + 1}`,
      marketCode: fixtureDefinition.market,
      currencyCode: 'TRY',
      status: 'active',
    })),
  );
  let chunk: Array<typeof priceBars.$inferInsert> = [];
  for (const [instrumentIndex, instrumentId] of ids.entries()) {
    const shortHistory =
      instrumentIndex >= INSTRUMENT_COUNT - SHORT_HISTORY_COUNT;
    for (const timeframe of fixtureDefinition.timeframes) {
      const bars = shortHistory
        ? fixtureDefinition.shortHistoryBarsPerTimeframe
        : timeframe === '1d'
          ? fixtureDefinition.dailyBarsPerInstrument
          : fixtureDefinition.hourlyBarsPerInstrument;
      for (let barIndex = 0; barIndex < bars; barIndex += 1) {
        const interval = timeframe === '1d' ? 86_400_000 : 3_600_000;
        const openTime = new Date(Date.UTC(2026, 0, 1) + barIndex * interval);
        const close = 100 + (instrumentIndex % 20) + barIndex * 0.5;
        chunk.push({
          instrumentId,
          providerId,
          timeframe,
          openTime,
          closeTime: new Date(openTime.getTime() + interval),
          open: String(close - 0.2),
          high: String(close + 0.8),
          low: String(close - 0.8),
          close: String(close),
          volume: String(10_000 + instrumentIndex * 10 + barIndex),
          isClosed: true,
        });
        if (chunk.length === 500) {
          await db.insert(priceBars).values(chunk);
          chunk = [];
        }
      }
    }
  }
  if (chunk.length > 0) await db.insert(priceBars).values(chunk);
  return ids;
}

async function repeat<T>(
  countValue: number,
  operation: (index: number) => Promise<T>,
): Promise<{ readonly values: readonly T[]; readonly errors: number }> {
  const values: T[] = [];
  let errors = 0;
  for (let index = 0; index < countValue; index += 1) {
    try {
      values.push(await operation(index));
    } catch {
      errors += 1;
    }
  }
  return { values, errors };
}

async function environmentMetadata(
  pool: ReturnType<typeof createDatabase>['pool'],
  queue: Queue<ScannerRunJobData>,
): Promise<Readonly<Record<string, unknown>>> {
  const postgres = await pool.query<{ version: string }>('select version()');
  const client = await queue.client;
  const redisInfo = await client.info();
  const redisVersion =
    redisInfo.match(/^redis_version:(.+)$/m)?.[1]?.trim() ?? 'unknown';
  return {
    commitSha: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
    }).trim(),
    nodeVersion: process.version,
    pnpmVersion:
      process.env.npm_config_user_agent?.match(/pnpm\/([^ ]+)/)?.[1] ??
      'unknown',
    operatingSystem: `${platform()} ${release()}`,
    hostname: hostname(),
    cpu: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    postgresql: postgres.rows[0]?.version ?? 'unknown',
    redis: redisVersion,
    workerConcurrency: WORKER_CONCURRENCY,
    batchSize: BATCH_SIZE,
  };
}

async function writeReports(report: BaselineReport): Promise<void> {
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  const jsonPath = `${REPORT_DIRECTORY}/scanner-runtime-baseline.json`;
  const markdownPath = `${REPORT_DIRECTORY}/scanner-runtime-baseline.md`;
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(markdownPath, `${markdownReport(report)}\n`, 'utf8'),
  ]);
  execFileSync(
    'pnpm',
    ['exec', 'prettier', '--write', jsonPath, markdownPath],
    {
      cwd: REPOSITORY_ROOT,
      stdio: 'ignore',
    },
  );
}

function markdownReport(report: BaselineReport): string {
  return [
    `# ${report.status} — Scanner Runtime Performance Baseline`,
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Environment',
    '',
    '```json',
    JSON.stringify(report.environment, null, 2),
    '```',
    '',
    '## Scenarios',
    '',
    ...report.scenarios.flatMap((item) => [
      `### ${item.id} — ${item.passed ? 'PASS' : 'FAIL'}`,
      '',
      `- Scenario: ${item.name}`,
      `- Fixture size: ${item.fixtureSize}`,
      `- Worker concurrency: ${item.workerConcurrency}`,
      `- Batch size: ${item.batchSize}`,
      `- Cache: ${item.cacheMode}`,
      `- Repetitions: ${item.repetitions}`,
      `- p50: ${item.p50Ms} ms`,
      `- p95: ${item.p95Ms} ms`,
      `- Maximum: ${item.maxMs} ms`,
      `- Errors: ${item.errorCount}`,
      `- Processed instruments: ${item.processedInstruments}`,
      `- Matched instruments: ${item.matchedInstruments}`,
      `- Threshold: ${item.threshold}`,
      ...item.notes.map((note) => `- ${note}`),
      '',
    ]),
  ].join('\n');
}

function selectedScenarios(arguments_: readonly string[]): Set<ScenarioName> {
  const index = arguments_.indexOf('--scenario');
  if (index < 0) return new Set(SCENARIOS);
  const value = arguments_[index + 1];
  if (value === undefined || !isScenarioName(value)) {
    throw new Error(
      `Unknown scanner performance scenario: ${value ?? '<missing>'}`,
    );
  }
  return new Set([value]);
}

function isScenarioName(value: string): value is ScenarioName {
  return SCENARIOS.some((scenarioName) => scenarioName === value);
}

function tightened(configured: number): number {
  const raw = process.env.SCANNER_PERF_MAX_P95_MS;
  if (raw === undefined) return configured;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('SCANNER_PERF_MAX_P95_MS must be a non-negative number');
  }
  return Math.min(configured, parsed);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  ) {
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  }
  return value;
}

function scannerJobId(runId: string): string {
  // Queue helper uses the same stable SHA-256 identifier; reading the job by the
  // returned id is safer, but progress polling deliberately reconstructs it.
  return `scanner-run-${createHash('sha256').update(runId).digest('hex').slice(0, 32)}`;
}

function isProgress(value: unknown): value is { readonly processed: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'processed' in value &&
    typeof value.processed === 'number'
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
