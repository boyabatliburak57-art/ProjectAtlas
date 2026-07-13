import {
  scanResults,
  scanRunBatches,
  scanRunEvents,
  scanRuns,
  type Database,
} from '@atlas/database';
import type { ScanExecutionPlan, ScanRunStatus } from '@atlas/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type {
  ScannerProgress,
  ScannerRunRecord,
  ScannerRuntimeRepository,
} from './contracts';

type ScanRunRow = typeof scanRuns.$inferSelect;

export class PostgresScannerRuntimeRepository implements ScannerRuntimeRepository {
  constructor(private readonly database: Database) {}

  async loadRun(runId: string): Promise<ScannerRunRecord | null> {
    const rows = await this.database
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, runId))
      .limit(1);
    return rows[0] === undefined ? null : mapRun(rows[0]);
  }

  async startRun(
    runId: string,
    occurredAt: Date,
  ): Promise<ScannerRunRecord | null> {
    return this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(scanRuns)
        .set({
          status: 'running',
          startedAt: occurredAt,
          updatedAt: occurredAt,
        })
        .where(and(eq(scanRuns.id, runId), eq(scanRuns.status, 'queued')))
        .returning();
      if (updated[0] !== undefined) {
        await transaction.insert(scanRunEvents).values({
          scanRunId: runId,
          eventType: 'status_transition',
          fromStatus: 'queued',
          toStatus: 'running',
          occurredAt,
        });
        return mapRun(updated[0]);
      }
      const existing = await transaction
        .select()
        .from(scanRuns)
        .where(eq(scanRuns.id, runId))
        .limit(1);
      return existing[0] === undefined ? null : mapRun(existing[0]);
    });
  }

  async isCancellationRequested(runId: string): Promise<boolean> {
    const rows = await this.database
      .select({ status: scanRuns.status })
      .from(scanRuns)
      .where(eq(scanRuns.id, runId))
      .limit(1);
    return rows[0]?.status === 'cancel_requested';
  }

  async beginBatch(
    input: Parameters<ScannerRuntimeRepository['beginBatch']>[0],
  ): Promise<'started' | 'completed'> {
    return this.database.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(scanRunBatches)
        .values({
          scanRunId: input.runId,
          batchIndex: input.batchIndex,
          planVersion: input.planVersion,
          status: 'running',
          instrumentIds: input.instrumentIds,
          attempt: 1,
          startedAt: input.occurredAt,
          updatedAt: input.occurredAt,
        })
        .onConflictDoNothing({
          target: [scanRunBatches.scanRunId, scanRunBatches.batchIndex],
        })
        .returning({ status: scanRunBatches.status });
      if (inserted[0] !== undefined) return 'started';
      const existing = await transaction
        .select({ status: scanRunBatches.status })
        .from(scanRunBatches)
        .where(
          and(
            eq(scanRunBatches.scanRunId, input.runId),
            eq(scanRunBatches.batchIndex, input.batchIndex),
          ),
        )
        .limit(1);
      if (existing[0]?.status === 'completed') return 'completed';
      await transaction
        .update(scanRunBatches)
        .set({
          status: 'running',
          attempt: sql`${scanRunBatches.attempt} + 1`,
          startedAt: input.occurredAt,
          errorCode: null,
          updatedAt: input.occurredAt,
        })
        .where(
          and(
            eq(scanRunBatches.scanRunId, input.runId),
            eq(scanRunBatches.batchIndex, input.batchIndex),
          ),
        );
      return 'started';
    });
  }

  async completeBatch(
    input: Parameters<ScannerRuntimeRepository['completeBatch']>[0],
  ): Promise<ScannerProgress> {
    return this.database.transaction(async (transaction) => {
      for (const result of input.results) {
        await transaction
          .insert(scanResults)
          .values({
            scanRunId: input.runId,
            instrumentId: result.instrumentId,
            status: result.status,
            computedValues: result.computedValues,
            explanation: result.explanation,
            warnings: result.warnings.map((warning) => ({ ...warning })),
            dataCutoffAt: input.dataCutoffAt,
            matchedAt: result.status === 'matched' ? input.occurredAt : null,
            sourceBatchIndex: input.batchIndex,
            resultVersion: 1,
          })
          .onConflictDoUpdate({
            target: [scanResults.scanRunId, scanResults.instrumentId],
            set: {
              status: result.status,
              computedValues: result.computedValues,
              explanation: result.explanation,
              warnings: result.warnings.map((warning) => ({ ...warning })),
              dataCutoffAt: input.dataCutoffAt,
              matchedAt: result.status === 'matched' ? input.occurredAt : null,
              sourceBatchIndex: input.batchIndex,
              resultVersion: 1,
            },
          });
      }
      await transaction
        .update(scanRunBatches)
        .set({
          status: 'completed',
          completedAt: input.occurredAt,
          processedCount: input.counts.processed,
          matchedCount: input.counts.matched,
          notEvaluableCount: input.counts.notEvaluable,
          updatedAt: input.occurredAt,
        })
        .where(
          and(
            eq(scanRunBatches.scanRunId, input.runId),
            eq(scanRunBatches.batchIndex, input.batchIndex),
          ),
        );
      const aggregates = await transaction.execute<{
        processed: string;
        matched: string;
        not_evaluable: string;
      }>(sql`
        select coalesce(sum(processed_count), 0)::text as processed,
               coalesce(sum(matched_count), 0)::text as matched,
               coalesce(sum(not_evaluable_count), 0)::text as not_evaluable
        from scan_run_batches
        where scan_run_id = ${input.runId} and status = 'completed'
      `);
      const aggregate = aggregates.rows[0] ?? {
        processed: '0',
        matched: '0',
        not_evaluable: '0',
      };
      const updated = await transaction
        .update(scanRuns)
        .set({
          progressProcessed: Number(aggregate.processed),
          matchedCount: Number(aggregate.matched),
          notEvaluableCount: Number(aggregate.not_evaluable),
          warningCount: sql`${scanRuns.warningCount} + ${input.counts.warnings}`,
          updatedAt: input.occurredAt,
        })
        .where(eq(scanRuns.id, input.runId))
        .returning();
      const run = updated[0];
      if (run === undefined)
        throw new Error('Scan run progress invariant failed');
      return progress(run, 'persisting', input.occurredAt);
    });
  }

  async completeRun(runId: string, occurredAt: Date): Promise<void> {
    await this.transitionTerminal(runId, ['running'], 'completed', occurredAt);
  }

  async cancelRun(runId: string, occurredAt: Date): Promise<void> {
    await this.transitionTerminal(
      runId,
      ['cancel_requested'],
      'cancelled',
      occurredAt,
    );
  }

  async failRun(
    runId: string,
    errorCode: string,
    occurredAt: Date,
  ): Promise<void> {
    await this.transitionTerminal(
      runId,
      ['queued', 'running', 'cancel_requested'],
      'failed',
      occurredAt,
      errorCode,
    );
  }

  private async transitionTerminal(
    runId: string,
    fromStatuses: readonly string[],
    toStatus: 'completed' | 'cancelled' | 'failed',
    occurredAt: Date,
    errorCode?: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(scanRuns)
        .set({
          status: toStatus,
          updatedAt: occurredAt,
          ...(toStatus === 'cancelled'
            ? { cancelledAt: occurredAt }
            : { completedAt: occurredAt }),
          ...(errorCode === undefined ? {} : { errorCode }),
          ...(errorCode?.includes('TIMEOUT') === true
            ? { timeoutAt: occurredAt }
            : {}),
        })
        .where(
          and(
            eq(scanRuns.id, runId),
            inArray(scanRuns.status, [...fromStatuses]),
          ),
        )
        .returning({ fromStatus: scanRuns.status });
      if (updated[0] === undefined) return;
      if (toStatus === 'failed') {
        await transaction
          .update(scanRunBatches)
          .set({
            status: 'failed',
            errorCode: errorCode ?? 'SCANNER_PERSISTENCE_FAILED',
            completedAt: occurredAt,
            updatedAt: occurredAt,
          })
          .where(
            and(
              eq(scanRunBatches.scanRunId, runId),
              eq(scanRunBatches.status, 'running'),
            ),
          );
      }
      await transaction.insert(scanRunEvents).values({
        scanRunId: runId,
        eventType: 'status_transition',
        toStatus,
        occurredAt,
        payload: errorCode === undefined ? {} : { errorCode },
      });
    });
  }
}

function mapRun(row: ScanRunRow): ScannerRunRecord {
  const snapshot = row.universeSnapshot as { instrumentIds?: unknown };
  if (
    !Array.isArray(snapshot.instrumentIds) ||
    !snapshot.instrumentIds.every((id) => typeof id === 'string')
  ) {
    throw new Error('Invalid persisted universe snapshot');
  }
  return {
    id: row.id,
    requestedBy: row.requestedBy,
    status: row.status as ScanRunStatus,
    plan: row.executionPlan as unknown as ScanExecutionPlan,
    instrumentIds: snapshot.instrumentIds,
    dataCutoffAt: row.dataCutoffAt,
    queuedAt: row.queuedAt,
    startedAt: row.startedAt,
    progressTotal: row.progressTotal,
    progressProcessed: row.progressProcessed,
    matchedCount: row.matchedCount,
    notEvaluableCount: row.notEvaluableCount,
    warningCount: row.warningCount,
  };
}

function progress(
  row: ScanRunRow,
  phase: ScannerProgress['phase'],
  occurredAt: Date,
): ScannerProgress {
  return {
    total: row.progressTotal,
    processed: row.progressProcessed,
    matched: row.matchedCount,
    notEvaluable: row.notEvaluableCount,
    warnings: row.warningCount,
    phase,
    percent:
      row.progressTotal === 0
        ? 100
        : Math.min(
            100,
            Math.floor((row.progressProcessed / row.progressTotal) * 100),
          ),
    updatedAt: occurredAt.toISOString(),
  };
}
