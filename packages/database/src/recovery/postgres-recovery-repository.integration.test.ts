import { createHash, randomUUID } from 'node:crypto';

import {
  AccountDeletionService,
  LegalHoldService,
  RetentionService,
} from '@atlas/domain';
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
               '2026-07-20T12:00:00Z', $2)`,
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

  it('allows expired holds to be purged on later runs', async () => {
    const expiredId = await artifact('export', 'expired-hold');
    await pool.query(
      `insert into legal_holds
        (scope_type, scope_id, reason, status, starts_at, expires_at, created_by)
       values ('export', $1, 'expired investigation', 'active',
               '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', $2)`,
      [expiredId, retainedUserId],
    );
    const now = new Date('2027-07-21T12:00:00.000Z');
    await expect(
      new RetentionService(repository).run('exports', 'expired-hold-run', now),
    ).resolves.toMatchObject({ deletedCount: 1, skippedCount: 0 });
  });

  it('purges a record after its hold is explicitly released', async () => {
    const releasedId = await artifact('import', 'released-hold');
    const hold = await pool.query<{ id: string }>(
      `insert into legal_holds
        (scope_type, scope_id, reason, status, starts_at, created_by)
       values ('import_files', $1, 'released investigation', 'active',
               '2026-01-01T00:00:00Z', $2) returning id`,
      [releasedId, retainedUserId],
    );
    await new LegalHoldService(repository).release(
      { isOperationsAdmin: true, userId: retainedUserId },
      hold.rows[0]!.id,
      'investigation completed',
      new Date('2026-02-01T00:00:00Z'),
    );
    await expect(
      new RetentionService(repository).run(
        'import_files',
        'released-hold-run',
        new Date('2027-07-21T12:00:00.000Z'),
      ),
    ).resolves.toMatchObject({ deletedCount: 1, skippedCount: 0 });
  });

  it('preserves hold checks at a batch boundary while deleting eligible peers', async () => {
    const held = await artifact('export', 'batch-held');
    await artifact('export', 'batch-delete');
    await pool.query(
      `insert into legal_holds
        (scope_type, scope_id, reason, status, starts_at, created_by)
       values ('resource', $1, 'batch boundary hold', 'active',
               '2026-01-01T00:00:00Z', $2)`,
      [held, retainedUserId],
    );
    const result = await new RetentionService(repository, 2).run(
      'exports',
      'batch-boundary-run',
      new Date('2027-07-21T12:00:00.000Z'),
    );
    expect(result).toMatchObject({
      deletedCount: 1,
      scannedCount: 2,
      skippedCount: 1,
    });
  });

  it('supports resource, user, run and export hold scopes', async () => {
    const candidate = {
      category: 'backtest_details' as const,
      id: randomUUID(),
      ownerUserId: retainedUserId,
    };
    for (const [scopeType, scopeId] of [
      ['resource', candidate.id],
      ['run', candidate.id],
      ['user', retainedUserId],
    ]) {
      const hold = await pool.query<{ id: string }>(
        `insert into legal_holds
          (scope_type, scope_id, reason, status, starts_at, created_by)
         values ($1, $2, 'multi scope validation', 'active',
                 '2026-01-01T00:00:00Z', $3) returning id`,
        [scopeType, scopeId, retainedUserId],
      );
      await expect(
        repository.isHeld(candidate, new Date('2026-07-21T12:00:00Z')),
      ).resolves.toBe(true);
      await pool.query('delete from legal_holds where id = $1', [
        hold.rows[0]!.id,
      ]);
    }
    const exportId = await artifact('export', 'typed-export');
    await pool.query(
      `insert into legal_holds
        (scope_type, scope_id, reason, status, starts_at, created_by)
       values ('export', $1, 'typed export validation', 'active',
               '2026-01-01T00:00:00Z', $2)`,
      [exportId, retainedUserId],
    );
    await expect(
      repository.isHeld(
        { category: 'exports', id: exportId, ownerUserId: retainedUserId },
        new Date('2026-07-21T12:00:00Z'),
      ),
    ).resolves.toBe(true);
  });

  it('dry-runs without deleting and records the simulated audit result', async () => {
    const id = await artifact('import', 'dry-run');
    const result = await new RetentionService(repository).run(
      'import_files',
      'retention-dry-run',
      new Date('2027-07-21T12:00:00Z'),
      { dryRun: true },
    );
    expect(result).toMatchObject({ deletedCount: 1, dryRun: true });
    await expect(
      pool.query('select 1 from stored_artifacts where id = $1', [id]),
    ).resolves.toHaveProperty('rowCount', 1);
    const audit = await pool.query<{ dry_run: boolean }>(
      `select (after_state ->> 'dryRun')::boolean dry_run
       from operational_audit_events where resource_id = 'retention-dry-run'`,
    );
    expect(audit.rows[0]?.dry_run).toBe(true);
  });

  it('rechecks a concurrently activated hold inside the delete transaction', async () => {
    const id = await artifact('export', 'concurrent-hold');
    const candidate = {
      category: 'exports' as const,
      id,
      ownerUserId: retainedUserId,
    };
    const now = new Date('2027-07-21T12:00:00Z');
    await expect(repository.isHeld(candidate, now)).resolves.toBe(false);
    await pool.query(
      `insert into legal_holds
        (scope_type, scope_id, reason, status, starts_at, created_by)
       values ('export', $1, 'concurrent activation', 'active', $2, $3)`,
      [id, now, retainedUserId],
    );
    await expect(repository.deleteCandidate(candidate, now)).resolves.toBe(
      false,
    );
    await expect(
      pool.query('select 1 from stored_artifacts where id = $1', [id]),
    ).resolves.toHaveProperty('rowCount', 1);
  });

  it('resumes batch processing with a new execution key without duplicates', async () => {
    await pool.query(
      `delete from stored_artifacts where artifact_type = 'import'
       and object_key like 'task-080r/%'`,
    );
    await artifact('import', 'resume-one');
    await artifact('import', 'resume-two');
    const service = new RetentionService(repository, 1);
    const now = new Date('2027-07-21T12:00:00Z');
    const first = await service.run('import_files', 'resume-page-one', now);
    const second = await service.run('import_files', 'resume-page-two', now);
    expect([first.deletedCount, second.deletedCount]).toEqual([1, 1]);
    await expect(
      service.run('import_files', 'resume-page-two', now),
    ).resolves.toEqual(second);
  });

  it('requires an operations admin and reason for hold changes and audits both actions', async () => {
    const service = new LegalHoldService(repository);
    const now = new Date('2026-07-21T12:00:00Z');
    await expect(
      service.create(
        { isOperationsAdmin: false, userId: retainedUserId },
        {
          reason: 'unauthorized hold request',
          scopeId: retainedUserId,
          scopeType: 'user',
          startsAt: now,
        },
      ),
    ).rejects.toMatchObject({ code: 'LEGAL_HOLD_ADMIN_REQUIRED' });
    const hold = await service.create(
      { isOperationsAdmin: true, userId: retainedUserId },
      {
        reason: 'authorized investigation hold',
        scopeId: retainedUserId,
        scopeType: 'user',
        startsAt: now,
      },
    );
    await service.release(
      { isOperationsAdmin: true, userId: retainedUserId },
      hold.id,
      'investigation completed',
      new Date('2026-07-22T12:00:00Z'),
    );
    const audit = await pool.query<{ action: string }>(
      `select action from operational_audit_events where resource_id = $1
       order by created_at`,
      [hold.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'legal_hold.created',
      'legal_hold.released',
    ]);
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

  async function artifact(
    type: 'export' | 'import',
    suffix: string,
  ): Promise<string> {
    const result = await pool.query<{ id: string }>(
      `insert into stored_artifacts
        (owner_user_id, artifact_type, object_key, version, checksum_sha256,
         encryption_key_reference, byte_size, status, retention_until, created_at)
       values ($1, $2, $3, 1, $4, 'kms://atlas/task-080r', 1, 'active',
               '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z') returning id`,
      [retainedUserId, type, `task-080r/${suffix}`, 'd'.repeat(64)],
    );
    return result.rows[0]!.id;
  }
});
