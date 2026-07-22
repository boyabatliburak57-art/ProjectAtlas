import { createHash, randomUUID } from 'node:crypto';

import { AccountDeletionService, RetentionService } from '@atlas/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../client';
import { runMigrations } from '../migration';
import { PostgresRecoveryRepository as RecoveryRepository } from './postgres-recovery-repository';

function requireTestDatabaseUrl(): string {
  const value = process.env['TEST_DATABASE_URL'];
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}

describe('Postgres recovery application paths', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  const repository = new RecoveryRepository(pool, 'test');
  const retainedUserId = randomUUID();
  const deletionUserId = randomUUID();
  const oldNotificationId = randomUUID();
  const heldNotificationId = randomUUID();

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    for (const [id, email] of [
      [retainedUserId, 'retention-076@example.test'],
      [deletionUserId, 'deletion-076@example.test'],
    ]) {
      await pool.query(
        `insert into security_users
          (id, email, normalized_email, password_hash, roles)
         values ($1, $2, $2, 'scrypt-v1$fixture', '[]')`,
        [id, email],
      );
    }
    for (const id of [oldNotificationId, heldNotificationId]) {
      await pool.query(
        `insert into notifications
          (id, user_id, type, title, body, occurred_at, created_at)
         values ($1, $2, 'security', 'retention fixture', 'safe body',
                 now() - interval '400 days', now() - interval '400 days')`,
        [id, retainedUserId],
      );
    }
    await pool.query(
      `insert into legal_holds
        (scope_type, scope_id, reason, status, starts_at, created_by)
       values ('notifications', $1, 'active investigation', 'active',
               now() - interval '1 day', $2)`,
      [heldNotificationId, retainedUserId],
    );
  });

  afterAll(async () => pool.end());

  it('runs a hold-aware, batch-limited and idempotent retention job', async () => {
    const service = new RetentionService(repository, 500);
    const now = new Date('2026-07-21T12:00:00.000Z');
    const first = await service.run(
      'notifications',
      'task-076-notifications-2026-07-21',
      now,
    );
    expect(first).toMatchObject({
      deletedCount: 1,
      scannedCount: 2,
      skippedCount: 1,
    });
    await expect(
      service.run('notifications', 'task-076-notifications-2026-07-21', now),
    ).resolves.toEqual(first);
    const remaining = await pool.query<{ id: string }>(
      'select id from notifications where user_id = $1 order by id',
      [retainedUserId],
    );
    expect(remaining.rows.map((row) => row.id)).toEqual([heldNotificationId]);
    const audit = await pool.query(
      `select 1 from operational_audit_events
       where action = 'retention.batch.completed'
         and resource_id = 'task-076-notifications-2026-07-21'`,
    );
    expect(audit.rowCount).toBe(1);
  });

  it('purges expired incident timelines only through the audited retention context', async () => {
    const incident = await pool.query<{ id: string }>(
      `insert into incidents
        (severity, status, title, summary, detected_at, resolved_at, resolution)
       values ('SEV-4', 'resolved', 'retention fixture', 'safe summary',
               '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', 'resolved')
       returning id`,
    );
    await pool.query(
      `insert into incident_timeline_events
        (incident_id, sequence, event_type, message, created_at)
       values ($1, 1, 'resolved', 'retention fixture',
               '2026-01-02T00:00:00Z')`,
      [incident.rows[0]!.id],
    );
    await expect(
      pool.query(
        'delete from incident_timeline_events where incident_id = $1',
        [incident.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    const service = new RetentionService(repository, 500);
    const result = await service.run(
      'incidents',
      'task-076-incidents-2035-01-01',
      new Date('2035-01-01T00:00:00.000Z'),
    );
    expect(result.deletedCount).toBe(1);
    expect(
      await pool.query('select 1 from incidents where id = $1', [
        incident.rows[0]!.id,
      ]),
    ).toHaveProperty('rowCount', 0);
  });

  it('enforces deletion IDOR, grace, artifact-first purge and safe tombstone', async () => {
    const service = new AccountDeletionService(
      repository,
      (value) => createHash('sha256').update(value).digest('hex'),
      0,
      10,
    );
    await expect(
      service.request(
        { isOperationsAdmin: false, userId: retainedUserId },
        deletionUserId,
        'task-076-deletion-idor',
      ),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_DELETION_ACCESS_DENIED',
    });
    await pool.query(
      `insert into stored_artifacts
        (owner_user_id, artifact_type, object_key, version, checksum_sha256,
         encryption_key_reference, byte_size, status)
       values ($1, 'export', 'users/task-076/export.csv', 1, $2,
               'kms://atlas/recovery-v1', 64, 'active')`,
      [deletionUserId, 'c'.repeat(64)],
    );
    await pool.query(
      `insert into watchlists (owner_user_id, name)
       values ($1, 'private deletion fixture')`,
      [deletionUserId],
    );
    await pool.query(
      `insert into portfolios (user_id, name)
       values ($1, 'private deletion portfolio')`,
      [deletionUserId],
    );
    const requestedAt = new Date('2026-07-21T12:00:00.000Z');
    const request = await service.request(
      { isOperationsAdmin: false, userId: deletionUserId },
      deletionUserId,
      'task-076-deletion-self',
      requestedAt,
    );
    expect(request.status).toBe('disabled');
    const reconciled = await service.reconcile(requestedAt);
    expect(reconciled).toEqual({
      completed: 1,
      failed: 0,
      held: 0,
      scanned: 1,
    });
    const tombstone = await pool.query<{
      status: string;
      subject_hash: string;
      user_id: string | null;
    }>(
      `select status, subject_hash, user_id
       from account_deletion_requests where id = $1`,
      [request.id],
    );
    expect(tombstone.rows[0]).toMatchObject({
      status: 'completed',
      user_id: null,
    });
    expect(tombstone.rows[0]!.subject_hash).toHaveLength(64);
    expect(
      await pool.query('select 1 from security_users where id = $1', [
        deletionUserId,
      ]),
    ).toHaveProperty('rowCount', 0);
    expect(
      await pool.query(
        `select 1 from stored_artifacts
         where object_key = 'users/task-076/export.csv' and status = 'deleted'`,
      ),
    ).toHaveProperty('rowCount', 1);
    expect(
      await pool.query(
        `select 1 from watchlists where owner_user_id = $1
         union all select 1 from portfolios where user_id = $1`,
        [deletionUserId],
      ),
    ).toHaveProperty('rowCount', 0);
  });

  it('expires completed account tombstones through the versioned policy', async () => {
    const service = new RetentionService(repository, 500);
    const result = await service.run(
      'deleted_accounts',
      'task-076-deleted-accounts-2035',
      new Date('2035-01-01T00:00:00.000Z'),
    );
    expect(result.deletedCount).toBe(1);
    expect(
      await pool.query(
        `select 1 from account_deletion_requests where status = 'completed'`,
      ),
    ).toHaveProperty('rowCount', 0);
  });
});
