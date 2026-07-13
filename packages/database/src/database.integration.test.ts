import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from './client';
import { migrationFolder, runMigrations } from './migration';
import { seedDatabase } from './seed';

function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (databaseUrl === undefined) {
    throw new Error(
      'TEST_DATABASE_URL is required for database integration tests',
    );
  }

  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error('TEST_DATABASE_URL database name must end with _test');
  }

  return databaseUrl;
}

const scannerTables = [
  'preset_scan_revisions',
  'preset_scans',
  'saved_scan_revisions',
  'saved_scan_tags',
  'saved_scans',
  'scan_categories',
  'scan_results',
  'scan_run_batches',
  'scan_run_events',
  'scan_runs',
] as const;

describe('PostgreSQL migrations', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await runMigrations(db);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('clean-migrates exactly the eighteen domain tables', async () => {
    const result = await pool.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'data_providers',
      'data_quality_issues',
      'ingestion_runs',
      'instrument_symbol_history',
      'instruments',
      'preset_scan_revisions',
      'preset_scans',
      'price_bars',
      'provider_instrument_mappings',
      'saved_scan_revisions',
      'saved_scan_tags',
      'saved_scans',
      'scan_categories',
      'scan_results',
      'scan_run_batches',
      'scan_run_events',
      'scan_runs',
      'sectors',
    ]);
  });

  it('rejects an invalid foreign key', async () => {
    await expect(
      pool.query(
        `insert into provider_instrument_mappings
          (provider_id, instrument_id, provider_symbol)
         values ($1, $2, $3)`,
        [randomUUID(), randomUUID(), 'INVALID'],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects a duplicate price bar revision', async () => {
    const provider = await pool.query<{ id: string }>(`
      insert into data_providers (code, name, status)
      values ('integration-provider', 'Integration Provider', 'active')
      returning id
    `);
    const instrument = await pool.query<{ id: string }>(`
      insert into instruments
        (symbol, normalized_symbol, name, market_code, currency_code, status)
      values ('TST01', 'TST01', 'Test Instrument', 'BIST', 'TRY', 'active')
      returning id
    `);
    const values = [
      instrument.rows[0]?.id,
      provider.rows[0]?.id,
      '1d',
      '2026-07-11T00:00:00.000Z',
      '2026-07-12T00:00:00.000Z',
      '100.00',
      '105.00',
      '99.00',
      '103.00',
      '1000000',
      1,
    ];
    const insert = `
      insert into price_bars
        (instrument_id, provider_id, timeframe, open_time, close_time,
         open, high, low, close, volume, revision)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    await pool.query(insert, values);
    await expect(pool.query(insert, values)).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('applies the seed idempotently', async () => {
    await seedDatabase(db);
    await seedDatabase(db);

    const result = await db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from data_providers
      where code = 'manual-import'
    `);

    expect(result.rows[0]?.count).toBe('1');

    const categories = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from scan_categories
    `);
    expect(categories.rows[0]?.count).toBe('8');

    const presets = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from preset_scans
    `);
    const revisions = await db.execute<{ count: string }>(sql`
      select count(*)::text as count from preset_scan_revisions
    `);
    expect(presets.rows[0]?.count).toBe('10');
    expect(revisions.rows[0]?.count).toBe('10');

    const published = await db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from preset_scans p
      join preset_scan_revisions r
        on r.preset_scan_id = p.id and r.revision = p.current_revision
      where p.status = 'published' and r.lifecycle_status = 'published'
    `);
    expect(published.rows[0]?.count).toBe('10');
  });

  it('keeps saved and preset revisions immutable and parents soft deletable', async () => {
    const userId = randomUUID();
    const saved = await pool.query<{ id: string }>(
      `insert into saved_scans (owner_user_id, name) values ($1, 'Immutable') returning id`,
      [userId],
    );
    const savedId = saved.rows[0]!.id;
    await pool.query(
      `insert into saved_scan_revisions
        (saved_scan_id, revision, rule_version, rule_ast, complexity_score, created_by)
       values ($1, 1, 1, '{}', 10, $2)`,
      [savedId, userId],
    );
    await expect(
      pool.query(
        `update saved_scan_revisions set complexity_score = 11 where saved_scan_id = $1`,
        [savedId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    await pool.query(
      `update saved_scans set status = 'deleted', deleted_at = now() where id = $1`,
      [savedId],
    );
    await expect(
      pool.query(`delete from saved_scans where id = $1`, [savedId]),
    ).rejects.toMatchObject({ code: '23503' });

    const category = await pool.query<{ id: string }>(
      `select id from scan_categories order by code limit 1`,
    );
    const preset = await pool.query<{ id: string }>(
      `insert into preset_scans (code, category_id, name)
       values ('immutable-preset', $1, 'Immutable Preset') returning id`,
      [category.rows[0]!.id],
    );
    const presetId = preset.rows[0]!.id;
    await pool.query(
      `insert into preset_scan_revisions
        (preset_scan_id, revision, rule_version, rule_ast, complexity_score,
         lifecycle_status, created_by, published_by, published_at)
       values ($1, 1, 1, '{}', 10, 'published', $2, $2, now())`,
      [presetId, userId],
    );
    await expect(
      pool.query(
        `insert into preset_scan_revisions
          (preset_scan_id, revision, rule_version, rule_ast, complexity_score,
           lifecycle_status, created_by, published_by, published_at)
         values ($1, 2, 1, '{}', 10, 'published', $2, $2, now())`,
        [presetId, userId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `delete from preset_scan_revisions where preset_scan_id = $1`,
        [presetId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces run, batch, result, tag and immutable snapshot guards', async () => {
    const userId = randomUUID();
    const saved = await pool.query<{ id: string }>(
      `insert into saved_scans (owner_user_id, name) values ($1, 'Guards') returning id`,
      [userId],
    );
    const savedId = saved.rows[0]!.id;
    await pool.query(
      `insert into saved_scan_tags (saved_scan_id, tag) values ($1, 'trend')`,
      [savedId],
    );
    await expect(
      pool.query(
        `insert into saved_scan_tags (saved_scan_id, tag) values ($1, 'trend')`,
        [savedId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const run = await pool.query<{ id: string }>(
      `insert into scan_runs
        (source_type, requested_by, idempotency_key_hash, request_hash,
         execution_mode, plan_version, rule_version, normalized_rule_ast,
         execution_plan, universe_snapshot, complexity_score, data_cutoff_at,
         progress_total)
       values ('ad_hoc', $1, 'key-hash', 'request-hash', 'async', 1, 1,
               '{}', '{}', '{}', 10, '2026-07-13T00:00:00Z', 1)
       returning id`,
      [userId],
    );
    const runId = run.rows[0]!.id;
    await expect(
      pool.query(
        `insert into scan_runs
          (source_type, requested_by, idempotency_key_hash, request_hash,
           execution_mode, plan_version, rule_version, normalized_rule_ast,
           execution_plan, universe_snapshot, complexity_score, data_cutoff_at)
         values ('ad_hoc', $1, 'key-hash', 'other-request', 'async', 1, 1,
                 '{}', '{}', '{}', 10, now())`,
        [userId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `update scan_runs set universe_snapshot = '{"changed":true}' where id = $1`,
        [runId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(`update scan_runs set progress_processed = 2 where id = $1`, [
        runId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });

    await pool.query(
      `insert into scan_run_batches
        (scan_run_id, batch_index, plan_version, instrument_ids)
       values ($1, 0, 1, '[]')`,
      [runId],
    );
    await expect(
      pool.query(
        `insert into scan_run_batches
          (scan_run_id, batch_index, plan_version, instrument_ids)
         values ($1, 0, 1, '[]')`,
        [runId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const instrument = await pool.query<{ id: string }>(
      `insert into instruments
        (symbol, normalized_symbol, name, market_code, currency_code, status)
       values ('SCAN1', 'SCAN1', 'Scanner Instrument', 'BIST', 'TRY', 'active')
       returning id`,
    );
    const resultValues = [runId, instrument.rows[0]!.id];
    const resultInsert = `insert into scan_results
      (scan_run_id, instrument_id, status, data_cutoff_at, source_batch_index)
      values ($1, $2, 'matched', '2026-07-13T00:00:00Z', 0)`;
    await pool.query(resultInsert, resultValues);
    await expect(pool.query(resultInsert, resultValues)).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('executes the documented destructive rollback and reapplies forward', async () => {
    const rollbackSql = await readFile(
      resolve(migrationFolder(), 'rollback/0002_scanner_runtime.down.sql'),
      'utf8',
    );
    await pool.query(rollbackSql);

    const rolledBack = await pool.query<{ table_name: string }>(
      `
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])
    `,
      [scannerTables],
    );
    expect(rolledBack.rows).toEqual([]);

    await pool.query(`
      delete from drizzle.__drizzle_migrations
      where created_at = (select max(created_at) from drizzle.__drizzle_migrations)
    `);
    await runMigrations(db);

    const reapplied = await pool.query<{ table_name: string }>(
      `
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])
      order by table_name
    `,
      [scannerTables],
    );
    expect(reapplied.rows.map(({ table_name }) => table_name)).toEqual(
      [...scannerTables].sort(),
    );
  });
});
