import {
  backtestDataSnapshots,
  backtestRuns,
  researchExperimentRuns,
  researchExperiments,
  type Database,
} from '@atlas/database';
import type {
  ExperimentRuntimeRepository,
  ExperimentRunCompatibilityKey,
} from '@atlas/domain';
import { and, asc, eq, inArray } from 'drizzle-orm';

export class PostgresExperimentRuntimeRepository implements ExperimentRuntimeRepository {
  constructor(private readonly database: Database) {}

  async isCancellationRequested(experimentId: string): Promise<boolean> {
    const rows = await this.database
      .select({ status: researchExperiments.status })
      .from(researchExperiments)
      .where(eq(researchExperiments.id, experimentId))
      .limit(1);
    return rows[0]?.status === 'cancel_requested';
  }

  async findReusableCompletedRun(
    key: ExperimentRunCompatibilityKey,
  ): Promise<{ readonly runId: string } | null> {
    const rows = await this.database
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
          eq(backtestRuns.strategyId, key.strategyId),
          eq(backtestRuns.requestedBy, key.ownerUserId),
          eq(backtestRuns.strategyRevision, key.strategyRevision),
          eq(backtestRuns.status, 'completed'),
          eq(backtestRuns.engineVersion, key.engineVersion),
          eq(backtestRuns.executionPolicyVersion, key.executionPolicyVersion),
          eq(backtestRuns.costPolicyVersion, key.costPolicyVersion),
          eq(
            backtestRuns.eventOrderingPolicyVersion,
            key.eventOrderingPolicyVersion,
          ),
        ),
      )
      .orderBy(asc(backtestRuns.completedAt), asc(backtestRuns.id));
    const compatible = rows.find(({ run, snapshotHash }) => {
      const parameters = run.parameters as {
        experimentBindingHash?: string;
      };
      return (
        snapshotHash === key.dataSnapshotHash &&
        parameters.experimentBindingHash === key.bindingHash &&
        run.rangeFrom.toISOString() === key.rangeFrom &&
        run.rangeTo.toISOString() === key.rangeTo
      );
    });
    return compatible === undefined ? null : { runId: compatible.run.id };
  }

  async attachChild(
    input: Parameters<ExperimentRuntimeRepository['attachChild']>[0],
  ): Promise<'created' | 'duplicate'> {
    const inserted = await this.database
      .insert(researchExperimentRuns)
      .values({
        experimentId: input.experimentId,
        ownerUserId: input.ownerUserId,
        backtestRunId: input.runId,
        bindingHash: input.child.bindingHash,
        parameterBinding: input.child.values,
        combinationIndex: input.child.combinationIndex,
        sampleRole: input.child.sampleRole,
        status: input.status,
      })
      .onConflictDoNothing({
        target: [
          researchExperimentRuns.experimentId,
          researchExperimentRuns.bindingHash,
        ],
      })
      .returning({ id: researchExperimentRuns.id });
    return inserted[0] === undefined ? 'duplicate' : 'created';
  }

  async markChildFailed(
    input: Parameters<ExperimentRuntimeRepository['markChildFailed']>[0],
  ): Promise<void> {
    const rows = await this.database
      .select({ warnings: researchExperiments.warnings })
      .from(researchExperiments)
      .where(eq(researchExperiments.id, input.experimentId))
      .limit(1);
    await this.database
      .update(researchExperiments)
      .set({
        warnings: [
          ...(rows[0]?.warnings ?? []),
          {
            bindingHash: input.child.bindingHash,
            code: input.errorCode,
            sampleRole: input.child.sampleRole,
          },
        ],
        updatedAt: new Date(),
      })
      .where(eq(researchExperiments.id, input.experimentId));
  }

  async listRunningChildRunIds(
    experimentId: string,
  ): Promise<readonly string[]> {
    const rows = await this.database
      .select({ runId: researchExperimentRuns.backtestRunId })
      .from(researchExperimentRuns)
      .where(
        and(
          eq(researchExperimentRuns.experimentId, experimentId),
          inArray(researchExperimentRuns.status, ['queued', 'running']),
        ),
      )
      .orderBy(asc(researchExperimentRuns.backtestRunId));
    return rows.map((row) => row.runId);
  }

  async completeExperiment(
    input: Parameters<ExperimentRuntimeRepository['completeExperiment']>[0],
  ): Promise<void> {
    const occurredAt = new Date();
    await this.database
      .update(researchExperiments)
      .set({
        status: input.status,
        completedRunCount: input.completedCount,
        failedRunCount: input.failedCount,
        warnings: input.warnings.map((code) => ({ code })),
        completedAt: occurredAt,
        ...(input.status === 'cancelled' ? { cancelledAt: occurredAt } : {}),
        updatedAt: occurredAt,
      })
      .where(eq(researchExperiments.id, input.experimentId));
  }
}
