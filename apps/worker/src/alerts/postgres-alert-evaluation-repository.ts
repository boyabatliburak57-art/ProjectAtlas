import {
  alertEvaluations,
  alertRevisions,
  alerts,
  alertStates,
  alertTriggers,
  scanRuns,
  type Database,
} from '@atlas/database';
import {
  applyRepeatPolicy,
  createInitialAlertState,
  createTriggerDeduplicationKey,
  type AlertSource,
  type AlertState,
} from '@atlas/domain';
import { and, eq, sql } from 'drizzle-orm';

import type {
  AlertCandidate,
  AlertEvaluationEvent,
  AlertEvaluationPersistenceInput,
  AlertEvaluationRepository,
  PersistEvaluationResult,
} from './contracts';

type AlertEvaluationTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export class PostgresAlertEvaluationRepository implements AlertEvaluationRepository {
  constructor(private readonly database: Database) {}

  async findCandidates(
    event: AlertEvaluationEvent,
  ): Promise<readonly AlertCandidate[]> {
    const rows = await this.database
      .select({ alert: alerts, revision: alertRevisions })
      .from(alerts)
      .innerJoin(
        alertRevisions,
        and(
          eq(alertRevisions.alertId, alerts.id),
          eq(alertRevisions.revision, alerts.currentRevision),
        ),
      )
      .where(eq(alerts.status, 'active'));
    const candidates = rows.map(({ alert, revision }) =>
      mapCandidate(alert.ownerUserId, revision),
    );
    if (event.type === 'market_data_updated') {
      return candidates.filter(
        (candidate) =>
          isInstrumentSource(candidate.source) &&
          candidate.source.instrumentId === event.instrumentId &&
          (candidate.timeframe === null ||
            candidate.timeframe === event.timeframe) &&
          (candidate.evaluationMode === 'intrabar' || event.isClosed),
      );
    }

    const run = (
      await this.database
        .select()
        .from(scanRuns)
        .where(
          and(
            eq(scanRuns.id, event.scanRunId),
            eq(scanRuns.status, 'completed'),
          ),
        )
        .limit(1)
    )[0];
    if (run === undefined) return [];
    return candidates.filter((candidate) => scanSourceMatches(candidate, run));
  }

  async persistEvaluation(
    input: AlertEvaluationPersistenceInput,
  ): Promise<PersistEvaluationResult> {
    return this.database.transaction((transaction) =>
      this.persistEvaluationInTransaction(transaction, input),
    );
  }

  async persistEvaluations(
    inputs: readonly AlertEvaluationPersistenceInput[],
  ): Promise<readonly PersistEvaluationResult[]> {
    if (inputs.length === 0) return [];
    return this.database.transaction(async (transaction) => {
      const results: PersistEvaluationResult[] = [];
      for (const input of inputs) {
        results.push(
          await this.persistEvaluationInTransaction(transaction, input),
        );
      }
      return results;
    });
  }

  private async persistEvaluationInTransaction(
    transaction: AlertEvaluationTransaction,
    input: AlertEvaluationPersistenceInput,
  ): Promise<PersistEvaluationResult> {
    const stateKey = 'default';
    await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`${input.candidate.alertId}:${input.candidate.alertRevision}:${stateKey}`}, 0)
        )
      `);
    const insertedEvaluation = (
      await transaction
        .insert(alertEvaluations)
        .values({
          alertId: input.candidate.alertId,
          alertRevision: input.candidate.alertRevision,
          sourceEventId: input.event.eventId,
          dataCutoffAt: new Date(input.event.dataCutoffAt),
          instrumentId:
            input.event.type === 'market_data_updated'
              ? input.event.instrumentId
              : null,
          timeframe:
            input.event.type === 'market_data_updated'
              ? input.event.timeframe
              : input.candidate.timeframe,
          evaluationWindow: evaluationWindow(input.event),
          status: input.evaluation.status,
          reasonCode: input.evaluation.reasonCode,
          result: {
            ...input.evaluation.result,
            matchedInstrumentIds: input.evaluation.matchedInstrumentIds,
          },
          durationMs: input.durationMs,
          evaluatedAt: input.evaluatedAt,
        })
        .onConflictDoNothing({
          target: [
            alertEvaluations.alertId,
            alertEvaluations.alertRevision,
            alertEvaluations.sourceEventId,
            alertEvaluations.dataCutoffAt,
          ],
        })
        .returning({ id: alertEvaluations.id })
    )[0];
    if (insertedEvaluation === undefined) {
      return {
        duplicate: true,
        triggerCount: 0,
        triggerIds: [],
        state: null,
      };
    }

    const existingState = (
      await transaction
        .select()
        .from(alertStates)
        .where(
          and(
            eq(alertStates.alertId, input.candidate.alertId),
            eq(alertStates.alertRevision, input.candidate.alertRevision),
            eq(alertStates.stateKey, stateKey),
          ),
        )
        .limit(1)
    )[0];
    const currentState =
      existingState === undefined
        ? createInitialAlertState({
            alertId: input.candidate.alertId,
            alertRevision: input.candidate.alertRevision,
            stateKey,
            now: input.evaluatedAt,
          })
        : mapState(existingState);
    const decision = applyRepeatPolicy(
      input.candidate.repeatPolicy,
      currentState,
      {
        alertId: input.candidate.alertId,
        alertRevision: input.candidate.alertRevision,
        sourceEventId: input.event.eventId,
        dataCutoffAt: new Date(input.event.dataCutoffAt),
        status: input.evaluation.status,
        evaluatedAt: input.evaluatedAt,
        evaluationWindow: evaluationWindow(input.event),
        matchedInstrumentIds: input.evaluation.matchedInstrumentIds,
      },
    );
    await transaction
      .insert(alertStates)
      .values(stateValues(decision.nextState))
      .onConflictDoUpdate({
        target: [
          alertStates.alertId,
          alertStates.alertRevision,
          alertStates.stateKey,
        ],
        set: {
          matchState: decision.nextState.matchState,
          armed: decision.nextState.armed,
          stateData: { ...decision.nextState.stateData },
          lastSourceEventId: decision.nextState.lastSourceEventId,
          lastDataCutoffAt: decision.nextState.lastDataCutoffAt,
          lastTriggeredAt: decision.nextState.lastTriggeredAt,
          updatedAt: input.evaluatedAt,
        },
      });

    let triggerCount = 0;
    const triggerIds: string[] = [];
    if (decision.shouldTrigger) {
      const instrumentIds =
        decision.triggerInstrumentIds.length > 0
          ? decision.triggerInstrumentIds
          : [undefined];
      for (const instrumentId of instrumentIds) {
        const inserted = await transaction
          .insert(alertTriggers)
          .values({
            alertId: input.candidate.alertId,
            alertRevision: input.candidate.alertRevision,
            evaluationId: insertedEvaluation.id,
            instrumentId: instrumentId ?? null,
            triggerType: input.candidate.triggerPolicy,
            deduplicationKey: createTriggerDeduplicationKey({
              alertId: input.candidate.alertId,
              alertRevision: input.candidate.alertRevision,
              sourceEventId: input.event.eventId,
              dataCutoffAt: new Date(input.event.dataCutoffAt),
              triggerType: input.candidate.triggerPolicy,
              instrumentId,
              timeframe: input.candidate.timeframe,
              evaluationWindow: evaluationWindow(input.event),
            }),
            payload: {
              sourceType: input.candidate.source.type,
              eventType: input.event.type,
              reasonCode: input.evaluation.reasonCode,
            },
            occurredAt: input.evaluatedAt,
            createdAt: input.evaluatedAt,
          })
          .onConflictDoNothing({
            target: alertTriggers.deduplicationKey,
          })
          .returning({ id: alertTriggers.id });
        triggerCount += inserted.length;
        triggerIds.push(...inserted.map(({ id }) => id));
      }
    }
    return {
      duplicate: false,
      triggerCount,
      triggerIds,
      state: decision.nextState,
    };
  }

  async listCatchUpEvents(
    limit: number,
  ): Promise<readonly AlertEvaluationEvent[]> {
    const scans = await this.database.execute<{
      id: string;
      data_cutoff_at: Date;
    }>(sql`
      select distinct sr.id, sr.data_cutoff_at
      from scan_runs sr
      join alert_revisions ar on
        (ar.saved_scan_id = sr.source_id and ar.saved_scan_revision = sr.source_revision)
        or (ar.preset_scan_id = sr.source_id and ar.preset_scan_revision = sr.source_revision)
      join alerts a on a.id = ar.alert_id and a.current_revision = ar.revision
      where sr.status = 'completed' and a.status = 'active'
        and sr.completed_at >= ar.created_at
        and not exists (
          select 1 from alert_evaluations ae
          where ae.alert_id = a.id and ae.alert_revision = ar.revision
            and ae.source_event_id = 'scan-run:' || sr.id::text || ':completed'
            and ae.data_cutoff_at = sr.data_cutoff_at
        )
      order by sr.data_cutoff_at, sr.id
      limit ${limit}
    `);
    const remaining = Math.max(0, limit - scans.rows.length);
    const bars =
      remaining === 0
        ? { rows: [] }
        : await this.database.execute<{
            id: string;
            instrument_id: string;
            timeframe: string;
            open_time: Date;
            close_time: Date;
          }>(sql`
            select distinct
              pb.id::text as id, pb.instrument_id, pb.timeframe,
              pb.open_time, pb.close_time
            from price_bars pb
            join alert_revisions ar on ar.instrument_id = pb.instrument_id
              and (ar.timeframe is null or ar.timeframe = pb.timeframe)
            join alerts a on a.id = ar.alert_id and a.current_revision = ar.revision
            where pb.is_closed = true and a.status = 'active'
              and ar.evaluation_mode = 'closed_bar'
              and pb.close_time >= ar.created_at
              and not exists (
                select 1 from alert_evaluations ae
                where ae.alert_id = a.id and ae.alert_revision = ar.revision
                  and ae.source_event_id = 'price-bar:' || pb.id::text
                  and ae.data_cutoff_at = pb.close_time
              )
            order by pb.close_time, pb.id::text
            limit ${remaining}
          `);
    return [
      ...scans.rows.map(
        (row): AlertEvaluationEvent => ({
          type: 'scan_completed',
          eventId: `scan-run:${row.id}:completed`,
          scanRunId: row.id,
          dataCutoffAt: new Date(row.data_cutoff_at).toISOString(),
        }),
      ),
      ...bars.rows.map(
        (row): AlertEvaluationEvent => ({
          type: 'market_data_updated',
          eventId: `price-bar:${row.id}`,
          instrumentId: row.instrument_id,
          timeframe: row.timeframe,
          barOpenTime: new Date(row.open_time).toISOString(),
          dataCutoffAt: new Date(row.close_time).toISOString(),
          isClosed: true,
        }),
      ),
    ];
  }
}

type AlertRevisionRow = typeof alertRevisions.$inferSelect;
type AlertStateRow = typeof alertStates.$inferSelect;
type ScanRunRow = typeof scanRuns.$inferSelect;

function mapCandidate(
  ownerUserId: string,
  row: AlertRevisionRow,
): AlertCandidate {
  return {
    alertId: row.alertId,
    alertRevision: row.revision,
    ownerUserId,
    source: source(row),
    triggerPolicy: row.triggerPolicy as AlertCandidate['triggerPolicy'],
    repeatPolicy: row.repeatPolicy as AlertCandidate['repeatPolicy'],
    timeframe: row.timeframe,
    evaluationMode: row.evaluationMode as AlertCandidate['evaluationMode'],
    sourceConfiguration: row.sourceConfiguration,
  };
}

function source(row: AlertRevisionRow): AlertSource {
  if (row.sourceType === 'saved_scan') {
    return {
      type: 'saved_scan',
      savedScanId: required(row.savedScanId),
      savedScanRevision: required(row.savedScanRevision),
    };
  }
  if (row.sourceType === 'preset_scan') {
    return {
      type: 'preset_scan',
      presetScanId: required(row.presetScanId),
      presetScanRevision: required(row.presetScanRevision),
    };
  }
  if (row.sourceType === 'watchlist_saved_scan') {
    return {
      type: 'watchlist_saved_scan',
      watchlistId: required(row.watchlistId),
      savedScanId: required(row.savedScanId),
      savedScanRevision: required(row.savedScanRevision),
    };
  }
  return {
    type: row.sourceType as
      | 'instrument_price'
      | 'instrument_percent_change'
      | 'instrument_indicator',
    instrumentId: required(row.instrumentId),
  };
}

function isInstrumentSource(
  sourceValue: AlertSource,
): sourceValue is Extract<AlertSource, { instrumentId: string }> {
  return 'instrumentId' in sourceValue;
}

function scanSourceMatches(
  candidate: AlertCandidate,
  run: ScanRunRow,
): boolean {
  if (candidate.source.type === 'saved_scan') {
    return (
      run.sourceType === 'saved_scan' &&
      run.sourceId === candidate.source.savedScanId &&
      run.sourceRevision === candidate.source.savedScanRevision
    );
  }
  if (candidate.source.type === 'preset_scan') {
    return (
      run.sourceType === 'preset_scan' &&
      run.sourceId === candidate.source.presetScanId &&
      run.sourceRevision === candidate.source.presetScanRevision
    );
  }
  if (candidate.source.type !== 'watchlist_saved_scan') return false;
  const snapshot = run.universeSnapshot;
  return (
    run.sourceType === 'saved_scan' &&
    run.sourceId === candidate.source.savedScanId &&
    run.sourceRevision === candidate.source.savedScanRevision &&
    snapshot['type'] === 'watchlist' &&
    snapshot['watchlistId'] === candidate.source.watchlistId
  );
}

function evaluationWindow(event: AlertEvaluationEvent): string {
  return event.type === 'market_data_updated'
    ? `${event.timeframe}:${event.barOpenTime}`
    : `scan-run:${event.scanRunId}`;
}

function mapState(row: AlertStateRow): AlertState {
  return {
    alertId: row.alertId,
    alertRevision: row.alertRevision,
    stateKey: row.stateKey,
    matchState: row.matchState as AlertState['matchState'],
    armed: row.armed,
    stateData: row.stateData,
    lastSourceEventId: row.lastSourceEventId,
    lastDataCutoffAt: row.lastDataCutoffAt,
    lastTriggeredAt: row.lastTriggeredAt,
    updatedAt: row.updatedAt,
  };
}

function stateValues(state: AlertState): typeof alertStates.$inferInsert {
  return {
    alertId: state.alertId,
    alertRevision: state.alertRevision,
    stateKey: state.stateKey,
    matchState: state.matchState,
    armed: state.armed,
    stateData: { ...state.stateData },
    lastSourceEventId: state.lastSourceEventId,
    lastDataCutoffAt: state.lastDataCutoffAt,
    lastTriggeredAt: state.lastTriggeredAt,
    createdAt: state.updatedAt,
    updatedAt: state.updatedAt,
  };
}

function required<T>(value: T | null): T {
  if (value === null) throw new Error('Alert source invariant failed');
  return value;
}
