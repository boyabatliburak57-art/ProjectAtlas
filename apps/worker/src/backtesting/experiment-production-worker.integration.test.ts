import { randomUUID } from 'node:crypto';

import {
  backtestDataSnapshots,
  backtestRuns,
  backtestSummaries,
  createDatabase,
  instruments,
  researchExperimentRuns,
  researchExperiments,
  runMigrations,
  strategies,
  strategyRevisions,
} from '@atlas/database';
import {
  createExperimentChildBindings,
  generateExperimentCombinations,
  type ExperimentDefinitionInput,
  type StrategyDefinition,
} from '@atlas/domain';
import type { ExperimentQueuePayload } from '@atlas/types';
import { count, eq } from 'drizzle-orm';
import { Queue, QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WorkerEnvironment } from '../config/environment';
import {
  StructuredLogger,
  type LogSink,
} from '../observability/structured-logger';
import {
  createExperimentJobId,
  DEFAULT_JOB_OPTIONS,
  JOB_NAMES,
  QUEUE_NAMES,
} from '../queue/queue-contracts';
import { createRedisConnection } from '../queue/redis-connection';
import { WorkerRuntime } from '../runtime/worker-runtime';
import { BullMqExperimentDispatcher } from './experiment-queue';

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}

const databaseUrl = requireTestDatabaseUrl();
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const ownerUserId = '00000000-0000-4000-8000-000000000701';
const strategyId = '00000000-0000-4000-8000-000000000702';
const snapshotId = '00000000-0000-4000-8000-000000000703';
const snapshotHash = 'experiment-production-snapshot-v1';
const logs: string[] = [];

describe('production experiment PostgreSQL and BullMQ wiring', () => {
  const { db, pool } = createDatabase(databaseUrl);
  const connection = createRedisConnection(redisUrl);
  const queue = new Queue<ExperimentQueuePayload>(QUEUE_NAMES.experiments, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const events = new QueueEvents(QUEUE_NAMES.experiments, { connection });
  const dispatcher = new BullMqExperimentDispatcher(queue);
  const logger = new StructuredLogger('debug', {
    write: (line) => logs.push(line),
  } satisfies LogSink);
  let runtime: WorkerRuntime;

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await queue.waitUntilReady();
    await events.waitUntilReady();
    await queue.obliterate({ force: true });
    await seedCore();
    runtime = await WorkerRuntime.start(environment(), logger);
  }, 30_000);

  afterAll(async () => {
    await runtime?.stop('experiment-production-integration-complete');
    await Promise.allSettled([events.close(), queue.close(), pool.end()]);
  });

  it('1. persists API-shaped create through production queue to terminal state', async () => {
    const experimentId = await insertExperiment(definition([10]));
    await dispatchAndWait(experimentId);
    expect((await experiment(experimentId))?.status).toBe('completed');
    const job = await queue.getJob(createExperimentJobId(experimentId));
    expect(job?.data).toEqual({ experimentId });
  });

  it('2. orchestrates two or more deterministic combinations', async () => {
    const experimentId = await insertExperiment(definition([11, 12, 13]));
    await dispatchAndWait(experimentId);
    expect(await childCount(experimentId)).toBe(3);
  });

  it('3. orchestrates 100 combinations on the production processor', async () => {
    const input = definition(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    await seedReusableChildren(input);
    const experimentId = await insertExperiment(input);
    await dispatchAndWait(experimentId);
    expect(await childCount(experimentId)).toBe(100);
    expect((await experiment(experimentId))?.completedRunCount).toBe(100);
  }, 30_000);

  it('4. duplicate queue delivery does not create duplicate child runs', async () => {
    const experimentId = await insertExperiment(definition([14, 15]));
    await dispatchAndWait(experimentId);
    const before = await childCount(experimentId);
    await queue.add(
      JOB_NAMES.backtestExperiment,
      { experimentId },
      { jobId: `${createExperimentJobId(experimentId)}-duplicate` },
    );
    await waitForJob(`${createExperimentJobId(experimentId)}-duplicate`);
    expect(await childCount(experimentId)).toBe(before);
  });

  it('5. database unique key rejects duplicate experiment binding', async () => {
    const experimentId = await insertExperiment(definition([16]));
    await dispatchAndWait(experimentId);
    const [child] = await db
      .select()
      .from(researchExperimentRuns)
      .where(eq(researchExperimentRuns.experimentId, experimentId));
    await expect(
      db.insert(researchExperimentRuns).values({
        experimentId,
        ownerUserId,
        backtestRunId: child!.backtestRunId,
        bindingHash: child!.bindingHash,
        parameterBinding: child!.parameterBinding,
        combinationIndex: child!.combinationIndex + 1,
        sampleRole: child!.sampleRole,
        status: 'queued',
      }),
    ).rejects.toThrow();
  });

  it('6. reuses a compatible completed child run', async () => {
    const input = definition([17]);
    await seedReusableChildren(input);
    const before = await db.select({ value: count() }).from(backtestRuns);
    const experimentId = await insertExperiment(input);
    await dispatchAndWait(experimentId);
    const [child] = await db
      .select()
      .from(researchExperimentRuns)
      .where(eq(researchExperimentRuns.experimentId, experimentId));
    expect(child?.status).toBe('reused');
    const after = await db.select({ value: count() }).from(backtestRuns);
    expect(after).toEqual(before);
  });

  it('7. does not reuse an incompatible policy or snapshot run', async () => {
    const input = definition([18]);
    const [incompatible] = await seedReusableChildren(input, 'wrong-cost-v9');
    const experimentId = await insertExperiment(input);
    await dispatchAndWait(experimentId);
    const [child] = await db
      .select()
      .from(researchExperimentRuns)
      .where(eq(researchExperimentRuns.experimentId, experimentId));
    expect(child?.backtestRunId).not.toBe(incompatible);
  });

  it('8. records a deterministic child creation failure', async () => {
    const invalidSnapshotId = randomUUID();
    await db.insert(backtestDataSnapshots).values({
      id: invalidSnapshotId,
      snapshotHash: `not-evaluable-${invalidSnapshotId}`,
      schemaVersion: 1,
      marketRevisionHash: 'market-v1',
      universeRevisionHash: 'universe-v1',
      fundamentalRevisionHash: 'fundamental-v1',
      corporateActionRevisionHash: 'action-v1',
      dataCutoffAt: new Date('2025-01-05T15:00:00.000Z'),
      coverageStatus: 'not_evaluable',
    });
    const experimentId = await insertExperiment(
      definition([19]),
      invalidSnapshotId,
    );
    await dispatchAndWait(experimentId, true);
    expect((await experiment(experimentId))?.status).toBe('failed');
  });

  it('9. aggregates mixed child outcomes as partial', async () => {
    const input = definition([20, 21]);
    const experimentId = await insertExperiment(input);
    const children = createExperimentChildBindings(
      generateExperimentCombinations(input),
      input.grid.samples,
    );
    const completedRun = await insertCompletedRun(children[0]!);
    const failedRun = await insertCompletedRun(children[1]!, 'failed');
    await db
      .insert(researchExperimentRuns)
      .values([
        childRow(experimentId, children[0]!, completedRun),
        childRow(experimentId, children[1]!, failedRun),
      ]);
    await dispatchAndWait(experimentId);
    expect((await experiment(experimentId))?.status).toBe('partial');
  });

  it('10. stops queued combinations and reaches cancelled terminal state', async () => {
    const experimentId = await insertExperiment(definition([22, 23]));
    await db
      .update(researchExperiments)
      .set({ status: 'cancel_requested' })
      .where(eq(researchExperiments.id, experimentId));
    await dispatchAndWait(experimentId);
    expect((await experiment(experimentId))?.status).toBe('cancelled');
    expect(await childCount(experimentId)).toBe(0);
  });

  it('11. startup reconciliation restores a queued experiment after worker restart', async () => {
    await runtime.stop('synthetic-experiment-worker-restart');
    const experimentId = await insertExperiment(definition([24]));
    runtime = await WorkerRuntime.start(environment(), logger);
    await waitForTerminal(experimentId);
    expect((await experiment(experimentId))?.status).toBe('completed');
  }, 30_000);

  it('12. PostgreSQL reconciliation recovers a Redis-lost queued job', async () => {
    const experimentId = await insertExperiment(definition([25]));
    await runtime.stop('synthetic-redis-restart');
    await queue.obliterate({ force: true });
    runtime = await WorkerRuntime.start(environment(), logger);
    await waitForTerminal(experimentId);
    expect((await experiment(experimentId))?.status).toBe('completed');
  }, 30_000);

  it('13. retry-safe processing preserves one child per binding', async () => {
    const experimentId = await insertExperiment(definition([26, 27]));
    await Promise.all([
      dispatcher.dispatch(experimentId),
      queue.add(
        JOB_NAMES.backtestExperiment,
        { experimentId },
        { jobId: `${createExperimentJobId(experimentId)}-retry` },
      ),
    ]);
    await waitForTerminal(experimentId);
    expect(await childCount(experimentId)).toBe(2);
  });

  it('14. terminal-state race cannot transition a completed experiment twice', async () => {
    const experimentId = await insertExperiment(definition([28]));
    await dispatchAndWait(experimentId);
    const completedAt = (await experiment(experimentId))?.completedAt;
    await queue.add(
      JOB_NAMES.backtestExperiment,
      { experimentId },
      { jobId: `${createExperimentJobId(experimentId)}-terminal-race` },
    );
    await waitForJob(`${createExperimentJobId(experimentId)}-terminal-race`);
    expect((await experiment(experimentId))?.completedAt).toEqual(completedAt);
  });

  it('15. emits correlation logging, metrics-shaped counts and heartbeat health', async () => {
    const experimentId = await insertExperiment(definition([29]));
    await dispatchAndWait(experimentId);
    expect(
      logs.some(
        (line) =>
          line.includes('worker.experiment.terminal') &&
          line.includes(experimentId) &&
          line.includes('correlationId'),
      ),
    ).toBe(true);
    const systemQueue = new Queue(QUEUE_NAMES.system, { connection });
    expect(
      (await systemQueue.getJobs(['waiting', 'completed'])).length,
    ).toBeGreaterThan(0);
    await systemQueue.close();
  });

  async function seedCore() {
    await db.insert(instruments).values({
      id: '00000000-0000-4000-8000-000000000704',
      symbol: 'EXP',
      normalizedSymbol: 'EXP',
      name: 'Experiment Fixture',
      marketCode: 'BIST',
      currencyCode: 'TRY',
      status: 'active',
    });
    await db.insert(strategies).values({
      id: strategyId,
      ownerUserId,
      name: 'Production Experiment Strategy',
      status: 'validated',
      currentRevision: 1,
    });
    await db.insert(strategyRevisions).values({
      strategyId,
      revision: 1,
      schemaVersion: 1,
      definition: strategyDefinition() as unknown as Record<string, unknown>,
      parameterSchema: {},
      validationStatus: 'valid',
      complexityScore: 10,
      createdBy: ownerUserId,
    });
    await db.insert(backtestDataSnapshots).values({
      id: snapshotId,
      snapshotHash,
      schemaVersion: 1,
      marketRevisionHash: 'market-v1',
      universeRevisionHash: 'universe-v1',
      fundamentalRevisionHash: 'fundamental-v1',
      corporateActionRevisionHash: 'action-v1',
      dataCutoffAt: new Date('2025-01-05T15:00:00.000Z'),
      coverageStatus: 'complete',
      revisionManifest: { events: bars() },
    });
  }

  async function insertExperiment(
    input: ExperimentDefinitionInput,
    dataSnapshotId = snapshotId,
  ) {
    const id = randomUUID();
    await db.insert(researchExperiments).values({
      id,
      ownerUserId,
      strategyId,
      strategyRevision: 1,
      dataSnapshotId,
      name: `Experiment ${id}`,
      status: 'queued',
      experimentHash: randomUUID(),
      definition: input as unknown as Record<string, unknown>,
      combinationCount:
        generateExperimentCombinations(input).length *
        input.grid.samples.length,
    });
    return id;
  }

  async function seedReusableChildren(
    input: ExperimentDefinitionInput,
    costPolicyVersion = 'cost-v1',
  ) {
    const children = createExperimentChildBindings(
      generateExperimentCombinations(input),
      input.grid.samples,
    );
    const ids: string[] = [];
    for (const child of children)
      ids.push(await insertCompletedRun(child, 'completed', costPolicyVersion));
    return ids;
  }

  async function insertCompletedRun(
    child: ReturnType<typeof createExperimentChildBindings>[number],
    status: 'completed' | 'failed' = 'completed',
    costPolicyVersion = 'cost-v1',
  ) {
    const id = randomUUID();
    await db.insert(backtestRuns).values({
      id,
      strategyId,
      strategyRevision: 1,
      requestedBy: ownerUserId,
      status,
      requestHash: randomUUID(),
      idempotencyKeyHash: randomUUID(),
      engineVersion: 'backtest-engine-v1',
      executionPolicyVersion: 'next-open-v1',
      costPolicyVersion,
      metricPolicyVersion: 'backtest-metrics-v2',
      eventOrderingPolicyVersion: 'deterministic-event-ordering-v1',
      roundingPolicyVersion: 'decimal-half-even-v1',
      dataSnapshotId: snapshotId,
      parameters: { experimentBindingHash: child.bindingHash },
      universeSnapshot: { version: 'v1' },
      timeframe: '1d',
      adjustmentMode: 'raw',
      rangeFrom: new Date(child.rangeFrom),
      rangeTo: new Date(child.rangeTo),
      initialCapital: '100000',
      ...(status === 'completed'
        ? { completedAt: new Date(), progress: '100' }
        : { completedAt: new Date(), errorCode: 'SYNTHETIC_CHILD_FAILURE' }),
    });
    if (status === 'completed')
      await db.insert(backtestSummaries).values({
        runId: id,
        ownerUserId,
        endingEquity: '101000',
        totalReturn: '1',
        maximumDrawdown: '0',
        turnover: '0',
        exposure: '0',
        totalFees: '0',
        totalSlippage: '0',
        tradeCount: 0,
        methodology: { metrics: { totalReturn: { value: '1' } } },
      });
    return id;
  }

  async function dispatchAndWait(id: string, allowFailedJob = false) {
    await dispatcher.dispatch(id);
    try {
      await waitForJob(createExperimentJobId(id));
    } catch (error) {
      if (!allowFailedJob) throw error;
    }
    await waitForTerminal(id);
  }

  async function waitForJob(jobId: string): Promise<void> {
    const job = await queue.getJob(jobId);
    if (job === undefined) throw new Error('EXPERIMENT_JOB_NOT_FOUND');
    await job.waitUntilFinished(events, 20_000);
  }

  async function waitForTerminal(id: string) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const row = await experiment(id);
      if (
        ['completed', 'partial', 'failed', 'cancelled'].includes(
          row?.status ?? '',
        )
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('EXPERIMENT_TERMINAL_TIMEOUT');
  }

  async function experiment(id: string) {
    const [row] = await db
      .select()
      .from(researchExperiments)
      .where(eq(researchExperiments.id, id));
    return row;
  }

  async function childCount(id: string) {
    const [row] = await db
      .select({ value: count() })
      .from(researchExperimentRuns)
      .where(eq(researchExperimentRuns.experimentId, id));
    return Number(row?.value ?? 0);
  }
});

function environment(): WorkerEnvironment {
  return {
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    WORKER_CONCURRENCY: 2,
    WORKER_HEARTBEAT_INTERVAL_MS: 1_000,
    WORKER_LOG_LEVEL: 'debug',
    SCANNER_BATCH_SIZE: 100,
    SCANNER_BATCH_TIMEOUT_MS: 30_000,
    SCANNER_RUN_TIMEOUT_MS: 300_000,
    BACKTEST_EVENT_BATCH_SIZE: 10,
    BACKTEST_RUN_TIMEOUT_MS: 20_000,
    WORKER_STARTUP_TIMEOUT_MS: 10_000,
  };
}

function definition(values: readonly number[]): ExperimentDefinitionInput {
  return {
    parameterDefinitions: [
      {
        name: 'threshold',
        type: 'number',
        defaultValue: 10,
        minimum: 0,
        maximum: 200,
      },
    ],
    grid: {
      axes: [{ parameter: 'threshold', values }],
      samples: [
        {
          role: 'train',
          from: '2025-01-01T15:00:00.000Z',
          to: '2025-01-05T15:00:00.000Z',
        },
      ],
      maximumCombinations: 100,
    },
  };
}

function strategyDefinition(): StrategyDefinition {
  const universe = {
    market: 'BIST' as const,
    statuses: ['active' as const],
    indexCodes: [],
    sectorIds: [],
  };
  return {
    schemaVersion: 1,
    baseTimeframe: '1d',
    entryRule: {
      version: 1,
      universe,
      root: {
        type: 'group',
        nodeId: 'entry-root',
        operator: 'AND',
        children: [
          {
            type: 'condition',
            nodeId: 'entry-condition',
            operator: 'GT',
            left: { type: 'priceField', field: 'close', timeframe: '1d' },
            right: { type: 'parameter', name: 'threshold' },
          },
        ],
      },
    },
    exitRule: {
      version: 1,
      universe,
      root: {
        type: 'group',
        nodeId: 'exit-root',
        operator: 'AND',
        children: [
          {
            type: 'condition',
            nodeId: 'exit-condition',
            operator: 'LT',
            left: { type: 'priceField', field: 'close', timeframe: '1d' },
            right: { type: 'constantNumber', value: 5 },
          },
        ],
      },
    },
    filterRule: null,
    parameters: [
      {
        name: 'threshold',
        type: 'number',
        defaultValue: 10,
        minimum: 0,
        maximum: 200,
      },
    ],
    positionSizing: { type: 'fixedCash', amount: 1_000 },
    riskControls: {
      maxPositionWeight: 20,
      maxConcurrentPositions: 5,
      allowShort: false,
      allowLeverage: false,
      allowNegativeCash: false,
    },
    executionPolicy: {
      code: 'closed_bar_next_open',
      version: 'next-open-v1',
      signalBarPolicy: 'closed_only',
      higherTimeframeBarPolicy: 'closed_only',
      missingBarPolicy: 'skip_fill',
    },
    costPolicy: {
      code: 'percentage_commission_fixed_bps_slippage',
      version: 'cost-v1',
      commissionPercent: 0.1,
      minimumCommission: 1,
      slippageBps: 5,
      fixedFee: 0,
      marketTaxPercent: 0,
    },
    dataIntegrityPolicy: {
      universePolicy: 'point_in_time',
      fundamentalAvailabilityPolicy: 'publication_and_revision',
      corporateActionPolicyVersion: 'actions-v1',
      adjustmentMode: 'raw',
    },
    benchmarkCode: null,
  };
}

function bars() {
  return [10, 12, 8, 6].map((close, index) => ({
    eventId: `experiment-bar-${index}`,
    type: 'bar' as const,
    instrumentId: '00000000-0000-4000-8000-000000000704',
    symbol: 'EXP',
    timestamp: `2025-01-0${index + 1}T15:00:00.000Z`,
    open: String(close),
    high: String(close + 1),
    low: String(close - 1),
    close: String(close),
    volume: '100000',
    isClosed: true,
  }));
}

function childRow(
  experimentId: string,
  child: ReturnType<typeof createExperimentChildBindings>[number],
  backtestRunId: string,
) {
  return {
    experimentId,
    ownerUserId,
    backtestRunId,
    bindingHash: child.bindingHash,
    parameterBinding: child.values,
    combinationIndex: child.combinationIndex,
    sampleRole: child.sampleRole,
    status: 'queued',
  } as const;
}
