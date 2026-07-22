import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../client';
import { runMigrations } from '../migration';

function requireTestDatabaseUrl(): string {
  const value = process.env['TEST_DATABASE_URL'];
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}

describe('recovery and retention migration invariants', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  const userId = randomUUID();

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await pool.query(
      `insert into security_users
        (id, email, normalized_email, password_hash, roles)
       values ($1, 'recovery@example.test', 'recovery@example.test',
               'scrypt-v1$fixture', '[]')`,
      [userId],
    );
  });

  afterAll(async () => pool.end());

  it('persists complete backup capabilities and unique references', async () => {
    const insert = `insert into backup_status_checks
      (environment, provider_adapter, backup_reference, backup_created_at,
       encrypted, pitr_enabled, separate_failure_domain, retention_days, status)
      values ('staging', 'managed-postgres-v1', 'backup-076', now(),
              true, true, true, 35, 'healthy')`;
    await pool.query(insert);
    await expect(pool.query(insert)).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `insert into backup_status_checks
          (environment, provider_adapter, backup_reference, backup_created_at,
           encrypted, pitr_enabled, separate_failure_domain, retention_days,
           status, failure_code)
         values ('staging', 'managed-postgres-v1', 'invalid-healthy', now(),
                 true, true, true, 35, 'healthy', 'BACKUP_FAILED')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('makes terminal drill evidence immutable while permitting cleanup evidence', async () => {
    const drill = await pool.query<{ id: string }>(
      `insert into recovery_drills
        (drill_type, environment, backup_reference, source_cutoff_at,
         target_rpo_seconds, achieved_rpo_seconds, target_rto_seconds,
         achieved_rto_seconds, status, validation_summary, started_at,
         completed_at, executed_by)
       values ('full', 'recovery', 'backup-076', now() - interval '10 seconds',
               900, 10, 7200, 25, 'passed', '{"smoke":"PASS"}',
               now() - interval '25 seconds', now(), $1)
       returning id`,
      [userId],
    );
    await pool.query(
      'update recovery_drills set cleanup_completed_at = now() where id = $1',
      [drill.rows[0]!.id],
    );
    await expect(
      pool.query(
        `update recovery_drills
         set achieved_rpo_seconds = 899
         where id = $1`,
        [drill.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('guards retention idempotency, terminal history and legal-hold ownership', async () => {
    const run = await pool.query<{ id: string }>(
      `insert into retention_job_runs
        (execution_key, policy_code, policy_version, status, scanned_count,
         deleted_count, skipped_count, started_at, completed_at)
       values ('retention-076', 'notifications', 'retention-v1', 'completed',
               10, 8, 2, now() - interval '1 second', now()) returning id`,
    );
    await expect(
      pool.query(
        `insert into retention_job_runs
          (execution_key, policy_code, policy_version, status, started_at)
         values ('retention-076', 'notifications', 'retention-v1', 'running', now())`,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        'update retention_job_runs set deleted_count = 9 where id = $1',
        [run.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      pool.query(
        `insert into legal_holds
          (scope_type, scope_id, reason, status, starts_at, created_by)
         values ('user', 'subject-076', 'security investigation', 'active',
                 now(), $1)`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('guards artifact versions/checksums and deletion request identity', async () => {
    const insertArtifact = `insert into stored_artifacts
      (owner_user_id, artifact_type, object_key, version, checksum_sha256,
       encryption_key_reference, byte_size, status, retention_until)
      values ($1, 'export', 'users/fixture/export.csv', 1, $2,
              'kms://atlas/recovery-v1', 42, 'active', now() + interval '30 days')`;
    await pool.query(insertArtifact, [userId, 'a'.repeat(64)]);
    await expect(
      pool.query(insertArtifact, [userId, 'a'.repeat(64)]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `insert into stored_artifacts
          (owner_user_id, artifact_type, object_key, version, checksum_sha256,
           encryption_key_reference, byte_size, status)
         values ($1, 'export', 'users/fixture/invalid.csv', 1, 'invalid',
                 'kms://atlas/recovery-v1', 1, 'active')`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const deletion = `insert into account_deletion_requests
      (user_id, subject_hash, idempotency_key, status, requested_at, grace_until)
      values ($1, $2, 'delete-076', 'disabled', now(), now() + interval '30 days')`;
    await pool.query(deletion, [userId, 'b'.repeat(64)]);
    await expect(
      pool.query(deletion, [userId, 'b'.repeat(64)]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(deletion.replace("'delete-076'", "'delete-invalid'"), [
        randomUUID(),
        'b'.repeat(64),
      ]),
    ).rejects.toMatchObject({ code: '23503' });
  });
});
