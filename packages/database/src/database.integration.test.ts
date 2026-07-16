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

const alertsWatchlistsNotificationTables = [
  'alert_evaluations',
  'alert_revisions',
  'alert_states',
  'alert_triggers',
  'alerts',
  'notification_deliveries',
  'notification_outbox',
  'notification_preferences',
  'notifications',
  'watchlist_item_tags',
  'watchlist_items',
  'watchlists',
] as const;

const portfolioTables = [
  'portfolio_cash_balances',
  'portfolio_import_jobs',
  'portfolio_import_rows',
  'portfolio_performance_snapshots',
  'portfolio_position_snapshots',
  'portfolio_positions',
  'portfolio_risk_exposures',
  'portfolio_risk_snapshots',
  'portfolio_transactions',
  'portfolio_valuation_snapshots',
  'portfolios',
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

  it('clean-migrates exactly the forty-one domain tables', async () => {
    const result = await pool.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);

    expect(result.rows.map((row) => row.table_name)).toEqual([
      'alert_evaluations',
      'alert_revisions',
      'alert_states',
      'alert_triggers',
      'alerts',
      'data_providers',
      'data_quality_issues',
      'ingestion_runs',
      'instrument_symbol_history',
      'instruments',
      'notification_deliveries',
      'notification_outbox',
      'notification_preferences',
      'notifications',
      'portfolio_cash_balances',
      'portfolio_import_jobs',
      'portfolio_import_rows',
      'portfolio_performance_snapshots',
      'portfolio_position_snapshots',
      'portfolio_positions',
      'portfolio_risk_exposures',
      'portfolio_risk_snapshots',
      'portfolio_transactions',
      'portfolio_valuation_snapshots',
      'portfolios',
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
      'watchlist_item_tags',
      'watchlist_items',
      'watchlists',
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

  it('enforces watchlist ownership indexes, foreign keys and uniqueness', async () => {
    const ownerUserId = randomUUID();
    const watchlist = await pool.query<{ id: string }>(
      `insert into watchlists (owner_user_id, name)
       values ($1, 'BIST Leaders') returning id`,
      [ownerUserId],
    );
    const instrument = await pool.query<{ id: string }>(`
      insert into instruments
        (symbol, normalized_symbol, name, market_code, currency_code, status)
      values ('WLIST1', 'WLIST1', 'Watchlist Instrument', 'BIST', 'TRY', 'active')
      returning id
    `);
    const values = [watchlist.rows[0]!.id, instrument.rows[0]!.id];
    const item = await pool.query<{ id: string }>(
      `insert into watchlist_items (watchlist_id, instrument_id, sort_order)
       values ($1, $2, 0) returning id`,
      values,
    );

    await expect(
      pool.query(
        `insert into watchlist_items (watchlist_id, instrument_id)
         values ($1, $2)`,
        values,
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `insert into watchlist_items (watchlist_id, instrument_id)
         values ($1, $2)`,
        [randomUUID(), instrument.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    await pool.query(
      `insert into watchlist_item_tags (watchlist_item_id, tag)
       values ($1, 'momentum')`,
      [item.rows[0]!.id],
    );
    await expect(
      pool.query(
        `insert into watchlist_item_tags (watchlist_item_id, tag)
         values ($1, 'momentum')`,
        [item.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    const indexes = await pool.query<{ indexname: string }>(`
      select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'watchlists_owner_status_updated_idx',
          'watchlist_items_watchlist_instrument_unique'
        )
      order by indexname
    `);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      'watchlist_items_watchlist_instrument_unique',
      'watchlists_owner_status_updated_idx',
    ]);
  });

  it('keeps alert revisions immutable and deduplicates evaluations and triggers', async () => {
    const ownerUserId = randomUUID();
    const savedScan = await pool.query<{ id: string }>(
      `insert into saved_scans (owner_user_id, name)
       values ($1, 'Alert Source') returning id`,
      [ownerUserId],
    );
    const savedScanId = savedScan.rows[0]!.id;
    await pool.query(
      `insert into saved_scan_revisions
        (saved_scan_id, revision, rule_version, rule_ast, created_by)
       values ($1, 1, 1, '{}', $2)`,
      [savedScanId, ownerUserId],
    );
    const alert = await pool.query<{ id: string }>(
      `insert into alerts (owner_user_id, name, current_revision)
       values ($1, 'New Match', 1) returning id`,
      [ownerUserId],
    );
    const alertId = alert.rows[0]!.id;
    const revisionInsert = `insert into alert_revisions
      (alert_id, revision, source_type, saved_scan_id, saved_scan_revision,
       trigger_policy, repeat_policy, channels, created_by)
      values ($1, 1, 'saved_scan', $2, 1, 'newMatch', 'everyNewMatch',
              '["in_app"]', $3)`;
    await pool.query(revisionInsert, [alertId, savedScanId, ownerUserId]);

    await expect(
      pool.query(
        `update alert_revisions set repeat_policy = 'once'
         where alert_id = $1 and revision = 1`,
        [alertId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `delete from alert_revisions
         where alert_id = $1 and revision = 1`,
        [alertId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `insert into alert_revisions
          (alert_id, revision, source_type, saved_scan_id, saved_scan_revision,
           trigger_policy, repeat_policy, created_by)
         values ($1, 2, 'saved_scan', $2, 1, 'newMatch', 'everyNewMatch', $3)`,
        [alertId, randomUUID(), ownerUserId],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const evaluationInsert = `insert into alert_evaluations
      (alert_id, alert_revision, source_event_id, data_cutoff_at, status)
      values ($1, 1, 'scan-run:1', '2026-07-15T16:00:00Z', 'matched')
      returning id`;
    const evaluation = await pool.query<{ id: number }>(evaluationInsert, [
      alertId,
    ]);
    await expect(pool.query(evaluationInsert, [alertId])).rejects.toMatchObject(
      { code: '23505' },
    );

    const triggerInsert = `insert into alert_triggers
      (alert_id, alert_revision, evaluation_id, trigger_type, deduplication_key)
      values ($1, 1, $2, 'newMatch', 'alert:1:revision:1:event:1')`;
    await pool.query(triggerInsert, [alertId, evaluation.rows[0]!.id]);
    await expect(
      pool.query(triggerInsert, [alertId, evaluation.rows[0]!.id]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('enforces notification delivery and outbox idempotency with required indexes', async () => {
    const userId = randomUUID();
    const notification = await pool.query<{ id: string }>(
      `insert into notifications
        (user_id, type, title, body, occurred_at)
       values ($1, 'systemAnnouncement', 'Maintenance', 'Planned', now())
       returning id`,
      [userId],
    );
    const notificationId = notification.rows[0]!.id;
    const deliveryInsert = `insert into notification_deliveries
      (notification_id, user_id, channel, idempotency_key, template_code,
       template_version, locale)
      values ($1, $2, 'email', 'notification:maintenance:email',
              'system-announcement', 1, 'tr-TR')
      returning id`;
    const delivery = await pool.query<{ id: string }>(deliveryInsert, [
      notificationId,
      userId,
    ]);
    await expect(
      pool.query(deliveryInsert, [notificationId, userId]),
    ).rejects.toMatchObject({ code: '23505' });

    const outboxInsert = `insert into notification_outbox (delivery_id)
      values ($1)`;
    await pool.query(outboxInsert, [delivery.rows[0]!.id]);
    await expect(
      pool.query(outboxInsert, [delivery.rows[0]!.id]),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        `insert into notification_deliveries
          (notification_id, user_id, channel, idempotency_key, template_code,
           template_version, locale)
         values ($1, $2, 'email', 'notification:missing:email',
                 'system-announcement', 1, 'tr-TR')`,
        [notificationId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const indexes = await pool.query<{ indexname: string }>(`
      select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'alerts_owner_status_updated_idx',
          'notifications_user_read_occurred_idx',
          'notification_deliveries_channel_idempotency_unique',
          'notification_outbox_status_available_idx'
        )
      order by indexname
    `);
    expect(indexes.rows.map(({ indexname }) => indexname)).toEqual([
      'alerts_owner_status_updated_idx',
      'notification_deliveries_channel_idempotency_unique',
      'notification_outbox_status_available_idx',
      'notifications_user_read_occurred_idx',
    ]);
  });

  it('enforces portfolio ownership, transaction idempotency and same-portfolio reversals', async () => {
    const ownerUserId = randomUUID();
    const otherUserId = randomUUID();
    const portfolio = await pool.query<{ id: string }>(
      `insert into portfolios (user_id, name)
       values ($1, 'Ledger Portfolio') returning id`,
      [ownerUserId],
    );
    const otherPortfolio = await pool.query<{ id: string }>(
      `insert into portfolios (user_id, name)
       values ($1, 'Other Portfolio') returning id`,
      [otherUserId],
    );
    const instrument = await pool.query<{ id: string }>(`
      insert into instruments
        (symbol, normalized_symbol, name, market_code, currency_code, status)
      values ('PORT1', 'PORT1', 'Portfolio Instrument', 'BIST', 'TRY', 'active')
      returning id
    `);
    const portfolioId = portfolio.rows[0]!.id;
    const instrumentId = instrument.rows[0]!.id;
    const transactionInsert = `insert into portfolio_transactions
      (portfolio_id, instrument_id, type, status, trade_at, quantity,
       unit_price, fee, tax, source, external_reference,
       idempotency_key_hash, normalized_transaction_hash, created_by, posted_at)
      values ($1, $2, 'buy', 'posted', '2026-07-15T10:00:00Z', '10.5',
              '100.25', '1.25', '0', 'manual', 'broker-1',
              'idempotency-1', 'normalized-1', $3, '2026-07-15T10:01:00Z')
      returning id`;
    const transaction = await pool.query<{ id: string }>(transactionInsert, [
      portfolioId,
      instrumentId,
      ownerUserId,
    ]);
    const transactionId = transaction.rows[0]!.id;

    await expect(
      pool.query(
        `insert into portfolio_transactions
          (portfolio_id, type, trade_at, source, idempotency_key_hash,
           normalized_transaction_hash, created_by)
         values ($1, 'cashDeposit', now(), 'manual', 'missing-portfolio',
                 'missing-portfolio', $2)`,
        [randomUUID(), ownerUserId],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    await expect(
      pool.query(
        `insert into portfolio_transactions
          (portfolio_id, instrument_id, type, status, trade_at, quantity,
           unit_price, source, idempotency_key_hash,
           normalized_transaction_hash, created_by, posted_at)
         values ($1, $2, 'buy', 'posted', '2026-07-15T11:00:00Z', '1',
                 '101', 'manual', 'idempotency-1', 'normalized-other', $3, now())`,
        [portfolioId, instrumentId, ownerUserId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      pool.query(
        `insert into portfolio_transactions
          (portfolio_id, instrument_id, type, status, trade_at, quantity,
           unit_price, source, external_reference, idempotency_key_hash,
           normalized_transaction_hash, created_by, posted_at)
         values ($1, $2, 'buy', 'posted', '2026-07-15T11:00:00Z', '1',
                 '101', 'manual', 'broker-1', 'idempotency-other',
                 'normalized-1', $3, now())`,
        [portfolioId, instrumentId, ownerUserId],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      pool.query(
        `insert into portfolio_transactions
          (portfolio_id, reversal_of_transaction_id, type, status, trade_at,
           quantity, unit_price, source, idempotency_key_hash,
           normalized_transaction_hash, created_by, posted_at)
         values ($1, $2, 'buy', 'posted', now(), '10.5', '100.25', 'system',
                 'cross-reversal', 'cross-reversal', $3, now())`,
        [otherPortfolio.rows[0]!.id, transactionId, otherUserId],
      ),
    ).rejects.toMatchObject({ code: '23503' });

    const reversalInsert = `insert into portfolio_transactions
      (portfolio_id, instrument_id, reversal_of_transaction_id, type, status,
       trade_at, quantity, unit_price, fee, tax, source,
       idempotency_key_hash, normalized_transaction_hash, created_by, posted_at)
      values ($1, $2, $3, 'buy', 'posted', '2026-07-15T12:00:00Z', '10.5',
              '100.25', '1.25', '0', 'system', 'reversal-1',
              'reversal-normalized-1', $4, '2026-07-15T12:01:00Z')`;
    await pool.query(reversalInsert, [
      portfolioId,
      instrumentId,
      transactionId,
      ownerUserId,
    ]);
    await expect(
      pool.query(reversalInsert, [
        portfolioId,
        instrumentId,
        transactionId,
        ownerUserId,
      ]),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      pool.query(
        `update portfolio_transactions set note = 'mutated' where id = $1`,
        [transactionId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await pool.query(
      `update portfolio_transactions
       set status = 'reversed', reversed_at = now(), updated_at = now()
       where id = $1`,
      [transactionId],
    );
    await expect(
      pool.query(`delete from portfolio_transactions where id = $1`, [
        transactionId,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects duplicate positions and invalid or overflowing numeric values', async () => {
    const ownerUserId = randomUUID();
    await expect(
      pool.query(
        `insert into portfolios (user_id, name, reporting_currency)
         values ($1, 'Unsupported Currency', 'USD')`,
        [ownerUserId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    const portfolio = await pool.query<{ id: string }>(
      `insert into portfolios (user_id, name)
       values ($1, 'Numeric Portfolio') returning id`,
      [ownerUserId],
    );
    const instrument = await pool.query<{ id: string }>(`
      insert into instruments
        (symbol, normalized_symbol, name, market_code, currency_code, status)
      values ('PORT2', 'PORT2', 'Numeric Instrument', 'BIST', 'TRY', 'active')
      returning id
    `);
    const values = [portfolio.rows[0]!.id, instrument.rows[0]!.id];
    const positionInsert = `insert into portfolio_positions
      (portfolio_id, instrument_id, quantity, average_cost, cost_basis,
       projection_ledger_version, calculated_at)
      values ($1, $2, '5.1234567890', '10.1234567890', '51.2654320927', 1, now())`;
    await pool.query(positionInsert, values);
    await expect(pool.query(positionInsert, values)).rejects.toMatchObject({
      code: '23505',
    });

    await expect(
      pool.query(
        `insert into portfolio_cash_balances
          (portfolio_id, currency_code, balance, projection_ledger_version,
           calculated_at)
         values ($1, 'TRY', 'not-a-decimal', 1, now())`,
        [portfolio.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: '22P02' });
    await expect(
      pool.query(
        `insert into portfolio_cash_balances
          (portfolio_id, currency_code, balance, projection_ledger_version,
           calculated_at)
         values ($1, 'TRY', 'NaN', 1, now())`,
        [portfolio.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `insert into portfolio_cash_balances
          (portfolio_id, currency_code, balance, projection_ledger_version,
           calculated_at)
         values ($1, 'TRY', '1000000000000000000', 1, now())`,
        [portfolio.rows[0]!.id],
      ),
    ).rejects.toMatchObject({ code: '22003' });
  });

  it('enforces ledger and policy versions in snapshot identities', async () => {
    const ownerUserId = randomUUID();
    const portfolio = await pool.query<{ id: string }>(
      `insert into portfolios (user_id, name)
       values ($1, 'Snapshot Portfolio') returning id`,
      [ownerUserId],
    );
    const portfolioId = portfolio.rows[0]!.id;
    const valuationInsert = `insert into portfolio_valuation_snapshots
      (portfolio_id, ledger_version, valuation_at, data_cutoff_at,
       price_policy_version, status, cash_balance, positions_market_value,
       total_value, realized_pnl, unrealized_pnl)
      values ($1, 3, '2026-07-16T18:00:00Z', '2026-07-16T15:00:00Z',
              'close-v1', 'complete', '100', '250', '350', '10', '20')`;
    await pool.query(valuationInsert, [portfolioId]);
    await expect(
      pool.query(valuationInsert, [portfolioId]),
    ).rejects.toMatchObject({ code: '23505' });

    const performanceInsert = `insert into portfolio_performance_snapshots
      (portfolio_id, ledger_version, range_start_at, range_end_at,
       data_cutoff_at, performance_policy_version, benchmark_code, status,
       twr, xirr, net_contribution, start_value, end_value, observation_count)
      values ($1, 3, '2026-01-01T00:00:00Z', '2026-07-16T00:00:00Z',
              '2026-07-16T15:00:00Z', 'returns-v1', 'XU100', 'complete',
              '0.10', '0.08', '100', '1000', '1200', 140)`;
    await pool.query(performanceInsert, [portfolioId]);
    await expect(
      pool.query(performanceInsert, [portfolioId]),
    ).rejects.toMatchObject({ code: '23505' });

    const riskInsert = `insert into portfolio_risk_snapshots
      (portfolio_id, ledger_version, valuation_series_version,
       range_start_at, range_end_at, data_cutoff_at, benchmark_code,
       risk_policy_version, status, observation_count, volatility,
       historical_var_95)
      values ($1, 3, 2, '2026-01-01T00:00:00Z', '2026-07-16T00:00:00Z',
              '2026-07-16T15:00:00Z', 'XU100', 'risk-v1', 'complete', 140,
              '0.20', '0.03')`;
    await pool.query(riskInsert, [portfolioId]);
    await expect(pool.query(riskInsert, [portfolioId])).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('enforces import job and row ownership with duplicate analysis fields', async () => {
    const ownerUserId = randomUUID();
    const otherUserId = randomUUID();
    const portfolio = await pool.query<{ id: string }>(
      `insert into portfolios (user_id, name)
       values ($1, 'Import Portfolio') returning id`,
      [ownerUserId],
    );
    const portfolioId = portfolio.rows[0]!.id;
    const jobInsert = `insert into portfolio_import_jobs
      (portfolio_id, user_id, status, source_filename, file_hash,
       idempotency_key_hash, total_row_count, valid_row_count)
      values ($1, $2, 'preview_ready', 'transactions.csv', 'file-hash-1',
              'import-key-1', 1, 1)
      returning id`;

    await expect(
      pool.query(jobInsert, [portfolioId, otherUserId]),
    ).rejects.toMatchObject({ code: '23503' });
    const job = await pool.query<{ id: string }>(jobInsert, [
      portfolioId,
      ownerUserId,
    ]);
    await expect(
      pool.query(jobInsert, [portfolioId, ownerUserId]),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      pool.query(
        `insert into portfolio_import_rows
          (import_job_id, portfolio_id, user_id, row_number, status,
           normalized_transaction_hash)
         values ($1, $2, $3, 1, 'valid', 'row-hash-1')`,
        [job.rows[0]!.id, portfolioId, otherUserId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await pool.query(
      `insert into portfolio_import_rows
        (import_job_id, portfolio_id, user_id, row_number, status,
         normalized_transaction_hash)
       values ($1, $2, $3, 1, 'valid', 'row-hash-1')`,
      [job.rows[0]!.id, portfolioId, ownerUserId],
    );
    await expect(
      pool.query(
        `insert into portfolio_import_rows
          (import_job_id, portfolio_id, user_id, row_number, status,
           normalized_transaction_hash)
         values ($1, $2, $3, 1, 'valid', 'row-hash-1')`,
        [job.rows[0]!.id, portfolioId, ownerUserId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('uses timestamptz for every portfolio time column', async () => {
    const result = await pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(
      `select table_name, column_name, data_type
       from information_schema.columns
       where table_schema = 'public'
         and table_name = any($1::text[])
         and (column_name like '%\\_at' escape '\\' or column_name like '%\\_time' escape '\\')
       order by table_name, column_name`,
      [portfolioTables],
    );

    expect(result.rows.length).toBeGreaterThan(0);
    expect(new Set(result.rows.map(({ data_type }) => data_type))).toEqual(
      new Set(['timestamp with time zone']),
    );
  });

  it('executes the documented destructive rollback and reapplies forward', async () => {
    const valuationRollbackSql = await readFile(
      resolve(migrationFolder(), 'rollback/0005_serious_corsair.down.sql'),
      'utf8',
    );
    await pool.query(valuationRollbackSql);

    const portfolioRollbackSql = await readFile(
      resolve(
        migrationFolder(),
        'rollback/0004_portfolio_transactions_risk.down.sql',
      ),
      'utf8',
    );
    await pool.query(portfolioRollbackSql);

    const portfoliosRolledBack = await pool.query<{ table_name: string }>(
      `
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])
    `,
      [portfolioTables],
    );
    expect(portfoliosRolledBack.rows).toEqual([]);

    const alertsRollbackSql = await readFile(
      resolve(
        migrationFolder(),
        'rollback/0003_alerts_watchlists_notifications.down.sql',
      ),
      'utf8',
    );
    await pool.query(alertsRollbackSql);

    const alertsRolledBack = await pool.query<{ table_name: string }>(
      `
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])
    `,
      [alertsWatchlistsNotificationTables],
    );
    expect(alertsRolledBack.rows).toEqual([]);

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
      where created_at in (
        select created_at from drizzle.__drizzle_migrations
        order by created_at desc
        limit 4
      )
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

    const alertsReapplied = await pool.query<{ table_name: string }>(
      `
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])
      order by table_name
    `,
      [alertsWatchlistsNotificationTables],
    );
    expect(alertsReapplied.rows.map(({ table_name }) => table_name)).toEqual(
      [...alertsWatchlistsNotificationTables].sort(),
    );

    const portfoliosReapplied = await pool.query<{ table_name: string }>(
      `
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])
      order by table_name
    `,
      [portfolioTables],
    );
    expect(
      portfoliosReapplied.rows.map(({ table_name }) => table_name),
    ).toEqual([...portfolioTables].sort());
  });
});
