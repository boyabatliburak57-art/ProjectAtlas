import {
  createCoreIndicatorRegistry,
  ScanRunApplicationService,
} from '@atlas/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../client';
import { runMigrations } from '../migration';
import { seedDatabase } from '../seed';
import { PostgresScanRunRepository } from './postgres-scan-run-repository';

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

const userId = '00000000-0000-4000-8000-000000000501';
const otherUserId = '00000000-0000-4000-8000-000000000502';
const fixedNow = new Date(Date.now() + 60_000);

function scanRule(limit = 10) {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: ['XU100'],
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: 'root',
      operator: 'AND',
      children: [
        {
          type: 'condition',
          nodeId: 'price',
          operator: 'GT',
          left: { type: 'priceField', field: 'close', timeframe: '1d' },
          right: { type: 'constantNumber', value: limit },
        },
      ],
    },
  } as const;
}

describe('PostgresScanRunRepository application integration', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  const repository = new PostgresScanRunRepository(db);
  const service = new ScanRunApplicationService({
    repository,
    universeResolver: {
      resolve: (filter) =>
        Promise.resolve({
          instrumentIds: [
            '00000000-0000-4000-8000-000000000601',
            '00000000-0000-4000-8000-000000000602',
          ],
          filter,
          resolvedAt: new Date('2026-07-13T11:59:00.000Z'),
        }),
    },
    sourceAuthorization: { authorize: () => Promise.resolve(true) },
    planner: {
      indicatorRegistry: createCoreIndicatorRegistry(),
      entitlement: { check: () => ({ allowed: true }) },
      limits: {
        maximumComplexityScore: 100_000,
        asynchronousComplexityThreshold: 10_000,
      },
    },
    now: () => new Date(fixedNow),
  });

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await seedDatabase(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists plan identity and replays only the same normalized request', async () => {
    const first = await service.create({
      userId,
      idempotencyKey: 'db-idempotency-key',
      rule: scanRule(),
    });
    const replay = await service.create({
      userId,
      idempotencyKey: 'db-idempotency-key',
      rule: scanRule(),
    });

    expect(replay).toEqual({ run: first.run, replayed: true });
    expect(first.run).toMatchObject({
      planVersion: 1,
      ruleVersion: 1,
      dataCutoffAt: fixedNow,
      universeSnapshot: {
        instrumentIds: [
          '00000000-0000-4000-8000-000000000601',
          '00000000-0000-4000-8000-000000000602',
        ],
        resolvedAt: '2026-07-13T11:59:00.000Z',
      },
    });
    expect(first.run.idempotencyKeyHash).not.toContain('db-idempotency-key');

    await expect(
      service.create({
        userId,
        idempotencyKey: 'db-idempotency-key',
        rule: scanRule(11),
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    const persisted = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from scan_runs
      where requested_by = ${userId}
    `);
    expect(persisted.rows[0]?.count).toBe('1');
  });

  it('collapses concurrent creates through the database unique guard', async () => {
    const request = {
      userId,
      idempotencyKey: 'concurrent-key',
      rule: scanRule(),
    };
    const [left, right] = await Promise.all([
      service.create(request),
      service.create(request),
    ]);

    expect(left.run.id).toBe(right.run.id);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
  });

  it('enforces ownership, cancellation and transactional state events', async () => {
    const created = await service.create({
      userId,
      idempotencyKey: 'state-key',
      rule: scanRule(),
    });
    await expect(
      service.getOwned(created.run.id, otherUserId),
    ).rejects.toMatchObject({
      code: 'SCAN_RUN_ACCESS_DENIED',
    });

    const running = await service.transitionStatus(created.run.id, 'running');
    const requested = await service.requestCancellation(running.id, userId);
    const replay = await service.requestCancellation(running.id, userId);
    const cancelled = await service.transitionStatus(running.id, 'cancelled');

    expect(requested.status).toBe('cancel_requested');
    expect(replay).toEqual(requested);
    expect(cancelled.status).toBe('cancelled');
    await expect(
      service.requestCancellation(running.id, userId),
    ).rejects.toMatchObject({ code: 'SCAN_RUN_NOT_CANCELLABLE' });

    const events = await db.execute<{
      event_type: string;
      to_status: string;
    }>(sql`
      select event_type, to_status from scan_run_events
      where scan_run_id = ${running.id}
      order by id
    `);
    expect(events.rows).toEqual([
      { event_type: 'run_created', to_status: 'queued' },
      { event_type: 'status_transition', to_status: 'running' },
      { event_type: 'status_transition', to_status: 'cancel_requested' },
      { event_type: 'status_transition', to_status: 'cancelled' },
    ]);
  });
});
