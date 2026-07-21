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

describe('security authority migration invariants', () => {
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
       values ($1, 'security@example.test', 'security@example.test',
               'scrypt-v1$fixture', '["operations_admin"]')`,
      [userId],
    );
  });

  afterAll(async () => pool.end());

  it('requires valid session ownership and unique token hashes', async () => {
    const values = [
      userId,
      'a'.repeat(64),
      'b'.repeat(64),
      new Date(Date.now() + 86_400_000),
      new Date(Date.now() + 3_600_000),
      'c'.repeat(64),
      'd'.repeat(64),
    ];
    await pool.query(
      `insert into auth_sessions
        (user_id, token_hash, csrf_token_hash, session_version, expires_at,
         idle_expires_at, ip_hash, user_agent_hash)
       values ($1, $2, $3, 1, $4, $5, $6, $7)`,
      values,
    );
    await expect(
      pool.query(
        `insert into auth_sessions
          (user_id, token_hash, csrf_token_hash, session_version, expires_at,
           idle_expires_at, ip_hash, user_agent_hash)
         values ($1, $2, $3, 1, $4, $5, $6, $7)`,
        values,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `insert into password_reset_tokens (user_id, token_hash, expires_at)
         values ($1, $2, now() + interval '15 minutes')`,
        [randomUUID(), 'e'.repeat(64)],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('atomically guards rate buckets and flag version identities', async () => {
    const bucket = [
      'f'.repeat(64),
      'normal_read',
      new Date('2026-07-21T12:00:00Z'),
      new Date('2026-07-21T12:02:00Z'),
    ];
    const insertBucket = `insert into security_rate_limit_buckets
      (subject_hash, limit_class, window_started_at, request_count, expires_at)
      values ($1, $2, $3, 1, $4)`;
    await pool.query(insertBucket, bucket);
    await expect(pool.query(insertBucket, bucket)).rejects.toMatchObject({
      code: '23505',
    });

    const flag = await pool.query<{ id: string }>(
      `insert into feature_flags (key, description, flag_type)
       values ('security-kill-switch', 'Security fixture', 'kill_switch')
       returning id`,
    );
    await pool.query(
      `insert into feature_flag_versions
        (flag_id, version, environment, enabled, rollout_percentage,
         reason, changed_by)
       values ($1, 1, 'staging', true, 100, 'security test', $2)`,
      [flag.rows[0]!.id, userId],
    );
    await expect(
      pool.query(
        `insert into feature_flag_versions
          (flag_id, version, environment, enabled, rollout_percentage,
           reason, changed_by)
         values ($1, 1, 'staging', false, 0, 'duplicate', $2)`,
        [flag.rows[0]!.id, userId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `insert into feature_flag_versions
          (flag_id, version, environment, enabled, rollout_percentage,
           reason, changed_by)
         values ($1, 2, 'staging', true, 101, 'invalid rollout', $2)`,
        [flag.rows[0]!.id, userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps operational history immutable and validates release digests', async () => {
    const audit = await pool.query<{ id: string }>(
      `insert into operational_audit_events
        (actor_user_id, actor_type, action, resource_type, resource_id,
         environment, reason)
       values ($1, 'user', 'feature_flag.version.create', 'feature_flag',
               'security-kill-switch', 'staging', 'fixture') returning id`,
      [userId],
    );
    await expect(
      pool.query(
        'update operational_audit_events set reason = $1 where id = $2',
        ['tampered', audit.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      pool.query(
        `insert into release_records
          (version, commit_sha, image_digest, environment, status)
         values ('v0.9-invalid', 'abc1234', 'latest', 'staging', 'planned')`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
