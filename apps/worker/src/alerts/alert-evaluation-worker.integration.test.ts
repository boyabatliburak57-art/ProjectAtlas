import {
  alerts,
  alertEvaluations,
  alertRevisions,
  alertStates,
  alertTriggers,
  createDatabase,
  dataProviders,
  instruments,
  priceBars,
  runMigrations,
  savedScanRevisions,
  savedScans,
  scanResults,
  scanRuns,
} from '@atlas/database';
import type { AlertEvaluationQueuePayload } from '@atlas/types';
import { and, count, eq } from 'drizzle-orm';
import { Queue, QueueEvents } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseEnvironment } from '../config/environment';
import { StructuredLogger } from '../observability/structured-logger';
import { enqueueAlertEvaluation } from '../queue/alert-queue';
import {
  DEFAULT_JOB_OPTIONS,
  JOB_NAMES,
  QUEUE_NAMES,
} from '../queue/queue-contracts';
import { createRedisConnection } from '../queue/redis-connection';
import { WorkerRuntime } from '../runtime/worker-runtime';
import { createAlertComposition } from './alert-composition';
import type { AlertSourceEvaluator } from './contracts';
import { AlertEvaluationError } from './errors';
import { InMemoryAlertMetrics } from './metrics';
import { PostgresAlertEvaluationRepository } from './postgres-alert-evaluation-repository';
import { PostgresAlertSourceEvaluator } from './postgres-alert-source-evaluator';

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
const ownerId = '00000000-0000-4000-8000-000000001601';
const instrumentA = '00000000-0000-4000-8000-000000001611';
const instrumentB = '00000000-0000-4000-8000-000000001612';
const instrumentC = '00000000-0000-4000-8000-000000001613';
const oncePerBarAlertId = '00000000-0000-4000-8000-000000001621';
const afterResetAlertId = '00000000-0000-4000-8000-000000001622';
const notEvaluableAlertId = '00000000-0000-4000-8000-000000001623';
const newMatchAlertId = '00000000-0000-4000-8000-000000001624';
const indicatorAlertId = '00000000-0000-4000-8000-000000001625';
const savedScanId = '00000000-0000-4000-8000-000000001631';

describe('alert evaluation BullMQ runtime', () => {
  const databaseUrl = requireTestDatabaseUrl();
  const { db, pool } = createDatabase(databaseUrl);
  const connection = createRedisConnection(redisUrl);
  const queue = new Queue<AlertEvaluationQueuePayload>(QUEUE_NAMES.alerts, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  const queueEvents = new QueueEvents(QUEUE_NAMES.alerts, { connection });
  const logger = new StructuredLogger('error', { write: () => undefined });
  const metrics = new InMemoryAlertMetrics();
  const repository = new PostgresAlertEvaluationRepository(db);
  const postgresEvaluator = new PostgresAlertSourceEvaluator(db);
  let transientEventId: string | null = null;
  let transientFailures = 0;
  const evaluator: AlertSourceEvaluator = {
    async evaluate(candidate, event) {
      if (event.eventId === transientEventId && transientFailures === 0) {
        transientFailures += 1;
        throw new AlertEvaluationError('TEMPORARY_DATABASE_READ', true);
      }
      return postgresEvaluator.evaluate(candidate, event);
    },
  };
  const alertComposition = createAlertComposition({
    database: db,
    logger,
    repository,
    evaluator,
    metrics,
    catchUpLimit: 100,
  });
  const noOpComposition = {
    process: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  const environment = parseEnvironment({
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    WORKER_CONCURRENCY: 1,
    WORKER_HEARTBEAT_INTERVAL_MS: 60_000,
  });
  let runtime: WorkerRuntime;
  let providerId: string;
  let barSequence = 0;
  let runSequence = 0;

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await queue.waitUntilReady();
    await queueEvents.waitUntilReady();
    await queue.obliterate({ force: true });
    await pool.query(`
      insert into feature_flag_versions
        (flag_id, version, environment, enabled, targeting_rules, reason, changed_by)
      select id, 1, 'local', false, '{}'::jsonb,
             'Integration fixture safe state',
             '00000000-0000-4000-8000-000000000000'::uuid
      from feature_flags where key = 'alerts.evaluation.disabled'
      on conflict do nothing
    `);
    await (
      await queue.client
    ).del('atlas:feature-flags:v1:local:alerts.evaluation.disabled');

    providerId = (
      await db
        .insert(dataProviders)
        .values({
          code: 'alert-fixture',
          name: 'Alert Fixture',
          status: 'active',
        })
        .returning({ id: dataProviders.id })
    )[0]!.id;
    await db.insert(instruments).values(
      [instrumentA, instrumentB, instrumentC].map((id, index) => ({
        id,
        symbol: `ALT${index + 1}`,
        normalizedSymbol: `ALT${index + 1}`,
        name: `Alert Fixture ${index + 1}`,
        marketCode: 'BIST',
        currencyCode: 'TRY',
        status: 'active',
      })),
    );
    await db.insert(savedScans).values({
      id: savedScanId,
      ownerUserId: ownerId,
      name: 'Alert scan',
      currentRevision: 1,
    });
    await db.insert(savedScanRevisions).values({
      savedScanId,
      revision: 1,
      ruleVersion: 1,
      ruleAst: { version: 1 },
      createdBy: ownerId,
    });
    await insertInstrumentAlert(oncePerBarAlertId, 'oncePerClosedBar', {
      operator: 'GT',
      threshold: 100,
    });
    await insertInstrumentAlert(afterResetAlertId, 'afterReset', {
      operator: 'GT',
      threshold: 100,
    });
    await insertInstrumentAlert(notEvaluableAlertId, 'once', {
      malformed: true,
    });
    await insertInstrumentAlert(
      indicatorAlertId,
      'once',
      {
        indicatorCode: 'SMA',
        indicatorVersion: 1,
        parameters: { period: 2 },
        operator: 'GT',
        threshold: 100,
      },
      'instrument_indicator',
    );
    await db.insert(alerts).values({
      id: newMatchAlertId,
      ownerUserId: ownerId,
      name: 'Saved scan new matches',
      status: 'active',
      currentRevision: 1,
    });
    await db.insert(alertRevisions).values({
      alertId: newMatchAlertId,
      revision: 1,
      sourceType: 'saved_scan',
      savedScanId,
      savedScanRevision: 1,
      triggerPolicy: 'newMatch',
      repeatPolicy: 'everyNewMatch',
      evaluationMode: 'closed_bar',
      sourceConfiguration: {},
      channels: ['in_app'],
      createdBy: ownerId,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    runtime = await startRuntime();
  });

  afterAll(async () => {
    await runtime?.stop('alert-integration-cleanup');
    await Promise.allSettled([queueEvents.close(), queue.close(), pool.end()]);
  });

  it('does not create a duplicate trigger for the same event and cutoff', async () => {
    const event = await insertBarEvent(110, '2026-07-15T07:00:00.000Z');
    await process(event);
    const before = await triggerCount(oncePerBarAlertId);
    const duplicate = await queue.add(JOB_NAMES.alertEvaluate, event, {
      attempts: 1,
      jobId: `forced-duplicate-${event.eventId}`,
    });
    await duplicate.waitUntilFinished(queueEvents, 10_000);

    expect(await triggerCount(oncePerBarAlertId)).toBe(before);
    expect(await evaluationCount(oncePerBarAlertId)).toBe(1);
    expect(
      metrics.counters.get('alert.evaluation.dedup'),
    ).toBeGreaterThanOrEqual(3);
  });

  it('enforces oncePerClosedBar across corrected events in the same bar', async () => {
    const sameBar = await insertBarEvent(120, '2026-07-15T07:00:00.000Z', 2);
    await process(sameBar);
    expect(await triggerCount(oncePerBarAlertId)).toBe(1);

    const nextBar = await insertBarEvent(125, '2026-07-16T07:00:00.000Z');
    await process(nextBar);
    expect(await triggerCount(oncePerBarAlertId)).toBe(2);
  });

  it('evaluates an instrument indicator through the core registry', async () => {
    expect(await triggerCount(indicatorAlertId)).toBe(1);
    const matched = await db
      .select({ status: alertEvaluations.status })
      .from(alertEvaluations)
      .where(
        and(
          eq(alertEvaluations.alertId, indicatorAlertId),
          eq(alertEvaluations.status, 'matched'),
        ),
      );
    expect(matched).toHaveLength(1);
  });

  it('rearms afterReset only after a not-matched evaluation', async () => {
    expect(await triggerCount(afterResetAlertId)).toBe(1);
    await process(await insertBarEvent(90, '2026-07-17T07:00:00.000Z'));
    const armed = (
      await db
        .select({ armed: alertStates.armed })
        .from(alertStates)
        .where(eq(alertStates.alertId, afterResetAlertId))
    )[0];
    expect(armed?.armed).toBe(true);
    await process(await insertBarEvent(130, '2026-07-18T07:00:00.000Z'));
    expect(await triggerCount(afterResetAlertId)).toBe(2);
  });

  it('creates newMatch triggers only for newly entered symbols', async () => {
    const firstRun = await insertCompletedRun([instrumentA, instrumentB]);
    await process(scanEvent(firstRun));
    const secondRun = await insertCompletedRun([instrumentB, instrumentC]);
    await process(scanEvent(secondRun));

    const rows = await db
      .select({ instrumentId: alertTriggers.instrumentId })
      .from(alertTriggers)
      .where(eq(alertTriggers.alertId, newMatchAlertId));
    expect(rows.map(({ instrumentId }) => instrumentId).sort()).toEqual(
      [instrumentA, instrumentB, instrumentC].sort(),
    );
  });

  it('persists notEvaluable reason without creating a trigger', async () => {
    expect(await triggerCount(notEvaluableAlertId)).toBe(0);
    const rows = await db
      .select({
        status: alertEvaluations.status,
        reason: alertEvaluations.reasonCode,
      })
      .from(alertEvaluations)
      .where(eq(alertEvaluations.alertId, notEvaluableAlertId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(({ status }) => status === 'not_evaluable')).toBe(true);
    expect(rows[0]?.reason).toBe('ALERT_SOURCE_INVALID');
  });

  it('retries a transient evaluation failure and commits once', async () => {
    const event = await insertBarEvent(140, '2026-07-19T07:00:00.000Z');
    transientEventId = event.eventId;
    const job = await enqueueAlertEvaluation(queue, event, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10 },
    });
    await job.waitUntilFinished(queueEvents, 10_000);

    expect(transientFailures).toBe(1);
    expect(await evaluationCount(oncePerBarAlertId, event.eventId)).toBe(1);
  });

  it('catches up a scan completion created while the worker is stopped', async () => {
    await runtime.stop('simulate-restart');
    const runId = await insertCompletedRun([instrumentA, instrumentC]);
    runtime = await startRuntime();
    await waitFor(
      async () =>
        (await evaluationCount(
          newMatchAlertId,
          `scan-run:${runId}:completed`,
        )) === 1,
    );

    const trigger = await db
      .select({ instrumentId: alertTriggers.instrumentId })
      .from(alertTriggers)
      .where(
        and(
          eq(alertTriggers.alertId, newMatchAlertId),
          eq(alertTriggers.instrumentId, instrumentA),
        ),
      );
    expect(trigger).toHaveLength(2);
  }, 15_000);

  it('enforces the alert kill switch at the production worker boundary', async () => {
    await pool.query(`
      insert into feature_flag_versions
        (flag_id, version, environment, enabled, targeting_rules, reason, changed_by)
      select id, 2, 'local', true, '{}'::jsonb,
             'Worker boundary integration test',
             '00000000-0000-4000-8000-000000000000'::uuid
      from feature_flags where key = 'alerts.evaluation.disabled'
    `);
    const redis = await queue.client;
    await redis.del('atlas:feature-flags:v1:local:alerts.evaluation.disabled');
    const event = await insertBarEvent(150, '2026-07-20T07:00:00.000Z');
    const job = await enqueueAlertEvaluation(queue, event, { attempts: 1 });

    await expect(job.waitUntilFinished(queueEvents, 10_000)).rejects.toThrow(
      'WORKER_KILL_SWITCH_ENABLED',
    );
    expect(await evaluationCount(oncePerBarAlertId, event.eventId)).toBe(0);
  });

  async function startRuntime(): Promise<WorkerRuntime> {
    return WorkerRuntime.start(
      environment,
      logger,
      noOpComposition,
      noOpComposition,
      alertComposition,
    );
  }

  async function insertInstrumentAlert(
    id: string,
    repeatPolicy: 'once' | 'oncePerClosedBar' | 'afterReset',
    sourceConfiguration: Record<string, unknown>,
    sourceType:
      | 'instrument_price'
      | 'instrument_indicator' = 'instrument_price',
  ): Promise<void> {
    await db.insert(alerts).values({
      id,
      ownerUserId: ownerId,
      name: `Price alert ${id}`,
      status: 'active',
      currentRevision: 1,
    });
    await db.insert(alertRevisions).values({
      alertId: id,
      revision: 1,
      sourceType,
      instrumentId: instrumentA,
      triggerPolicy: 'thresholdCrossed',
      repeatPolicy,
      timeframe: '1d',
      evaluationMode: 'closed_bar',
      sourceConfiguration,
      channels: ['in_app'],
      createdBy: ownerId,
    });
  }

  async function insertBarEvent(
    close: number,
    openTimeValue: string,
    revision = 1,
  ): Promise<
    Extract<AlertEvaluationQueuePayload, { type: 'market_data_updated' }>
  > {
    barSequence += 1;
    const openTime = new Date(openTimeValue);
    const closeTime = new Date(openTime.getTime() + 8 * 60 * 60 * 1_000);
    const row = (
      await db
        .insert(priceBars)
        .values({
          instrumentId: instrumentA,
          providerId,
          timeframe: '1d',
          openTime,
          closeTime,
          open: String(close),
          high: String(close),
          low: String(close),
          close: String(close),
          volume: '1000',
          isClosed: true,
          revision,
        })
        .returning({ id: priceBars.id })
    )[0]!;
    return {
      type: 'market_data_updated',
      eventId: `fixture-bar:${barSequence}:${row.id}`,
      instrumentId: instrumentA,
      timeframe: '1d',
      barOpenTime: openTime.toISOString(),
      dataCutoffAt: closeTime.toISOString(),
      isClosed: true,
    };
  }

  async function insertCompletedRun(
    matchedInstrumentIds: readonly string[],
  ): Promise<string> {
    runSequence += 1;
    const runId = `00000000-0000-4000-8000-${String(1_700 + runSequence).padStart(12, '0')}`;
    const startedAt = new Date(
      `2026-07-${String(19 + runSequence).padStart(2, '0')}T08:00:00Z`,
    );
    const completedAt = new Date(startedAt.getTime() + 1_000);
    await db.insert(scanRuns).values({
      id: runId,
      sourceType: 'saved_scan',
      sourceId: savedScanId,
      sourceRevision: 1,
      requestedBy: ownerId,
      idempotencyKeyHash: `alert-run-${runSequence}`,
      requestHash: `alert-request-${runSequence}`,
      status: 'completed',
      executionMode: 'async',
      planVersion: 1,
      ruleVersion: 1,
      normalizedRuleAst: { version: 1 },
      executionPlan: { planVersion: 1 },
      universeSnapshot: {
        type: 'active_bist',
        instrumentIds: matchedInstrumentIds,
      },
      complexityScore: '1',
      dataCutoffAt: completedAt,
      queuedAt: startedAt,
      startedAt,
      completedAt,
      progressTotal: matchedInstrumentIds.length,
      progressProcessed: matchedInstrumentIds.length,
      matchedCount: matchedInstrumentIds.length,
    });
    if (matchedInstrumentIds.length > 0) {
      await db.insert(scanResults).values(
        matchedInstrumentIds.map((instrumentId, index) => ({
          scanRunId: runId,
          instrumentId,
          rank: index + 1,
          status: 'matched',
          dataCutoffAt: completedAt,
          matchedAt: completedAt,
          sourceBatchIndex: 0,
        })),
      );
    }
    return runId;
  }

  function scanEvent(
    scanRunId: string,
  ): Extract<AlertEvaluationQueuePayload, { type: 'scan_completed' }> {
    return {
      type: 'scan_completed',
      eventId: `scan-run:${scanRunId}:completed`,
      scanRunId,
      dataCutoffAt: new Date(
        `2026-07-${String(19 + runSequence).padStart(2, '0')}T08:00:01Z`,
      ).toISOString(),
    };
  }

  async function process(event: AlertEvaluationQueuePayload): Promise<void> {
    const job = await enqueueAlertEvaluation(queue, event, {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10 },
    });
    await job.waitUntilFinished(queueEvents, 10_000);
  }

  async function triggerCount(alertId: string): Promise<number> {
    return (
      (
        await db
          .select({ value: count() })
          .from(alertTriggers)
          .where(eq(alertTriggers.alertId, alertId))
      )[0]?.value ?? 0
    );
  }

  async function evaluationCount(
    alertId: string,
    eventId?: string,
  ): Promise<number> {
    return (
      (
        await db
          .select({ value: count() })
          .from(alertEvaluations)
          .where(
            eventId === undefined
              ? eq(alertEvaluations.alertId, alertId)
              : and(
                  eq(alertEvaluations.alertId, alertId),
                  eq(alertEvaluations.sourceEventId, eventId),
                ),
          )
      )[0]?.value ?? 0
    );
  }
});

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
