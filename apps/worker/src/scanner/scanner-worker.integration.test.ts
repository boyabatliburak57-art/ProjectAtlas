import {
  createDatabase,
  dataProviders,
  instruments,
  priceBars,
  runMigrations,
  scanResults,
  scanRunBatches,
  scanRuns,
} from '@atlas/database';
import {
  createCoreIndicatorRegistry,
  planScanExecution,
  type ScanExecutionPlan,
} from '@atlas/domain';
import { count, eq } from 'drizzle-orm';
import { Job, Queue, QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseEnvironment } from '../config/environment';
import {
  StructuredLogger,
  type LogSink,
} from '../observability/structured-logger';
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from '../queue/queue-contracts';
import { createRedisConnection } from '../queue/redis-connection';
import { enqueueScannerRun } from '../queue/scanner-queue';
import { WorkerRuntime } from '../runtime/worker-runtime';
import type {
  ScannerMarketDataLoader,
  ScannerRunJobData,
  ScannerRuntimeRepository,
} from './contracts';
import { InMemoryScannerMetrics } from './metrics';
import { PostgresScannerMarketDataLoader } from './postgres-market-data-loader';
import { PostgresScannerRuntimeRepository } from './postgres-scanner-runtime-repository';
import { createScannerComposition } from './scanner-composition';

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

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const userId = '00000000-0000-4000-8000-000000000801';
const instrumentIds = [
  '00000000-0000-4000-8000-000000000811',
  '00000000-0000-4000-8000-000000000812',
  '00000000-0000-4000-8000-000000000813',
] as const;
const cutoff = new Date('2026-07-13T18:00:00.000Z');

function executionPlan(): ScanExecutionPlan {
  return planScanExecution(
    {
      universeInstrumentCount: instrumentIds.length,
      rule: {
        version: 1,
        universe: {
          market: 'BIST',
          statuses: ['active'],
          indexCodes: [],
          sectorIds: [],
        },
        root: {
          type: 'group',
          nodeId: 'root',
          operator: 'AND',
          children: [
            {
              type: 'condition',
              nodeId: 'close-above-sma',
              operator: 'GT',
              left: { type: 'priceField', field: 'close', timeframe: '1d' },
              right: {
                type: 'indicator',
                code: 'SMA',
                version: 1,
                timeframe: '1d',
                parameters: { period: 3 },
              },
            },
          ],
        },
      },
    },
    {
      indicatorRegistry: createCoreIndicatorRegistry(),
      entitlement: { check: () => ({ allowed: true }) },
      limits: {
        maximumComplexityScore: 100_000,
        asynchronousComplexityThreshold: 0,
      },
    },
  );
}

describe('scanner BullMQ queue-to-result runtime', () => {
  const databaseUrl = requireTestDatabaseUrl();
  const { db, pool } = createDatabase(databaseUrl);
  const connection = createRedisConnection(redisUrl);
  const queue = new Queue<ScannerRunJobData>(QUEUE_NAMES.scanner, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const queueEvents = new QueueEvents(QUEUE_NAMES.scanner, { connection });
  const logs: string[] = [];
  const logger = new StructuredLogger('debug', {
    write: (line) => logs.push(line),
  } satisfies LogSink);
  const metrics = new InMemoryScannerMetrics();
  const postgresRepository = new PostgresScannerRuntimeRepository(db);
  const postgresLoader = new PostgresScannerMarketDataLoader(db);
  let failAfterFirstCommit = true;
  let cancellationTarget: string | null = null;
  let timeoutNextLoad = false;

  const repository: ScannerRuntimeRepository = {
    loadRun: (runId) => postgresRepository.loadRun(runId),
    startRun: (runId, occurredAt) =>
      postgresRepository.startRun(runId, occurredAt),
    isCancellationRequested: (runId) =>
      postgresRepository.isCancellationRequested(runId),
    beginBatch: (input) => postgresRepository.beginBatch(input),
    async completeBatch(input) {
      const progress = await postgresRepository.completeBatch(input);
      if (failAfterFirstCommit) {
        failAfterFirstCommit = false;
        throw new Error('synthetic transient post-commit failure');
      }
      return progress;
    },
    completeRun: (runId, occurredAt) =>
      postgresRepository.completeRun(runId, occurredAt),
    cancelRun: (runId, occurredAt) =>
      postgresRepository.cancelRun(runId, occurredAt),
    failRun: (runId, errorCode, occurredAt) =>
      postgresRepository.failRun(runId, errorCode, occurredAt),
  };
  const loader: ScannerMarketDataLoader = {
    async load(input) {
      if (timeoutNextLoad) {
        timeoutNextLoad = false;
        await new Promise((resolve) => setTimeout(resolve, 2_100));
      }
      const result = await postgresLoader.load(input);
      if (cancellationTarget !== null) {
        const runId = cancellationTarget;
        cancellationTarget = null;
        await db
          .update(scanRuns)
          .set({ status: 'cancel_requested', cancelRequestedAt: new Date() })
          .where(eq(scanRuns.id, runId));
      }
      return result;
    },
  };
  let runtime: WorkerRuntime;

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await queue.waitUntilReady();
    await queueEvents.waitUntilReady();
    await queue.obliterate({ force: true });

    const provider = await db
      .insert(dataProviders)
      .values({
        code: 'scanner-fixture',
        name: 'Scanner Fixture',
        status: 'active',
      })
      .returning({ id: dataProviders.id });
    await db.insert(instruments).values(
      instrumentIds.map((id, index) => ({
        id,
        symbol: `FIX${index + 1}`,
        normalizedSymbol: `FIX${index + 1}`,
        name: `Scanner Fixture ${index + 1}`,
        marketCode: 'BIST',
        currencyCode: 'TRY',
        status: 'active',
      })),
    );
    const closes = [[1, 2, 3, 10], [10, 9, 8, 1], [5]];
    for (const [instrumentIndex, instrumentId] of instrumentIds.entries()) {
      for (const [barIndex, close] of (
        closes[instrumentIndex] ?? []
      ).entries()) {
        const openTime = new Date(
          `2026-07-${String(barIndex + 1).padStart(2, '0')}T07:00:00.000Z`,
        );
        await db.insert(priceBars).values({
          instrumentId,
          providerId: provider[0]?.id ?? '',
          timeframe: '1d',
          openTime,
          closeTime: new Date(openTime.getTime() + 8 * 60 * 60 * 1_000),
          open: String(close),
          high: String(close),
          low: String(close),
          close: String(close),
          volume: '1000',
          isClosed: true,
        });
      }
    }

    const scannerComposition = createScannerComposition({
      database: db,
      repository,
      marketDataLoader: loader,
      metrics,
      logger,
      batchSize: 1,
      batchTimeoutMs: 2_000,
      runTimeoutMs: 20_000,
    });
    runtime = await WorkerRuntime.start(
      parseEnvironment({
        DATABASE_URL: databaseUrl,
        REDIS_URL: redisUrl,
        WORKER_CONCURRENCY: 1,
        WORKER_HEARTBEAT_INTERVAL_MS: 60_000,
      }),
      logger,
      { process: () => Promise.resolve(), close: () => Promise.resolve() },
      scannerComposition,
    );
  });

  afterAll(async () => {
    await runtime?.stop('scanner-integration-cleanup');
    await Promise.allSettled([queueEvents.close(), queue.close(), pool.end()]);
  });

  it('runs batches to durable results and retries without duplicates', async () => {
    const runId = await insertRun('retry-run');
    const progress: number[] = [];
    const listener = ({ data }: { jobId: string; data: unknown }) => {
      if (isProgress(data)) {
        progress.push(data.processed);
      }
    };
    queueEvents.on('progress', listener);
    const job = await enqueueScannerRun(
      queue,
      { runId, correlationId: 'correlation-scanner-retry' },
      { attempts: 2, backoff: { type: 'fixed', delay: 10 } },
    );
    await job.waitUntilFinished(queueEvents, 15_000);
    queueEvents.off('progress', listener);

    const persistedRun = await db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, runId));
    expect(persistedRun[0]).toMatchObject({
      status: 'completed',
      progressProcessed: 3,
      matchedCount: 1,
      notEvaluableCount: 1,
    });
    expect(
      await db
        .select({ value: count() })
        .from(scanResults)
        .where(eq(scanResults.scanRunId, runId)),
    ).toEqual([{ value: 2 }]);
    const resultRows = await db
      .select()
      .from(scanResults)
      .where(eq(scanResults.scanRunId, runId));
    const matched = resultRows.find((row) => row.status === 'matched');
    const notEvaluable = resultRows.find(
      (row) => row.status === 'not_evaluable',
    );
    expect(matched?.explanation).toMatchObject({
      version: 1,
      status: 'matched',
    });
    expect(notEvaluable?.explanation).toMatchObject({
      version: 1,
      status: 'notEvaluable',
    });
    expect(
      await db
        .select({ value: count() })
        .from(scanRunBatches)
        .where(eq(scanRunBatches.scanRunId, runId)),
    ).toEqual([{ value: 3 }]);
    expect((await queue.getJob(job.id ?? ''))?.attemptsMade).toBe(2);
    expect(
      progress.every(
        (value, index) => index === 0 || value >= (progress[index - 1] ?? 0),
      ),
    ).toBe(true);

    const parsedLogs = logs.map(
      (line) => JSON.parse(line) as Record<string, unknown>,
    );
    expect(parsedLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlationId: 'correlation-scanner-retry',
          dataCutoffAt: cutoff.toISOString(),
          event: 'worker.scanner.batch.completed',
          jobId: job.id,
          planVersion: 1,
          ruleVersion: 1,
          runId,
          userId,
        }),
      ]),
    );
    expect(metrics.counters.get('scanner.instruments.processed')).toBe(2);
  }, 20_000);

  it('cooperatively cancels at the next batch boundary', async () => {
    const runId = await insertRun('cancel-run');
    cancellationTarget = runId;
    const job = await enqueueScannerRun(queue, {
      runId,
      correlationId: 'correlation-scanner-cancel',
    });
    await job.waitUntilFinished(queueEvents, 10_000);
    const persisted = await db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, runId));
    expect(persisted[0]).toMatchObject({
      status: 'cancelled',
      progressProcessed: 1,
    });
  });

  it('keeps PostgreSQL results when fast Redis progress publication fails', async () => {
    const runId = await insertRun('progress-loss-run');
    const updateProgress = vi
      .spyOn(Job.prototype, 'updateProgress')
      .mockRejectedValue(new Error('synthetic Redis progress loss'));
    const job = await enqueueScannerRun(queue, {
      runId,
      correlationId: 'correlation-progress-loss',
    });
    await job.waitUntilFinished(queueEvents, 10_000);
    updateProgress.mockRestore();
    const persisted = await db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, runId));
    expect(persisted[0]).toMatchObject({
      status: 'completed',
      progressProcessed: 3,
    });
    expect(
      metrics.counters.get('scanner.progress.publish.failure'),
    ).toBeGreaterThan(0);
  });

  it('marks a timed-out run and active batch failed without retrying forever', async () => {
    const runId = await insertRun('timeout-run');
    timeoutNextLoad = true;
    const job = await enqueueScannerRun(
      queue,
      { runId, correlationId: 'correlation-scanner-timeout' },
      { attempts: 1 },
    );
    await expect(job.waitUntilFinished(queueEvents, 10_000)).rejects.toThrow();
    const persisted = await db
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, runId));
    const batches = await db
      .select()
      .from(scanRunBatches)
      .where(eq(scanRunBatches.scanRunId, runId));
    expect(persisted[0]).toMatchObject({
      status: 'failed',
      errorCode: 'SCANNER_BATCH_TIMEOUT',
    });
    expect(persisted[0]?.timeoutAt).toBeInstanceOf(Date);
    expect(batches[0]).toMatchObject({
      status: 'failed',
      errorCode: 'SCANNER_BATCH_TIMEOUT',
    });
  });

  async function insertRun(key: string): Promise<string> {
    const plan = executionPlan();
    const inserted = await db
      .insert(scanRuns)
      .values({
        sourceType: 'ad_hoc',
        requestedBy: userId,
        idempotencyKeyHash: key,
        requestHash: key,
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
          resolvedAt: '2026-07-13T17:59:00.000Z',
        },
        complexityScore: String(plan.complexity.score),
        dataCutoffAt: cutoff,
        progressTotal: instrumentIds.length,
      })
      .returning({ id: scanRuns.id });
    return inserted[0]?.id ?? '';
  }
});

function isProgress(value: unknown): value is { readonly processed: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'processed' in value &&
    typeof value.processed === 'number'
  );
}
