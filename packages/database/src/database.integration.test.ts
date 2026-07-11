import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from './client';
import { runMigrations } from './migration';
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

describe('initial PostgreSQL migration', () => {
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

  it('creates exactly the eight domain tables', async () => {
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
      'price_bars',
      'provider_instrument_mappings',
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
  });
});
