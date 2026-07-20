import { createHash, randomUUID } from 'node:crypto';

import {
  backtestDataSnapshots,
  backtestFills,
  backtestOrders,
  backtestRuns,
  backtestSeriesChunks,
  backtestSummaries,
  backtestTrades,
  researchExperimentRuns,
  researchExperiments,
  strategies,
  strategyRevisions,
} from '@atlas/database';
import {
  BACKTEST_METRIC_POLICY,
  BacktestRunApplicationService,
  createStrategyEntity,
  createStrategyRevision,
  StrategyApplicationService,
  validateStrategyDefinition,
  type BacktestExecutionPlan,
  type BacktestDataSnapshotResolution,
  type BacktestRunCreationInput,
  type BacktestRunRecord,
  type BacktestRunRepository,
  type NewStrategyPersistenceInput,
  type ReviseStrategyPersistenceInput,
  type StrategyRevision,
  type StrategyWithRevision,
} from '@atlas/domain';
import {
  ATLAS_JOB_NAMES,
  ATLAS_QUEUE_NAMES,
  type BacktestRunQueuePayload,
  type ExperimentQueuePayload,
} from '@atlas/types';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm';
import { Queue } from 'bullmq';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';
import type {
  BacktestAnalyticsStore,
  BacktestCommandGuard,
  ExperimentRecord,
  ExperimentStore,
  StrategyApiRepository,
} from './backtests.ports';

type StrategyRow = typeof strategies.$inferSelect;
type RevisionRow = typeof strategyRevisions.$inferSelect;
type RunRow = typeof backtestRuns.$inferSelect;

@Injectable()
export class PostgresStrategyApiRepository implements StrategyApiRepository {
  constructor(private readonly connection: ApiDatabase) {}

  async findById(id: string): Promise<StrategyWithRevision | null> {
    const rows = await this.connection.database
      .select({ strategy: strategies, revision: strategyRevisions })
      .from(strategies)
      .innerJoin(
        strategyRevisions,
        and(
          eq(strategyRevisions.strategyId, strategies.id),
          eq(strategyRevisions.revision, strategies.currentRevision),
        ),
      )
      .where(eq(strategies.id, id))
      .limit(1);
    return rows[0] === undefined
      ? null
      : mapStrategy(rows[0].strategy, rows[0].revision);
  }

  async listOwned(userId: string, includeDeleted: boolean) {
    const conditions = [eq(strategies.ownerUserId, userId)];
    if (!includeDeleted) conditions.push(sql`${strategies.deletedAt} is null`);
    const rows = await this.connection.database
      .select({ strategy: strategies, revision: strategyRevisions })
      .from(strategies)
      .innerJoin(
        strategyRevisions,
        and(
          eq(strategyRevisions.strategyId, strategies.id),
          eq(strategyRevisions.revision, strategies.currentRevision),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(strategies.updatedAt), asc(strategies.id));
    return rows.map((row) => mapStrategy(row.strategy, row.revision));
  }

  async listRevisions(id: string): Promise<readonly StrategyRevision[]> {
    const rows = await this.connection.database
      .select()
      .from(strategyRevisions)
      .where(eq(strategyRevisions.strategyId, id))
      .orderBy(desc(strategyRevisions.revision));
    return rows.map(mapRevision);
  }

  async create(input: NewStrategyPersistenceInput) {
    return this.connection.database.transaction(async (transaction) => {
      const strategyId = randomUUID();
      const inserted = await transaction
        .insert(strategies)
        .values({
          id: strategyId,
          ownerUserId: input.ownerUserId,
          name: input.name,
          description: input.description,
          status: input.revisionStatus === 'validated' ? 'validated' : 'draft',
          currentRevision: 1,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      const revision = await transaction
        .insert(strategyRevisions)
        .values({
          id: randomUUID(),
          strategyId,
          revision: 1,
          schemaVersion: input.definition.schemaVersion,
          definition: input.definition as unknown as Record<string, unknown>,
          parameterSchema: { parameters: input.definition.parameters },
          validationStatus: 'valid',
          complexityScore: input.validation.complexityScore,
          createdBy: input.createdBy,
          createdAt: input.now,
        })
        .returning();
      return mapStrategy(inserted[0]!, revision[0]!);
    });
  }

  async revise(input: ReviseStrategyPersistenceInput) {
    return this.connection.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(strategies)
        .set({
          name: input.name,
          description: input.description,
          status: input.revisionStatus === 'validated' ? 'validated' : 'draft',
          currentRevision: input.expectedRevision + 1,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(strategies.id, input.id),
            eq(strategies.ownerUserId, input.ownerUserId),
            eq(strategies.currentRevision, input.expectedRevision),
            sql`${strategies.deletedAt} is null`,
          ),
        )
        .returning();
      if (updated[0] === undefined) return { outcome: 'conflict' as const };
      const revision = await transaction
        .insert(strategyRevisions)
        .values({
          id: randomUUID(),
          strategyId: input.id,
          revision: input.expectedRevision + 1,
          schemaVersion: input.definition.schemaVersion,
          definition: input.definition as unknown as Record<string, unknown>,
          parameterSchema: { parameters: input.definition.parameters },
          validationStatus: 'valid',
          complexityScore: input.validation.complexityScore,
          createdBy: input.createdBy,
          createdAt: input.now,
        })
        .returning();
      return {
        outcome: 'updated' as const,
        strategy: mapStrategy(updated[0], revision[0]!),
      };
    });
  }

  async setDeleted(input: {
    readonly id: string;
    readonly userId: string;
    readonly deleted: boolean;
    readonly now: Date;
  }) {
    const current = await this.findById(input.id);
    if (current === null || current.ownerUserId !== input.userId) return null;
    const rows = await this.connection.database
      .update(strategies)
      .set({
        status: input.deleted
          ? 'deleted'
          : current.revision.status === 'validated'
            ? 'validated'
            : 'draft',
        deletedAt: input.deleted ? input.now : null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(strategies.id, input.id),
          eq(strategies.ownerUserId, input.userId),
        ),
      )
      .returning();
    return rows[0] === undefined
      ? null
      : mapStrategy(rows[0], currentRow(current.revision));
  }
}

@Injectable()
export class PostgresBacktestApiStore
  implements BacktestRunRepository, BacktestAnalyticsStore
{
  constructor(private readonly connection: ApiDatabase) {}

  async findById(id: string): Promise<BacktestRunRecord | null> {
    const rows = await this.connection.database
      .select({
        run: backtestRuns,
        snapshotHash: backtestDataSnapshots.snapshotHash,
      })
      .from(backtestRuns)
      .innerJoin(
        backtestDataSnapshots,
        eq(backtestDataSnapshots.id, backtestRuns.dataSnapshotId),
      )
      .where(eq(backtestRuns.id, id))
      .limit(1);
    return rows[0] === undefined
      ? null
      : mapRun(rows[0].run, rows[0].snapshotHash);
  }

  async findByIdempotency(userId: string, idempotencyKeyHash: string) {
    const rows = await this.connection.database
      .select({
        run: backtestRuns,
        snapshotHash: backtestDataSnapshots.snapshotHash,
      })
      .from(backtestRuns)
      .innerJoin(
        backtestDataSnapshots,
        eq(backtestDataSnapshots.id, backtestRuns.dataSnapshotId),
      )
      .where(
        and(
          eq(backtestRuns.requestedBy, userId),
          eq(backtestRuns.idempotencyKeyHash, idempotencyKeyHash),
        ),
      )
      .limit(1);
    return rows[0] === undefined
      ? null
      : mapRun(rows[0].run, rows[0].snapshotHash);
  }

  async createIdempotently(input: BacktestRunCreationInput) {
    const rows = await this.connection.database
      .insert(backtestRuns)
      .values({
        id: input.id,
        strategyId: input.strategyId,
        strategyRevision: input.strategyRevision,
        requestedBy: input.requestedBy,
        requestHash: input.requestHash,
        idempotencyKeyHash: input.idempotencyKeyHash,
        engineVersion: input.executionPlan.engineVersion,
        executionPolicyVersion: input.executionPlan.executionPolicyVersion,
        costPolicyVersion:
          input.executionPlan.costPolicy?.version ?? 'cost-free-v1',
        metricPolicyVersion: BACKTEST_METRIC_POLICY.version,
        eventOrderingPolicyVersion:
          input.executionPlan.eventOrderingPolicyVersion,
        roundingPolicyVersion: input.executionPlan.roundingPolicyVersion,
        dataSnapshotId: input.snapshot.id,
        parameters: {
          complexityScore: input.complexityScore,
          executionPlan: input.executionPlan,
        },
        universeSnapshot: input.snapshot.universeSnapshot,
        timeframe: input.executionPlan.timeframe,
        adjustmentMode: adjustmentMode(input.executionPlan),
        rangeFrom: new Date(input.rangeFrom),
        rangeTo: new Date(input.rangeTo),
        initialCapital: input.executionPlan.initialCash,
        queuedAt: new Date(input.queuedAt),
      })
      .onConflictDoNothing({
        target: [backtestRuns.requestedBy, backtestRuns.idempotencyKeyHash],
      })
      .returning();
    if (rows[0] !== undefined)
      return { run: mapRun(rows[0], input.snapshot.hash), created: true };
    const existing = await this.findByIdempotency(
      input.requestedBy,
      input.idempotencyKeyHash,
    );
    if (existing === null) throw new Error('BACKTEST_CREATE_RACE');
    return { run: existing, created: false };
  }

  async listDispatchable(limit: number) {
    const rows = await this.connection.database
      .select({
        run: backtestRuns,
        snapshotHash: backtestDataSnapshots.snapshotHash,
      })
      .from(backtestRuns)
      .innerJoin(
        backtestDataSnapshots,
        eq(backtestDataSnapshots.id, backtestRuns.dataSnapshotId),
      )
      .where(eq(backtestRuns.status, 'queued'))
      .orderBy(asc(backtestRuns.queuedAt), asc(backtestRuns.id))
      .limit(limit);
    return rows.map((row) => mapRun(row.run, row.snapshotHash));
  }

  async requestCancellation(input: {
    runId: string;
    userId: string;
    requestedAt: string;
  }) {
    const rows = await this.connection.database
      .update(backtestRuns)
      .set({
        status: 'cancel_requested',
        cancelRequestedAt: new Date(input.requestedAt),
        updatedAt: new Date(input.requestedAt),
      })
      .where(
        and(
          eq(backtestRuns.id, input.runId),
          eq(backtestRuns.requestedBy, input.userId),
          inArray(backtestRuns.status, [
            'queued',
            'resolving_data',
            'running',
            'calculating_metrics',
          ]),
        ),
      )
      .returning();
    if (rows[0] === undefined) return null;
    const snapshot = await this.connection.database
      .select({ hash: backtestDataSnapshots.snapshotHash })
      .from(backtestDataSnapshots)
      .where(eq(backtestDataSnapshots.id, rows[0].dataSnapshotId))
      .limit(1);
    return mapRun(rows[0], snapshot[0]!.hash);
  }

  async listRuns(input: Parameters<BacktestAnalyticsStore['listRuns']>[0]) {
    const conditions = [eq(backtestRuns.requestedBy, input.userId)];
    if (input.status)
      conditions.push(eq(backtestRuns.status, databaseRunStatus(input.status)));
    if (input.cursor)
      conditions.push(
        or(
          lt(backtestRuns.updatedAt, input.cursor.updatedAt),
          and(
            eq(backtestRuns.updatedAt, input.cursor.updatedAt),
            gt(backtestRuns.id, input.cursor.id),
          ),
        )!,
      );
    const rows = await this.connection.database
      .select({
        run: backtestRuns,
        snapshotHash: backtestDataSnapshots.snapshotHash,
      })
      .from(backtestRuns)
      .innerJoin(
        backtestDataSnapshots,
        eq(backtestDataSnapshots.id, backtestRuns.dataSnapshotId),
      )
      .where(and(...conditions))
      .orderBy(desc(backtestRuns.updatedAt), asc(backtestRuns.id))
      .limit(input.limit + 1);
    const hasNext = rows.length > input.limit;
    const selected = hasNext ? rows.slice(0, input.limit) : rows;
    const last = selected.at(-1)?.run;
    return {
      items: selected.map((row) => mapRun(row.run, row.snapshotHash)),
      nextPosition:
        hasNext && last ? { updatedAt: last.updatedAt, id: last.id } : null,
    };
  }

  async summary(runId: string) {
    const rows = await this.connection.database
      .select({ summary: backtestSummaries, snapshot: backtestDataSnapshots })
      .from(backtestSummaries)
      .innerJoin(backtestRuns, eq(backtestRuns.id, backtestSummaries.runId))
      .innerJoin(
        backtestDataSnapshots,
        eq(backtestDataSnapshots.id, backtestRuns.dataSnapshotId),
      )
      .where(eq(backtestSummaries.runId, runId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const persistedMethodology = row.summary.methodology as {
      readonly metricPolicy?: Record<string, unknown>;
      readonly metrics?: Record<string, unknown>;
      readonly engineVersion?: string;
      readonly resultHash?: string;
    };
    const metrics = persistedMethodology.metrics ?? {};
    return {
      ...row.summary,
      annualizedVolatility: row.summary.volatility,
      sharpe: row.summary.sharpeRatio,
      sortino: row.summary.sortinoRatio,
      calmar: row.summary.calmarRatio,
      excessReturn:
        (
          metrics['excessReturn'] as
            | { readonly value?: string | null }
            | undefined
        )?.value ?? null,
      metrics,
      methodology: {
        engineVersion: persistedMethodology.engineVersion,
        resultHash: persistedMethodology.resultHash,
        metricPolicy: persistedMethodology.metricPolicy,
      },
      dataSnapshot: {
        id: row.snapshot.id,
        hash: row.snapshot.snapshotHash,
        dataCutoffAt: row.snapshot.dataCutoffAt,
        coverageStatus: row.snapshot.coverageStatus,
      },
    };
  }

  async series(input: Parameters<BacktestAnalyticsStore['series']>[0]) {
    const rows = await this.connection.database
      .select()
      .from(backtestSeriesChunks)
      .where(
        and(
          eq(backtestSeriesChunks.runId, input.runId),
          eq(backtestSeriesChunks.seriesType, input.type),
        ),
      )
      .orderBy(asc(backtestSeriesChunks.chunkIndex));
    return rows
      .flatMap((row) => row.payload as Record<string, unknown>[])
      .filter((point) => {
        const timestamp = new Date(String(point['timestamp']));
        return (
          (!input.from || timestamp >= input.from) &&
          (!input.to || timestamp <= input.to)
        );
      })
      .slice(0, input.maximumPoints);
  }

  async trades(input: Parameters<BacktestAnalyticsStore['trades']>[0]) {
    const conditions = [eq(backtestTrades.runId, input.runId)];
    if (input.instrumentId)
      conditions.push(eq(backtestTrades.instrumentId, input.instrumentId));
    if (input.cursor)
      conditions.push(
        or(
          lt(backtestTrades.closedAt, input.cursor.closedAt),
          and(
            eq(backtestTrades.closedAt, input.cursor.closedAt),
            lt(backtestTrades.tradeSequence, input.cursor.tradeSequence),
          ),
          and(
            eq(backtestTrades.closedAt, input.cursor.closedAt),
            eq(backtestTrades.tradeSequence, input.cursor.tradeSequence),
            lt(backtestTrades.id, input.cursor.id),
          ),
        )!,
      );
    const rows = await this.connection.database
      .select()
      .from(backtestTrades)
      .where(and(...conditions))
      .orderBy(
        desc(backtestTrades.closedAt),
        desc(backtestTrades.tradeSequence),
        desc(backtestTrades.id),
      )
      .limit(input.limit + 1);
    const hasNext = rows.length > input.limit;
    const selected = hasNext ? rows.slice(0, input.limit) : rows;
    const last = selected.at(-1);
    return {
      items: selected,
      nextPosition:
        hasNext && last
          ? {
              closedAt: last.closedAt,
              tradeSequence: last.tradeSequence,
              id: last.id,
            }
          : null,
    };
  }

  orders(runId: string, limit: number) {
    return this.connection.database
      .select()
      .from(backtestOrders)
      .where(eq(backtestOrders.runId, runId))
      .orderBy(asc(backtestOrders.orderSequence))
      .limit(limit);
  }
  fills(runId: string, limit: number) {
    return this.connection.database
      .select()
      .from(backtestFills)
      .where(eq(backtestFills.runId, runId))
      .orderBy(asc(backtestFills.fillSequence))
      .limit(limit);
  }
  async methodology(runId: string) {
    const rows = await this.connection.database
      .select({ run: backtestRuns, summary: backtestSummaries.methodology })
      .from(backtestRuns)
      .leftJoin(backtestSummaries, eq(backtestSummaries.runId, backtestRuns.id))
      .where(eq(backtestRuns.id, runId))
      .limit(1);
    const row = rows[0];
    return row
      ? {
          engineVersion: row.run.engineVersion,
          executionPolicyVersion: row.run.executionPolicyVersion,
          costPolicyVersion: row.run.costPolicyVersion,
          metricPolicyVersion: row.run.metricPolicyVersion,
          eventOrderingPolicyVersion: row.run.eventOrderingPolicyVersion,
          roundingPolicyVersion: row.run.roundingPolicyVersion,
          methodology: row.summary ?? {},
        }
      : null;
  }
}

@Injectable()
export class BullMqExperimentApiDispatcher implements OnApplicationShutdown {
  private queue: Queue<ExperimentQueuePayload> | undefined;
  constructor(private readonly config: ConfigService) {}
  async dispatch(input: ExperimentQueuePayload) {
    const queue = this.queue ?? this.createQueue();
    this.queue = queue;
    const digest = createHash('sha256')
      .update(input.experimentId)
      .digest('hex')
      .slice(0, 32);
    await queue.add(ATLAS_JOB_NAMES.backtestExperiment, input, {
      jobId: `backtest-experiment-${digest}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 100,
      removeOnFail: false,
    });
  }
  async onApplicationShutdown() {
    await this.queue?.close();
  }
  private createQueue() {
    return new Queue<ExperimentQueuePayload>(ATLAS_QUEUE_NAMES.experiments, {
      connection: { url: this.config.getOrThrow<string>('REDIS_URL') },
    });
  }
}

@Injectable()
export class PostgresExperimentStore implements ExperimentStore {
  constructor(
    private readonly connection: ApiDatabase,
    private readonly dispatcher: BullMqExperimentApiDispatcher,
  ) {}
  async listOwned(userId: string) {
    const rows = await this.connection.database
      .select()
      .from(researchExperiments)
      .where(eq(researchExperiments.ownerUserId, userId))
      .orderBy(desc(researchExperiments.updatedAt));
    return rows.map(mapExperiment);
  }
  async findById(id: string) {
    const rows = await this.connection.database
      .select()
      .from(researchExperiments)
      .where(eq(researchExperiments.id, id))
      .limit(1);
    return rows[0] ? mapExperiment(rows[0]) : null;
  }
  async create(input: Parameters<ExperimentStore['create']>[0]) {
    const snapshots = await this.connection.database
      .select({ hash: backtestDataSnapshots.snapshotHash })
      .from(backtestDataSnapshots)
      .where(eq(backtestDataSnapshots.id, input.dataSnapshotId))
      .limit(1);
    if (snapshots[0]?.hash !== input.dataSnapshotHash)
      throw new Error('EXPERIMENT_SNAPSHOT_MISMATCH');
    const rows = await this.connection.database
      .insert(researchExperiments)
      .values({
        id: input.id,
        ownerUserId: input.ownerUserId,
        strategyId: input.strategyId,
        strategyRevision: input.strategyRevision,
        dataSnapshotId: input.dataSnapshotId,
        name: input.name,
        experimentHash: input.experimentHash,
        definition: input.definition,
        combinationCount: input.combinationCount,
        status: 'queued',
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    const experiment = mapExperiment(rows[0]!);
    try {
      await this.dispatcher.dispatch({ experimentId: experiment.id });
    } catch {
      // PostgreSQL remains authoritative. The production worker reconciler
      // dispatches queued experiments after transient Redis failures.
    }
    return experiment;
  }
  async cancel(id: string, userId: string, now: Date) {
    return this.connection.database.transaction(async (transaction) => {
      const rows = await transaction
        .update(researchExperiments)
        .set({ status: 'cancel_requested', updatedAt: now })
        .where(
          and(
            eq(researchExperiments.id, id),
            eq(researchExperiments.ownerUserId, userId),
            inArray(researchExperiments.status, ['queued', 'running']),
          ),
        )
        .returning();
      if (!rows[0]) return null;
      const children = await transaction
        .select({ runId: researchExperimentRuns.backtestRunId })
        .from(researchExperimentRuns)
        .where(eq(researchExperimentRuns.experimentId, id));
      if (children.length > 0)
        await transaction
          .update(backtestRuns)
          .set({
            status: 'cancel_requested',
            cancelRequestedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              inArray(
                backtestRuns.id,
                children.map((item) => item.runId),
              ),
              inArray(backtestRuns.status, [
                'queued',
                'resolving_data',
                'running',
                'calculating_metrics',
              ]),
            ),
          );
      return mapExperiment(rows[0]);
    });
  }
  async results(id: string) {
    return this.connection.database
      .select({
        bindingHash: researchExperimentRuns.bindingHash,
        sampleRole: researchExperimentRuns.sampleRole,
        status: researchExperimentRuns.status,
        selectedMetrics: researchExperimentRuns.selectedMetrics,
        runId: researchExperimentRuns.backtestRunId,
      })
      .from(researchExperimentRuns)
      .where(eq(researchExperimentRuns.experimentId, id))
      .orderBy(asc(researchExperimentRuns.combinationIndex));
  }
  async matrix(id: string) {
    return this.connection.database
      .select({
        bindingHash: researchExperimentRuns.bindingHash,
        sampleRole: researchExperimentRuns.sampleRole,
        parameterBinding: researchExperimentRuns.parameterBinding,
        selectedMetrics: researchExperimentRuns.selectedMetrics,
        rank: researchExperimentRuns.rank,
      })
      .from(researchExperimentRuns)
      .where(eq(researchExperimentRuns.experimentId, id))
      .orderBy(asc(researchExperimentRuns.combinationIndex));
  }
}

@Injectable()
export class InMemoryBacktestCommandGuard implements BacktestCommandGuard {
  private readonly windows = new Map<string, number[]>();
  consume(input: Parameters<BacktestCommandGuard['consume']>[0]): void {
    const maximum = input.operation === 'export' ? 5 : 20;
    if (
      !Number.isFinite(input.complexity) ||
      input.complexity < 0 ||
      input.complexity > 1_000_000
    )
      throw new Error('BACKTEST_COMPLEXITY_LIMIT_EXCEEDED');
    const key = `${input.userId}:${input.operation}`;
    const threshold = input.now.getTime() - 60_000;
    const current = (this.windows.get(key) ?? []).filter(
      (time) => time > threshold,
    );
    if (current.length >= maximum) throw new Error('BACKTEST_RATE_LIMITED');
    current.push(input.now.getTime());
    this.windows.set(key, current);
  }
}

@Injectable()
export class BullMqBacktestApiDispatcher implements OnApplicationShutdown {
  private queue: Queue<BacktestRunQueuePayload> | undefined;
  constructor(private readonly config: ConfigService) {}
  async dispatch(input: BacktestRunQueuePayload) {
    const queue = this.queue ?? this.createQueue();
    this.queue = queue;
    const digest = createHash('sha256')
      .update(input.runId)
      .digest('hex')
      .slice(0, 32);
    await queue.add(ATLAS_JOB_NAMES.backtestRun, input, {
      jobId: `backtest-run-${digest}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
    });
  }
  async onApplicationShutdown() {
    await this.queue?.close();
  }
  private createQueue() {
    return new Queue<BacktestRunQueuePayload>(ATLAS_QUEUE_NAMES.backtests, {
      connection: { url: this.config.getOrThrow<string>('REDIS_URL') },
    });
  }
}

export function createStrategyApplication(
  repository: PostgresStrategyApiRepository,
) {
  return new StrategyApplicationService({ repository });
}

export function createBacktestApplication(
  connection: ApiDatabase,
  repository: PostgresBacktestApiStore,
  dispatcher: BullMqBacktestApiDispatcher,
) {
  return new BacktestRunApplicationService({
    repository,
    dispatcher,
    entitlement: {
      authorize: () =>
        Promise.resolve({ allowed: true, maximumComplexityScore: 1_000_000 }),
    },
    snapshotResolver: {
      async resolve(input): Promise<BacktestDataSnapshotResolution> {
        const rows = await connection.database
          .select()
          .from(backtestDataSnapshots)
          .where(eq(backtestDataSnapshots.snapshotHash, input.snapshotHash))
          .limit(1);
        const row = rows[0];
        if (!row)
          return {
            id: randomUUID(),
            hash: '',
            dataCutoffAt: new Date(0).toISOString(),
            universeSnapshot: {},
            events: [],
            coverageStatus: 'notEvaluable',
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
    },
    idGenerator: randomUUID,
  });
}

function mapStrategy(
  row: StrategyRow,
  revision: RevisionRow,
): StrategyWithRevision {
  const entity = createStrategyEntity({
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    description: row.description,
    status: row.status as StrategyWithRevision['status'],
    currentRevision: row.currentRevision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
  return Object.freeze({ ...entity, revision: mapRevision(revision) });
}
function mapRevision(row: RevisionRow): StrategyRevision {
  const validation = validateStrategyDefinition(row.definition);
  return createStrategyRevision({
    id: row.id,
    strategyId: row.strategyId,
    revision: row.revision,
    definition: validation.normalizedDefinition!,
    status: row.validationStatus === 'draft' ? 'draft' : 'validated',
    validation,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  });
}
function currentRow(revision: StrategyRevision): RevisionRow {
  return {
    id: revision.id,
    strategyId: revision.strategyId,
    revision: revision.revision,
    schemaVersion: revision.definition.schemaVersion,
    definition: revision.definition as unknown as Record<string, unknown>,
    parameterSchema: { parameters: revision.definition.parameters },
    validationStatus: 'valid',
    complexityScore: revision.validation.complexityScore,
    createdBy: revision.createdBy,
    createdAt: revision.createdAt,
  };
}
function mapRun(row: RunRow, snapshotHash: string): BacktestRunRecord {
  const parameters = row.parameters as {
    complexityScore?: number;
    executionPlan: BacktestExecutionPlan;
  };
  return {
    id: row.id,
    requestedBy: row.requestedBy,
    strategyId: row.strategyId,
    strategyRevision: row.strategyRevision,
    status: ({
      resolving_data: 'resolvingData',
      calculating_metrics: 'calculatingMetrics',
      cancel_requested: 'cancelRequested',
    }[row.status] ?? row.status) as BacktestRunRecord['status'],
    requestHash: row.requestHash,
    idempotencyKeyHash: row.idempotencyKeyHash,
    executionPlan: parameters.executionPlan,
    dataSnapshotId: row.dataSnapshotId,
    dataSnapshotHash: snapshotHash,
    rangeFrom: row.rangeFrom.toISOString(),
    rangeTo: row.rangeTo.toISOString(),
    complexityScore: parameters.complexityScore ?? 0,
    progressPercent: Number(row.progress),
    queuedAt: row.queuedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
    errorCode: row.errorCode,
  };
}
function databaseRunStatus(status: string) {
  if (status === 'resolvingData') return 'resolving_data' as const;
  if (status === 'calculatingMetrics') return 'calculating_metrics' as const;
  if (status === 'cancelRequested') return 'cancel_requested' as const;
  return status as
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'expired';
}
function adjustmentMode(plan: BacktestExecutionPlan) {
  const mode = plan.corporateActionPolicy?.adjustmentMode ?? 'raw';
  return mode === 'splitAdjusted'
    ? 'split_adjusted'
    : mode === 'totalReturnAdjusted'
      ? 'total_return_adjusted'
      : 'raw';
}
function mapExperiment(
  row: typeof researchExperiments.$inferSelect,
): ExperimentRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    strategyId: row.strategyId,
    strategyRevision: row.strategyRevision,
    name: row.name,
    status: row.status,
    definition: row.definition,
    combinationCount: row.combinationCount,
    completedRunCount: row.completedRunCount,
    failedRunCount: row.failedRunCount,
    warnings: row.warnings,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
