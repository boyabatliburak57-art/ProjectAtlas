import { randomUUID } from 'node:crypto';

import {
  backtestDataSnapshots,
  backtestFills,
  backtestSeriesChunks,
  backtestSummaries,
  backtestTrades,
  createDatabase,
  instruments,
  runMigrations,
  strategies,
  strategyRevisions,
} from '@atlas/database';
import {
  BacktestRunApplicationService,
  DeterministicBacktestEngine,
  ScannerBacktestSignalEvaluator,
  type BacktestBar,
  type BacktestExecutionPlan,
} from '@atlas/domain';
import type { BacktestRunQueuePayload } from '@atlas/types';
import { count, eq } from 'drizzle-orm';
import { Job, Queue, QueueEvents, UnrecoverableError, Worker } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  StructuredLogger,
  type LogSink,
} from '../observability/structured-logger';
import { BullMqBacktestRunDispatcher } from '../queue/backtest-queue';
import {
  DEFAULT_JOB_OPTIONS,
  createBacktestRunJobId,
  QUEUE_NAMES,
} from '../queue/queue-contracts';
import { createRedisConnection } from '../queue/redis-connection';
import { BacktestRunProcessor } from './backtest-run-processor';
import type {
  BacktestWorkerRepository,
  BacktestWorkerSnapshotResolver,
} from './contracts';
import { normalizeBacktestWorkerError } from './errors';
import { InMemoryBacktestRuntimeMetrics } from './metrics';
import { PostgresBacktestRuntimeRepository } from './postgres-backtest-runtime-repository';
import { PostgresBacktestSnapshotResolver } from './postgres-backtest-snapshot-resolver';

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}

const userId = '00000000-0000-4000-8000-000000000671';
const strategyId = '00000000-0000-4000-8000-000000000672';
const instrumentId = '00000000-0000-4000-8000-000000000673';
const snapshotId = '00000000-0000-4000-8000-000000000674';
const snapshotHash = 'snapshot-067-runtime';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

describe('backtest PostgreSQL and BullMQ runtime', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  const connection = createRedisConnection(redisUrl);
  const queue = new Queue<BacktestRunQueuePayload>(QUEUE_NAMES.backtests, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const events = new QueueEvents(QUEUE_NAMES.backtests, { connection });
  const postgres = new PostgresBacktestRuntimeRepository(db);
  const snapshotResolver = new PostgresBacktestSnapshotResolver(db);
  const metrics = new InMemoryBacktestRuntimeMetrics();
  const logger = new StructuredLogger('debug', {
    write: () => undefined,
  } satisfies LogSink);
  let failAfterPersist = false;
  let failAfterCheckpoint = false;
  let cancelAfterCheckpoint = false;
  let slowSnapshot = false;
  let restoredCheckpoint = false;

  const repository: BacktestWorkerRepository = {
    loadRun: async (runId) => {
      const run = await postgres.loadRun(runId);
      if (run?.checkpoint !== null && run?.checkpoint !== undefined)
        restoredCheckpoint = true;
      return run;
    },
    transition: (input) => postgres.transition(input),
    isCancellationRequested: (runId) => postgres.isCancellationRequested(runId),
    async saveCheckpoint(input) {
      await postgres.saveCheckpoint(input);
      if (cancelAfterCheckpoint) {
        cancelAfterCheckpoint = false;
        await postgres.requestCancellation({
          runId: input.runId,
          userId,
          requestedAt: new Date().toISOString(),
        });
      }
      if (failAfterCheckpoint) {
        failAfterCheckpoint = false;
        throw new Error('synthetic worker restart after checkpoint');
      }
    },
    async persistCompletedResult(input) {
      await postgres.persistCompletedResult(input);
      if (failAfterPersist) {
        failAfterPersist = false;
        throw new Error('synthetic post-commit connection loss');
      }
    },
    failRun: (input) => postgres.failRun(input),
  };
  const resolver: BacktestWorkerSnapshotResolver = {
    async resolve(input) {
      if (slowSnapshot) {
        slowSnapshot = false;
        await new Promise((resolve) => setTimeout(resolve, 1_750));
      }
      return snapshotResolver.resolve(input);
    },
  };
  const processor = new BacktestRunProcessor({
    repository,
    snapshotResolver: resolver,
    engine: new DeterministicBacktestEngine(
      new ScannerBacktestSignalEvaluator(),
    ),
    metrics,
    logger,
    eventBatchSize: 1,
    runTimeoutMs: 1_500,
  });
  const worker = new Worker<BacktestRunQueuePayload>(
    QUEUE_NAMES.backtests,
    async (job) => {
      try {
        return await processor.process(job);
      } catch (error: unknown) {
        const normalized = normalizeBacktestWorkerError(error);
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        if (!normalized.retryable || finalAttempt)
          await postgres.failRun({
            runId: job.data.runId,
            status:
              normalized.code === 'BACKTEST_RUN_TIMEOUT' ? 'expired' : 'failed',
            errorCode: normalized.code,
            occurredAt: new Date(),
          });
        if (!normalized.retryable)
          throw new UnrecoverableError(normalized.code);
        throw normalized;
      }
    },
    { connection, concurrency: 1 },
  );
  const service = new BacktestRunApplicationService({
    repository: postgres,
    snapshotResolver: {
      resolve: () =>
        Promise.resolve({
          id: snapshotId,
          hash: snapshotHash,
          dataCutoffAt: '2025-01-04T15:00:00.000Z',
          universeSnapshot: {
            instrumentIds: [instrumentId],
            version: 'history-v1',
          },
          events: runtimeEvents(),
          coverageStatus: 'complete',
        }),
    },
    entitlement: {
      authorize: () =>
        Promise.resolve({ allowed: true, maximumComplexityScore: 100 }),
    },
    dispatcher: new BullMqBacktestRunDispatcher(queue),
    idGenerator: randomUUID,
  });

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await queue.waitUntilReady();
    await events.waitUntilReady();
    await worker.waitUntilReady();
    await queue.obliterate({ force: true });
    await db.insert(instruments).values({
      id: instrumentId,
      symbol: 'BT67',
      normalizedSymbol: 'BT67',
      name: 'Backtest Runtime Fixture',
      marketCode: 'BIST',
      currencyCode: 'TRY',
      status: 'active',
    });
    await db.insert(strategies).values({
      id: strategyId,
      ownerUserId: userId,
      name: 'Runtime Strategy',
      status: 'validated',
      currentRevision: 1,
    });
    await db.insert(strategyRevisions).values({
      strategyId,
      revision: 1,
      schemaVersion: 1,
      definition: { fixture: true },
      validationStatus: 'valid',
      complexityScore: 10,
      createdBy: userId,
    });
    await db.insert(backtestDataSnapshots).values({
      id: snapshotId,
      snapshotHash,
      schemaVersion: 1,
      marketRevisionHash: 'market-r1',
      universeRevisionHash: 'universe-r1',
      fundamentalRevisionHash: 'fundamental-r1',
      corporateActionRevisionHash: 'actions-r1',
      dataCutoffAt: new Date('2025-01-04T15:00:00.000Z'),
      coverageStatus: 'complete',
      revisionManifest: { events: runtimeEvents() },
    });
  });

  afterAll(async () => {
    await Promise.allSettled([
      worker.close(),
      events.close(),
      queue.close(),
      pool.end(),
    ]);
  });

  it('1. persists a BullMQ queue job through to PostgreSQL results', async () => {
    const first = await service.create(createRequest('queue-result'));
    await waitFor(first.run.id);
    expect((await postgres.findById(first.run.id))?.status).toBe('completed');
    expect(
      await db
        .select({ value: count() })
        .from(backtestSummaries)
        .where(eq(backtestSummaries.runId, first.run.id)),
    ).toEqual([{ value: 1 }]);
    const [summary] = await db
      .select({
        annualizedReturn: backtestSummaries.annualizedReturn,
        annualizedVolatility: backtestSummaries.volatility,
        turnover: backtestSummaries.turnover,
        methodology: backtestSummaries.methodology,
      })
      .from(backtestSummaries)
      .where(eq(backtestSummaries.runId, first.run.id));
    expect(summary?.annualizedReturn).not.toBeNull();
    expect(summary?.annualizedVolatility).not.toBeNull();
    expect(Number(summary?.turnover)).toBeGreaterThan(0);
    expect(summary?.methodology).toMatchObject({
      metricPolicy: { version: 'backtest-metrics-v2' },
      metrics: {
        turnover: {
          status: 'complete',
          methodologyVersion: 'backtest-metrics-v2',
        },
      },
    });
  });

  it('2. replays the same idempotency key and request without a second run', async () => {
    const first = await service.create(createRequest('idempotent-replay'));
    const replay = await service.create(createRequest('idempotent-replay'));
    expect(replay).toMatchObject({ replayed: true, dispatched: false });
    expect(replay.run.id).toBe(first.run.id);
    await waitFor(first.run.id);
  });

  it('3. rejects the same idempotency key with a different request', async () => {
    await service.create(createRequest('idempotency-conflict'));
    await expect(
      service.create({
        ...createRequest('idempotency-conflict'),
        complexityScore: 11,
      }),
    ).rejects.toMatchObject({ code: 'BACKTEST_IDEMPOTENCY_CONFLICT' });
  });

  it('4. retries a transient post-commit failure to a terminal completion', async () => {
    failAfterPersist = true;
    const created = await service.create(createRequest('retry'));
    await waitFor(created.run.id);
    const job = await queue.getJob(createBacktestRunJobId(created.run.id));
    expect(job?.attemptsMade).toBeGreaterThanOrEqual(1);
    expect((await postgres.findById(created.run.id))?.status).toBe('completed');
  });

  it('5. prevents duplicate fills, trades and series chunks across retry', async () => {
    failAfterPersist = true;
    const created = await service.create(createRequest('retry-dedup'));
    await waitFor(created.run.id);
    expect(
      await db
        .select({ value: count() })
        .from(backtestFills)
        .where(eq(backtestFills.runId, created.run.id)),
    ).toEqual([{ value: 2 }]);
    expect(
      await db
        .select({ value: count() })
        .from(backtestTrades)
        .where(eq(backtestTrades.runId, created.run.id)),
    ).toEqual([{ value: 1 }]);
    expect(
      await db
        .select({ value: count() })
        .from(backtestSeriesChunks)
        .where(eq(backtestSeriesChunks.runId, created.run.id)),
    ).toEqual([{ value: 4 }]);
  });

  it('6. restores the durable checkpoint after a worker-attempt restart', async () => {
    restoredCheckpoint = false;
    failAfterCheckpoint = true;
    const created = await service.create(createRequest('checkpoint-restart'));
    await waitFor(created.run.id);
    expect(restoredCheckpoint).toBe(true);
    expect((await postgres.findById(created.run.id))?.status).toBe('completed');
  });

  it('7. cooperatively cancels between checkpoint batches', async () => {
    cancelAfterCheckpoint = true;
    const created = await service.create(createRequest('cancel'));
    await waitFor(created.run.id);
    expect((await postgres.findById(created.run.id))?.status).toBe('cancelled');
    expect(
      await db
        .select({ value: count() })
        .from(backtestFills)
        .where(eq(backtestFills.runId, created.run.id)),
    ).toEqual([{ value: 0 }]);
  });

  it('8. expires a timeout deterministically without an endless retry', async () => {
    slowSnapshot = true;
    const created = await service.create(createRequest('timeout'));
    await expect(waitFor(created.run.id)).rejects.toThrow();
    expect((await postgres.findById(created.run.id))?.status).toBe('expired');
  });

  it('9. preserves PostgreSQL completed results when Redis progress is unavailable', async () => {
    const updateProgress = vi
      .spyOn(Job.prototype, 'updateProgress')
      .mockRejectedValue(new Error('synthetic Redis restart'));
    const created = await service.create(createRequest('redis-restart'));
    await waitFor(created.run.id);
    updateProgress.mockRestore();
    expect((await postgres.findById(created.run.id))?.status).toBe('completed');
    expect(
      metrics.counters.get('backtest.progress.publish.failure'),
    ).toBeGreaterThan(0);
  });

  it('10. keeps completed/cancelled terminal state stable on duplicate processing', async () => {
    const created = await service.create(createRequest('terminal'));
    await waitFor(created.run.id);
    const fake = {
      data: { runId: created.run.id, correlationId: 'terminal-replay' },
      id: 'terminal-replay',
      updateProgress: vi.fn(),
    } as unknown as Job<BacktestRunQueuePayload>;
    expect(await processor.process(fake)).toBeNull();
    expect((await postgres.findById(created.run.id))?.status).toBe('completed');
  });

  async function waitFor(runId: string): Promise<unknown> {
    const job = await queue.getJob(createBacktestRunJobId(runId));
    if (job === undefined) throw new Error('BACKTEST_JOB_NOT_FOUND');
    return job.waitUntilFinished(events, 10_000);
  }
});

function createRequest(idempotencyKey: string) {
  return {
    userId,
    idempotencyKey,
    strategyId,
    strategyRevision: 1,
    executionPlan: executionPlan(),
    dataSnapshotHash: snapshotHash,
    rangeFrom: '2025-01-01T15:00:00.000Z',
    rangeTo: '2025-01-04T15:00:00.000Z',
    complexityScore: 10,
  };
}

function executionPlan(): BacktestExecutionPlan {
  const rule = (operator: 'GT' | 'LT', value: number) => ({
    version: 1 as const,
    universe: {
      market: 'BIST' as const,
      statuses: ['active' as const],
      indexCodes: [],
      sectorIds: [],
    },
    root: {
      type: 'group' as const,
      nodeId: `root-${operator}`,
      operator: 'AND' as const,
      children: [
        {
          type: 'condition' as const,
          nodeId: `condition-${operator}`,
          operator,
          left: {
            type: 'priceField' as const,
            field: 'close' as const,
            timeframe: '1d' as const,
          },
          right: { type: 'constantNumber' as const, value },
        },
      ],
    },
  });
  return {
    runId: 'runtime-assigned',
    strategyRevisionId: 'revision-1',
    dataSnapshotHash: snapshotHash,
    engineVersion: 'engine-v1',
    executionPolicyVersion: 'closed-bar-next-open-v1',
    eventOrderingPolicyVersion: 'ordering-v1',
    roundingPolicyVersion: 'whole-share-v1',
    timeframe: '1d',
    initialCash: '1000',
    entryRule: rule('GT', 10),
    exitRule: rule('LT', 10),
    positionSizing: { type: 'fixedCash', amount: '500' },
    maxConcurrentPositions: 5,
    fractionalShares: false,
    allowShort: false,
    allowLeverage: false,
    liquidateAtEnd: false,
  };
}

function runtimeEvents(): readonly BacktestBar[] {
  return [
    bar(1, '11', '10'),
    bar(2, '13', '12'),
    bar(3, '9', '10'),
    bar(4, '8', '8'),
  ];
}

function bar(day: number, close: string, open: string): BacktestBar {
  return {
    eventId: `BT67-${day}`,
    type: 'bar',
    instrumentId,
    symbol: 'BT67',
    timestamp: `2025-01-0${day}T15:00:00.000Z`,
    open,
    high: close,
    low: close,
    close,
    volume: '100000',
    isClosed: true,
  };
}
