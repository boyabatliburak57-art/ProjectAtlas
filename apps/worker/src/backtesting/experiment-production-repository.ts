import {
  backtestDataSnapshots,
  backtestRuns,
  backtestSummaries,
  researchExperimentRuns,
  researchExperiments,
  strategyRevisions,
  type Database,
} from '@atlas/database';
import type {
  ExperimentDefinitionInput,
  ExperimentChildBinding,
  ExperimentRuntimeRecord,
  StrategyDefinition,
} from '@atlas/domain';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type {
  AuthoritativeExperiment,
  ExperimentAggregation,
} from './experiment-contracts';

const terminalExperimentStatuses = [
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;

export class ExperimentProductionRepository {
  constructor(private readonly database: Database) {}

  async loadAuthoritative(
    experimentId: string,
  ): Promise<AuthoritativeExperiment | null> {
    const rows = await this.database
      .select({
        experiment: researchExperiments,
        snapshot: backtestDataSnapshots,
        revision: strategyRevisions,
      })
      .from(researchExperiments)
      .innerJoin(
        backtestDataSnapshots,
        eq(backtestDataSnapshots.id, researchExperiments.dataSnapshotId),
      )
      .innerJoin(
        strategyRevisions,
        and(
          eq(strategyRevisions.strategyId, researchExperiments.strategyId),
          eq(strategyRevisions.revision, researchExperiments.strategyRevision),
        ),
      )
      .where(eq(researchExperiments.id, experimentId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      runtime: {
        id: row.experiment.id,
        ownerUserId: row.experiment.ownerUserId,
        status: mapRuntimeStatus(row.experiment.status),
        strategyId: row.experiment.strategyId,
        strategyRevision: row.experiment.strategyRevision,
        dataSnapshotHash: row.snapshot.snapshotHash,
      },
      definition: row.experiment
        .definition as unknown as ExperimentDefinitionInput,
      strategyDefinition: row.revision
        .definition as unknown as StrategyDefinition,
      strategyRevisionId: row.revision.id,
      complexityScore: row.revision.complexityScore,
      dataCutoffAt: row.snapshot.dataCutoffAt.toISOString(),
      status: row.experiment.status,
    };
  }

  async claim(experimentId: string): Promise<boolean> {
    const now = new Date();
    const rows = await this.database
      .update(researchExperiments)
      .set({
        status: 'running',
        startedAt: sql`coalesce(${researchExperiments.startedAt}, ${now})`,
        updatedAt: now,
      })
      .where(
        and(
          eq(researchExperiments.id, experimentId),
          inArray(researchExperiments.status, ['queued', 'running']),
        ),
      )
      .returning({ id: researchExperiments.id });
    return rows[0] !== undefined;
  }

  async listDispatchable(limit: number): Promise<readonly string[]> {
    const rows = await this.database
      .select({ id: researchExperiments.id })
      .from(researchExperiments)
      .where(
        inArray(researchExperiments.status, [
          'queued',
          'running',
          'cancel_requested',
        ]),
      )
      .orderBy(asc(researchExperiments.updatedAt), asc(researchExperiments.id))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  async findReusableCompletedRuns(input: {
    readonly ownerUserId: string;
    readonly strategyId: string;
    readonly strategyRevision: number;
    readonly dataSnapshotHash: string;
    readonly engineVersion: string;
    readonly executionPolicyVersion: string;
    readonly costPolicyVersion: string;
    readonly eventOrderingPolicyVersion: string;
    readonly children: readonly ExperimentChildBinding[];
  }): Promise<ReadonlyMap<string, string>> {
    const hashes = input.children.map((child) => child.bindingHash);
    if (hashes.length === 0) return new Map();
    const rows = await this.database
      .select({
        runId: backtestRuns.id,
        parameters: backtestRuns.parameters,
        rangeFrom: backtestRuns.rangeFrom,
        rangeTo: backtestRuns.rangeTo,
      })
      .from(backtestRuns)
      .innerJoin(
        backtestDataSnapshots,
        eq(backtestDataSnapshots.id, backtestRuns.dataSnapshotId),
      )
      .where(
        and(
          eq(backtestRuns.requestedBy, input.ownerUserId),
          eq(backtestRuns.strategyId, input.strategyId),
          eq(backtestRuns.strategyRevision, input.strategyRevision),
          eq(backtestRuns.status, 'completed'),
          eq(backtestRuns.engineVersion, input.engineVersion),
          eq(backtestRuns.executionPolicyVersion, input.executionPolicyVersion),
          eq(backtestRuns.costPolicyVersion, input.costPolicyVersion),
          eq(
            backtestRuns.eventOrderingPolicyVersion,
            input.eventOrderingPolicyVersion,
          ),
          eq(backtestDataSnapshots.snapshotHash, input.dataSnapshotHash),
          sql`${backtestRuns.parameters}->>'experimentBindingHash' in (${sql.join(
            hashes.map((hash) => sql`${hash}`),
            sql`, `,
          )})`,
        ),
      )
      .orderBy(asc(backtestRuns.completedAt), asc(backtestRuns.id));
    const children = new Map(
      input.children.map((child) => [child.bindingHash, child]),
    );
    const reusable = new Map<string, string>();
    for (const row of rows) {
      const rawHash = (row.parameters as { experimentBindingHash?: unknown })
        .experimentBindingHash;
      const hash = typeof rawHash === 'string' ? rawHash : '';
      const child = children.get(hash);
      if (
        child !== undefined &&
        row.rangeFrom.toISOString() === child.rangeFrom &&
        row.rangeTo.toISOString() === child.rangeTo &&
        !reusable.has(hash)
      )
        reusable.set(hash, row.runId);
    }
    return reusable;
  }

  async attachReusableChildren(input: {
    readonly experimentId: string;
    readonly ownerUserId: string;
    readonly children: readonly {
      readonly child: ExperimentChildBinding;
      readonly runId: string;
    }[];
  }): Promise<number> {
    if (input.children.length === 0) return 0;
    const rows = await this.database
      .insert(researchExperimentRuns)
      .values(
        input.children.map(({ child, runId }) => ({
          experimentId: input.experimentId,
          ownerUserId: input.ownerUserId,
          backtestRunId: runId,
          bindingHash: child.bindingHash,
          parameterBinding: child.values,
          combinationIndex: child.combinationIndex,
          sampleRole: child.sampleRole,
          status: 'reused',
        })),
      )
      .onConflictDoNothing()
      .returning({ id: researchExperimentRuns.id });
    return rows.length;
  }

  async aggregate(
    experimentId: string,
    expectedCount: number,
    provisioningFailures: number,
    skippedCount = 0,
  ): Promise<ExperimentAggregation> {
    const experimentRows = await this.database
      .select({ status: researchExperiments.status })
      .from(researchExperiments)
      .where(eq(researchExperiments.id, experimentId))
      .limit(1);
    const experimentStatus = experimentRows[0]?.status;
    if (experimentStatus === undefined) throw new Error('EXPERIMENT_NOT_FOUND');
    if (terminalExperimentStatuses.includes(experimentStatus as never))
      return this.readTerminalAggregation(experimentId, experimentStatus);

    await this.database.execute(sql`
      update research_experiment_runs child
      set
        status = case
          when child.status = 'reused' then 'reused'
          when run.status = 'completed' then 'completed'
          when run.status in ('failed', 'expired') then 'failed'
          when run.status = 'cancelled' then 'cancelled'
          when run.status in ('running', 'resolving_data', 'calculating_metrics') then 'running'
          else 'queued'
        end,
        completed_at = case
          when run.status in ('completed', 'failed', 'expired', 'cancelled')
            then coalesce(child.completed_at, now())
          else child.completed_at
        end
      from backtest_runs run
      where child.experiment_id = ${experimentId}::uuid
        and run.id = child.backtest_run_id
    `);
    await this.database.execute(sql`
      with ranked as (
        select
          child.id,
          row_number() over (
            order by summary.total_return desc nulls last, child.id
          )::integer as rank,
          coalesce(summary.methodology->'metrics', '{}'::jsonb) as metrics
        from research_experiment_runs child
        inner join backtest_runs run on run.id = child.backtest_run_id
        left join backtest_summaries summary on summary.run_id = run.id
        where child.experiment_id = ${experimentId}::uuid
          and child.status in ('completed', 'reused')
      )
      update research_experiment_runs child
      set rank = ranked.rank, selected_metrics = ranked.metrics
      from ranked
      where child.id = ranked.id
    `);
    const rows = await this.database
      .select({
        child: researchExperimentRuns,
        runStatus: backtestRuns.status,
        summary: backtestSummaries,
      })
      .from(researchExperimentRuns)
      .innerJoin(
        backtestRuns,
        eq(backtestRuns.id, researchExperimentRuns.backtestRunId),
      )
      .leftJoin(backtestSummaries, eq(backtestSummaries.runId, backtestRuns.id))
      .where(eq(researchExperimentRuns.experimentId, experimentId))
      .orderBy(asc(researchExperimentRuns.combinationIndex));

    let completedCount = 0;
    let failedCount = provisioningFailures;
    let cancelledCount = skippedCount;
    let reusedCount = 0;
    for (const row of rows) {
      if (row.child.status === 'reused') reusedCount += 1;
      const mapped = mapChildStatus(row.child.status, row.runStatus);
      if (mapped === 'completed' || mapped === 'reused') {
        completedCount += 1;
      } else if (mapped === 'failed') failedCount += 1;
      else if (mapped === 'cancelled') cancelledCount += 1;
    }

    const observed = rows.length + provisioningFailures + skippedCount;
    const allTerminal =
      observed >= expectedCount &&
      completedCount + failedCount + cancelledCount >= expectedCount;
    if (!allTerminal)
      return {
        terminal: false,
        status: 'running',
        completedCount,
        failedCount,
        cancelledCount,
        reusedCount,
      };
    const status =
      experimentStatus === 'cancel_requested'
        ? 'cancelled'
        : completedCount === 0
          ? 'failed'
          : failedCount > 0 || cancelledCount > 0
            ? 'partial'
            : 'completed';
    const now = new Date();
    await this.database
      .update(researchExperiments)
      .set({
        status,
        completedRunCount: completedCount,
        failedRunCount: failedCount,
        completedAt: now,
        ...(status === 'cancelled' ? { cancelledAt: now } : {}),
        updatedAt: now,
      })
      .where(
        and(
          eq(researchExperiments.id, experimentId),
          inArray(researchExperiments.status, ['running', 'cancel_requested']),
        ),
      );
    return {
      terminal: true,
      status,
      completedCount,
      failedCount,
      cancelledCount,
      reusedCount,
    };
  }

  async fail(experimentId: string, errorCode: string): Promise<void> {
    const now = new Date();
    await this.database
      .update(researchExperiments)
      .set({
        status: 'failed',
        failedRunCount: sql`greatest(${researchExperiments.failedRunCount}, 1)`,
        warnings: [{ code: errorCode }],
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(researchExperiments.id, experimentId),
          inArray(researchExperiments.status, ['queued', 'running']),
        ),
      );
  }

  private async readTerminalAggregation(
    experimentId: string,
    status: string,
  ): Promise<ExperimentAggregation> {
    const [row] = await this.database
      .select({
        completed: researchExperiments.completedRunCount,
        failed: researchExperiments.failedRunCount,
      })
      .from(researchExperiments)
      .where(eq(researchExperiments.id, experimentId));
    const [reused] = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(researchExperimentRuns)
      .where(
        and(
          eq(researchExperimentRuns.experimentId, experimentId),
          eq(researchExperimentRuns.status, 'reused'),
        ),
      );
    return {
      terminal: true,
      status: status as ExperimentAggregation['status'],
      completedCount: row?.completed ?? 0,
      failedCount: row?.failed ?? 0,
      cancelledCount: 0,
      reusedCount: Number(reused?.count ?? 0),
    };
  }
}

function mapRuntimeStatus(status: string): ExperimentRuntimeRecord['status'] {
  return status === 'cancel_requested'
    ? 'cancelRequested'
    : (status as ExperimentRuntimeRecord['status']);
}

function mapChildStatus(current: string, run: string): string {
  if (current === 'reused') return 'reused';
  if (run === 'completed') return 'completed';
  if (run === 'failed' || run === 'expired') return 'failed';
  if (run === 'cancelled') return 'cancelled';
  if (
    run === 'running' ||
    run === 'resolving_data' ||
    run === 'calculating_metrics'
  )
    return 'running';
  return 'queued';
}
