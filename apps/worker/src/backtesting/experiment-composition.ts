import { randomUUID } from 'node:crypto';

import {
  backtestDataSnapshots,
  createDatabase,
  type Database,
} from '@atlas/database';
import {
  BacktestRunApplicationService,
  type BacktestDataSnapshotResolution,
  type BacktestExecutionPlan,
  type ExperimentChildBinding,
  type ExperimentChildRunPort,
  type ScanRuleAst,
  type StrategyDefinition,
} from '@atlas/domain';
import type {
  BacktestRunQueuePayload,
  ExperimentQueuePayload,
} from '@atlas/types';
import { eq } from 'drizzle-orm';
import type { Job, Queue } from 'bullmq';
import { UnrecoverableError } from 'bullmq';

import type { WorkerEnvironment } from '../config/environment';
import type { StructuredLogger } from '../observability/structured-logger';
import { JOB_NAMES } from '../queue/queue-contracts';
import { BullMqBacktestRunDispatcher } from '../queue/backtest-queue';
import { ExperimentProductionRepository } from './experiment-production-repository';
import { ExperimentProcessor } from './experiment-processor';
import { InMemoryExperimentRuntimeMetrics } from './experiment-metrics';
import { PostgresBacktestRuntimeRepository } from './postgres-backtest-runtime-repository';
import { PostgresExperimentRuntimeRepository } from './postgres-experiment-runtime-repository';
import { BullMqExperimentDispatcher } from './experiment-queue';

export interface ExperimentComposition {
  process(job: Job<ExperimentQueuePayload>): Promise<unknown>;
  reconcile(
    queue: Queue<ExperimentQueuePayload>,
    limit?: number,
  ): Promise<number>;
  close(): Promise<void>;
}

export function createDefaultExperimentComposition(
  environment: WorkerEnvironment,
  logger: StructuredLogger,
  backtestQueue: Queue<BacktestRunQueuePayload>,
): ExperimentComposition {
  const { db, pool } = createDatabase(environment.DATABASE_URL);
  const runtimeRepository = new PostgresExperimentRuntimeRepository(db);
  const productionRepository = new ExperimentProductionRepository(db);
  const runRepository = new PostgresBacktestRuntimeRepository(db);
  const runs = new BacktestRunApplicationService({
    repository: runRepository,
    snapshotResolver: applicationSnapshotResolver(db),
    entitlement: {
      authorize: () =>
        Promise.resolve({ allowed: true, maximumComplexityScore: 1_000_000 }),
    },
    dispatcher: new BullMqBacktestRunDispatcher(backtestQueue),
    idGenerator: randomUUID,
  });
  const childRuns = new AuthoritativeExperimentChildRunPort(
    runs,
    productionRepository,
  );
  const processor = new ExperimentProcessor({
    productionRepository,
    runtimeRepository,
    childRuns,
    metrics: new InMemoryExperimentRuntimeMetrics(),
    logger,
    timeoutMs: environment.BACKTEST_RUN_TIMEOUT_MS,
  });
  return {
    async process(job) {
      if (job.name !== JOB_NAMES.backtestExperiment)
        throw new UnrecoverableError('Unsupported experiment job type');
      try {
        return await processor.process(job);
      } catch (error: unknown) {
        const deterministic =
          error instanceof Error &&
          (error.message.includes('INVALID') ||
            error.message.includes('NOT_FOUND') ||
            error.message.includes('LIMIT'));
        logger.error('worker.experiment.failed', {
          attempt: job.attemptsMade + 1,
          errorType:
            error instanceof Error ? error.constructor.name : 'UnknownError',
          experimentId: job.data.experimentId,
          retryable: !deterministic,
        });
        if (deterministic) {
          await productionRepository.fail(
            job.data.experimentId,
            error instanceof Error ? error.message : 'EXPERIMENT_INVALID',
          );
          throw new UnrecoverableError(
            error instanceof Error ? error.message : 'EXPERIMENT_INVALID',
          );
        }
        throw error;
      }
    },
    async reconcile(queue, limit = 100) {
      const dispatcher = new BullMqExperimentDispatcher(queue);
      const ids = await productionRepository.listDispatchable(limit);
      let dispatched = 0;
      for (const id of ids) {
        await dispatcher.dispatch(id);
        dispatched += 1;
      }
      return dispatched;
    },
    async close() {
      await pool.end();
    },
  };
}

class AuthoritativeExperimentChildRunPort implements ExperimentChildRunPort {
  constructor(
    private readonly runs: BacktestRunApplicationService,
    private readonly experiments: ExperimentProductionRepository,
  ) {}

  async create(input: Parameters<ExperimentChildRunPort['create']>[0]) {
    const authoritative = await this.experiments.loadAuthoritative(
      input.experiment.id,
    );
    if (authoritative === null) throw new Error('EXPERIMENT_NOT_FOUND');
    const created = await this.runs.create({
      userId: input.experiment.ownerUserId,
      idempotencyKey: `experiment:${input.experiment.id}:${input.child.bindingHash}`,
      strategyId: input.experiment.strategyId,
      strategyRevision: input.experiment.strategyRevision,
      executionPlan: executionPlan(authoritative, input.child),
      dataSnapshotHash: input.experiment.dataSnapshotHash,
      rangeFrom: input.child.rangeFrom,
      rangeTo: input.child.rangeTo,
      complexityScore: authoritative.complexityScore,
      experimentBinding: {
        hash: input.child.bindingHash,
        sampleRole: input.child.sampleRole,
        values: input.child.values,
      },
    });
    return { runId: created.run.id };
  }

  async requestCancellation(runId: string, userId: string): Promise<void> {
    await this.runs.requestCancellation(runId, userId);
  }
}

function applicationSnapshotResolver(database: Database) {
  return {
    async resolve(input: {
      readonly snapshotHash: string;
    }): Promise<BacktestDataSnapshotResolution> {
      const rows = await database
        .select()
        .from(backtestDataSnapshots)
        .where(eq(backtestDataSnapshots.snapshotHash, input.snapshotHash))
        .limit(1);
      const row = rows[0];
      if (row === undefined)
        return {
          id: randomUUID(),
          hash: '',
          dataCutoffAt: new Date(0).toISOString(),
          universeSnapshot: {},
          events: [],
          coverageStatus: 'notEvaluable' as const,
        };
      return {
        id: row.id,
        hash: row.snapshotHash,
        dataCutoffAt: row.dataCutoffAt.toISOString(),
        universeSnapshot: { hash: row.universeRevisionHash },
        events: [],
        coverageStatus:
          row.coverageStatus === 'not_evaluable'
            ? 'notEvaluable'
            : row.coverageStatus === 'partial'
              ? 'partial'
              : 'complete',
      };
    },
  };
}

function executionPlan(
  authoritative: NonNullable<
    Awaited<ReturnType<ExperimentProductionRepository['loadAuthoritative']>>
  >,
  child: ExperimentChildBinding,
): BacktestExecutionPlan {
  const strategy = authoritative.strategyDefinition;
  return {
    runId: 'runtime-assigned',
    strategyRevisionId: authoritative.strategyRevisionId,
    dataSnapshotHash: authoritative.runtime.dataSnapshotHash,
    engineVersion: 'backtest-engine-v1',
    executionPolicyVersion: strategy.executionPolicy.version,
    eventOrderingPolicyVersion: 'deterministic-event-ordering-v1',
    roundingPolicyVersion: 'decimal-half-even-v1',
    timeframe: strategy.baseTimeframe,
    initialCash: runtimeInitialCash(authoritative.definition),
    entryRule: bindRule(strategy.entryRule, child.values),
    exitRule: bindRule(strategy.exitRule, child.values),
    positionSizing: positionSizing(strategy),
    costPolicy:
      strategy.costPolicy.code === 'cost_free'
        ? { type: 'costFree', version: strategy.costPolicy.version }
        : {
            type: 'linear',
            version: strategy.costPolicy.version,
            commissionPercent: String(strategy.costPolicy.commissionPercent),
            minimumCommission: String(strategy.costPolicy.minimumCommission),
            fixedFee: String(strategy.costPolicy.fixedFee),
            marketTaxPercent: String(strategy.costPolicy.marketTaxPercent),
            slippageBps: String(strategy.costPolicy.slippageBps),
          },
    riskPolicy: {
      ...(strategy.riskControls.stopLossPercent === undefined
        ? {}
        : { stopLossPercent: String(strategy.riskControls.stopLossPercent) }),
      ...(strategy.riskControls.takeProfitPercent === undefined
        ? {}
        : {
            takeProfitPercent: String(strategy.riskControls.takeProfitPercent),
          }),
      ...(strategy.riskControls.trailingStopPercent === undefined
        ? {}
        : {
            trailingStopPercent: String(
              strategy.riskControls.trailingStopPercent,
            ),
          }),
      ...(strategy.riskControls.maxHoldingBars === undefined
        ? {}
        : { maximumHoldingBars: strategy.riskControls.maxHoldingBars }),
      maximumPositionWeightPercent: String(
        strategy.riskControls.maxPositionWeight,
      ),
      sameBarAmbiguityPolicy: 'stopFirst',
    },
    corporateActionPolicy: {
      version: strategy.dataIntegrityPolicy.corporateActionPolicyVersion,
      adjustmentMode:
        strategy.dataIntegrityPolicy.adjustmentMode === 'split_adjusted'
          ? 'splitAdjusted'
          : strategy.dataIntegrityPolicy.adjustmentMode ===
              'total_return_adjusted'
            ? 'totalReturnAdjusted'
            : 'raw',
      delistingPolicy: 'lastAvailableClose',
    },
    maxConcurrentPositions: strategy.riskControls.maxConcurrentPositions,
    fractionalShares: false,
    allowShort: false,
    allowLeverage: false,
    liquidateAtEnd: true,
  };
}

function positionSizing(strategy: StrategyDefinition) {
  const sizing = strategy.positionSizing;
  if (sizing.type === 'equalWeight') return { type: 'equalWeight' as const };
  if (sizing.type === 'fixedCash')
    return { type: 'fixedCash' as const, amount: String(sizing.amount) };
  if (sizing.type === 'fixedPercent')
    return {
      type: 'fixedPercentage' as const,
      percent: String(sizing.percent),
    };
  throw new Error('EXPERIMENT_POSITION_SIZING_UNSUPPORTED');
}

function runtimeInitialCash(definition: unknown): string {
  const runtime = (definition as { runtime?: { initialCash?: unknown } })
    .runtime;
  return typeof runtime?.initialCash === 'string' &&
    runtime.initialCash.length > 0
    ? runtime.initialCash
    : '100000';
}

function bindRule(
  rule: StrategyDefinition['entryRule'],
  values: ExperimentChildBinding['values'],
): ScanRuleAst {
  const bind = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(bind);
    if (value === null || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (record['type'] === 'parameter') {
      const parameter = values[String(record['name'])];
      if (typeof parameter === 'number')
        return { type: 'constantNumber', value: parameter };
      if (typeof parameter === 'boolean')
        return { type: 'constantBoolean', value: parameter };
      throw new Error('EXPERIMENT_PARAMETER_OPERAND_UNSUPPORTED');
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [key, bind(item)]),
    );
  };
  return bind(rule) as ScanRuleAst;
}
