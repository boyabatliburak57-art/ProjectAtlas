import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../client';
import { migrationFolder, runMigrations } from '../migration';

function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl)
    throw new Error('TEST_DATABASE_URL is required for integration tests');
  if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test'))
    throw new Error('TEST_DATABASE_URL database name must end with _test');
  return databaseUrl;
}

const tables = [
  'strategies',
  'strategy_revisions',
  'backtest_runs',
  'backtest_data_snapshots',
  'backtest_summaries',
  'backtest_orders',
  'backtest_fills',
  'backtest_trades',
  'backtest_series_chunks',
  'research_experiments',
  'research_experiment_runs',
] as const;

describe('PostgreSQL strategy, backtest and experiment migration invariants', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  const ownerUserId = randomUUID();
  const otherUserId = randomUUID();
  let strategyId = '';
  let dataSnapshotId = '';
  let runId = '';
  let instrumentId = '';
  let orderId = '';
  let fillId = '';
  let experimentId = '';

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await runMigrations(db);

    strategyId = (
      await pool.query<{ id: string }>(
        `insert into strategies (owner_user_id, name)
         values ($1, 'Migration Fixture Strategy') returning id`,
        [ownerUserId],
      )
    ).rows[0]!.id;
    await pool.query(
      `insert into strategy_revisions
        (strategy_id, revision, schema_version, definition,
         validation_status, complexity_score, created_by)
       values ($1, 1, 1, '{"entryRule": {}}', 'valid', 10, $2)`,
      [strategyId, ownerUserId],
    );
    dataSnapshotId = await insertDataSnapshot('fixture-snapshot-hash');
    runId = await insertRun('fixture-idempotency', ownerUserId);
    instrumentId = (
      await pool.query<{ id: string }>(`
        insert into instruments
          (symbol, normalized_symbol, name, market_code, currency_code, status)
        values ('BTMIG', 'BTMIG', 'Backtest Migration Fixture', 'BIST', 'TRY', 'active')
        returning id
      `)
    ).rows[0]!.id;
    orderId = (
      await pool.query<{ id: string }>(
        `insert into backtest_orders
          (run_id, owner_user_id, instrument_id, order_sequence, event_at,
           side, order_type, status, requested_quantity)
         values ($1, $2, $3, 0, '2025-01-03T07:00:00Z',
                 'buy', 'market', 'filled', '10.0000000000')
         returning id`,
        [runId, ownerUserId, instrumentId],
      )
    ).rows[0]!.id;
    fillId = (
      await pool.query<{ id: string }>(
        `insert into backtest_fills
          (run_id, owner_user_id, order_id, instrument_id, fill_sequence,
           filled_at, quantity, raw_price, fill_price, commission,
           slippage_cost, deduplication_key)
         values ($1, $2, $3, $4, 0, '2025-01-03T07:00:00Z',
                 '10.0000000000', '100.0000000000', '100.1000000000',
                 '1.0010000000', '1.0000000000', 'fill-dedup-1')
         returning id`,
        [runId, ownerUserId, orderId, instrumentId],
      )
    ).rows[0]!.id;
    experimentId = (
      await pool.query<{ id: string }>(
        `insert into research_experiments
          (owner_user_id, strategy_id, strategy_revision, data_snapshot_id,
           name, experiment_hash, definition, combination_count)
         values ($1, $2, 1, $3, 'Grid Fixture', 'experiment-hash-1',
                 '{"method":"bounded_grid"}', 2)
         returning id`,
        [ownerUserId, strategyId, dataSnapshotId],
      )
    ).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('clean-migrates all eleven tables with timestamptz time columns', async () => {
    const migrated = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])
       order by table_name`,
      [tables],
    );
    expect(migrated.rows.map(({ table_name }) => table_name)).toEqual(
      [...tables].sort(),
    );

    const timeColumns = await pool.query<{ data_type: string }>(
      `select data_type from information_schema.columns
       where table_schema = 'public' and table_name = any($1::text[])
         and (column_name like '%\\_at' escape '\\'
           or column_name in ('range_from', 'range_to', 'range_start', 'range_end'))`,
      [tables],
    );
    expect(timeColumns.rows.length).toBeGreaterThan(0);
    expect(new Set(timeColumns.rows.map(({ data_type }) => data_type))).toEqual(
      new Set(['timestamp with time zone']),
    );
  });

  it('enforces unique and immutable strategy revisions', async () => {
    await expect(
      pool.query(
        `insert into strategy_revisions
          (strategy_id, revision, schema_version, definition,
           validation_status, complexity_score, created_by)
         values ($1, 1, 1, '{}', 'valid', 10, $2)`,
        [strategyId, ownerUserId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `update strategy_revisions set complexity_score = 11
         where strategy_id = $1 and revision = 1`,
        [strategyId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `delete from strategy_revisions
         where strategy_id = $1 and revision = 1`,
        [strategyId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects duplicate run idempotency keys for one requester', async () => {
    await expect(
      insertRun('fixture-idempotency', ownerUserId),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects duplicate data snapshot hashes', async () => {
    await expect(
      insertDataSnapshot('fixture-snapshot-hash'),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects duplicate fill deduplication keys', async () => {
    await expect(
      pool.query(
        `insert into backtest_fills
          (run_id, owner_user_id, order_id, instrument_id, fill_sequence,
           filled_at, quantity, raw_price, fill_price, deduplication_key)
         values ($1, $2, $3, $4, 1, '2025-01-03T07:00:00Z',
                 '1', '100', '100.1', 'fill-dedup-1')`,
        [runId, ownerUserId, orderId, instrumentId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects duplicate series chunks for a run and series type', async () => {
    const insert = `insert into backtest_series_chunks
      (run_id, owner_user_id, series_type, chunk_index, range_start,
       range_end, point_count, payload, checksum)
      values ($1, $2, 'equity', 0, '2025-01-01T00:00:00Z',
              '2025-01-31T00:00:00Z', 1, '[]', 'chunk-checksum')`;
    await pool.query(insert, [runId, ownerUserId]);
    await expect(
      pool.query(insert, [runId, ownerUserId]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects duplicate binding hashes inside one experiment', async () => {
    const insert = `insert into research_experiment_runs
      (experiment_id, owner_user_id, backtest_run_id, binding_hash,
       parameter_binding, combination_index, sample_role, status)
      values ($1, $2, $3, 'binding-hash-1', '{"period":20}', $4,
              'holdout', 'queued')`;
    await pool.query(insert, [experimentId, ownerUserId, runId, 0]);
    await expect(
      pool.query(insert, [experimentId, ownerUserId, runId, 1]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces ownership through composite foreign keys', async () => {
    await expect(
      pool.query(
        `insert into strategy_revisions
          (strategy_id, revision, schema_version, definition,
           validation_status, complexity_score, created_by)
         values ($1, 2, 1, '{}', 'valid', 10, $2)`,
        [strategyId, otherUserId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      insertRun('other-user-key', otherUserId),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query(
        `insert into backtest_summaries
          (run_id, owner_user_id, ending_equity, total_return,
           maximum_drawdown, turnover, exposure, total_fees,
           total_slippage, trade_count)
         values ($1, $2, '100000', '0', '0', '0', '0', '0', '0', 0)`,
        [runId, otherUserId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('uses numeric financial columns and rejects invalid values', async () => {
    const numericColumns = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `select table_name, column_name, data_type
       from information_schema.columns
       where table_schema = 'public' and table_name = any($1::text[])
         and column_name = any($2::text[])
       order by table_name, column_name`,
      [
        tables,
        [
          'initial_capital',
          'ending_equity',
          'requested_quantity',
          'quantity',
          'raw_price',
          'fill_price',
          'entry_price',
          'exit_price',
          'commission',
          'slippage_cost',
        ],
      ],
    );
    expect(numericColumns.rows.length).toBeGreaterThan(0);
    expect(
      new Set(numericColumns.rows.map(({ data_type }) => data_type)),
    ).toEqual(new Set(['numeric']));

    await expect(
      pool.query(
        `insert into backtest_trades
          (run_id, owner_user_id, instrument_id, trade_sequence,
           entry_fill_id, exit_fill_id, opened_at, closed_at, quantity,
           entry_price, exit_price, gross_pnl, net_pnl, total_cost,
           return_rate, holding_bars, close_reason)
         values ($1, $2, $3, 0, $4, $4, '2025-01-03T07:00:00Z',
                 '2025-01-04T07:00:00Z', 'NaN', '100', '101', '10',
                 '8', '2', '0.01', 1, 'fixture')`,
        [runId, ownerUserId, instrumentId, fillId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('executes the documented rollback and reapplies the forward migration', async () => {
    const rollbackSql = await readFile(
      resolve(migrationFolder(), 'rollback/0008_stale_mandroid.down.sql'),
      'utf8',
    );
    await pool.query(rollbackSql);
    const rolledBack = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])`,
      [tables],
    );
    expect(rolledBack.rows).toEqual([]);

    await pool.query(`
      delete from drizzle.__drizzle_migrations
      where created_at = (
        select max(created_at) from drizzle.__drizzle_migrations
      )
    `);
    await runMigrations(db);

    const reapplied = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])
       order by table_name`,
      [tables],
    );
    expect(reapplied.rows.map(({ table_name }) => table_name)).toEqual(
      [...tables].sort(),
    );
  });

  async function insertDataSnapshot(snapshotHash: string): Promise<string> {
    return (
      await pool.query<{ id: string }>(
        `insert into backtest_data_snapshots
          (snapshot_hash, schema_version, market_revision_hash,
           universe_revision_hash, fundamental_revision_hash,
           corporate_action_revision_hash, data_cutoff_at, coverage_status)
         values ($1, 1, 'market-rev-1', 'universe-rev-1',
                 'fundamental-rev-1', 'corporate-action-rev-1',
                 '2025-12-31T21:00:00Z', 'complete')
         returning id`,
        [snapshotHash],
      )
    ).rows[0]!.id;
  }

  async function insertRun(
    idempotencyKeyHash: string,
    requestedBy: string,
  ): Promise<string> {
    return (
      await pool.query<{ id: string }>(
        `insert into backtest_runs
          (strategy_id, strategy_revision, requested_by, request_hash,
           idempotency_key_hash, engine_version, execution_policy_version,
           cost_policy_version, metric_policy_version,
           event_ordering_policy_version, rounding_policy_version,
           data_snapshot_id, universe_snapshot, timeframe, adjustment_mode,
           range_from, range_to, initial_capital)
         values ($1, 1, $2, $3, $4, 'engine-v1', 'next-open-v1',
                 'cost-v1', 'metrics-v1', 'event-order-v1', 'decimal-v1',
                 $5, '{"version":"universe-v1"}', '1d', 'raw',
                 '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z',
                 '100000.0000000000')
         returning id`,
        [
          strategyId,
          requestedBy,
          `request-${idempotencyKeyHash}`,
          idempotencyKeyHash,
          dataSnapshotId,
        ],
      )
    ).rows[0]!.id;
  }
});
