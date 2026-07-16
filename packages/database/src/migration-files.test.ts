import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { migrationFolder } from './migration';

function migrationSql(): string {
  return readdirSync(migrationFolder())
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => readFileSync(`${migrationFolder()}/${file}`, 'utf8'))
    .join('\n');
}

describe('generated PostgreSQL migrations', () => {
  const sql = migrationSql();

  it('creates the forty-one scoped tables and current revision view', () => {
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(41);
    expect(sql).toContain('CREATE VIEW "public"."current_price_bars"');
  });

  it('contains required financial and integrity constraints', () => {
    expect(sql).toContain('timestamp with time zone');
    expect(sql).toContain('"open" numeric NOT NULL');
    expect(sql).toContain('FOREIGN KEY');
    expect(sql).toContain('price_bars_natural_revision_unique');
    expect(sql).toContain('price_bars_ohlc_check');
  });

  it('does not introduce TimescaleDB or partitioning', () => {
    expect(sql.toLowerCase()).not.toContain('timescaledb');
    expect(sql.toLowerCase()).not.toContain('partition by');
  });

  it('contains scanner runtime immutability and idempotency guards', () => {
    expect(sql).toContain('prevent_scanner_revision_mutation');
    expect(sql).toContain('scan_runs_identity_immutable');
    expect(sql).toContain('scan_runs_requester_idempotency_unique');
    expect(sql).toContain('scan_results_run_instrument_unique');
    expect(sql).toContain('scan_run_batches_run_batch_unique');
    expect(sql).toContain('preset_scan_revisions_one_published_unique');
  });

  it('contains alert, watchlist and notification integrity guards', () => {
    for (const table of [
      'watchlists',
      'watchlist_items',
      'watchlist_item_tags',
      'alerts',
      'alert_revisions',
      'alert_evaluations',
      'alert_states',
      'alert_triggers',
      'notifications',
      'notification_preferences',
      'notification_deliveries',
      'notification_outbox',
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }

    expect(sql).toContain('watchlist_items_watchlist_instrument_unique');
    expect(sql).toContain('alert_evaluations_identity_unique');
    expect(sql).toContain('alert_triggers_deduplication_key_unique');
    expect(sql).toContain('notification_deliveries_channel_idempotency_unique');
    expect(sql).toContain('notifications_user_read_occurred_idx');
    expect(sql).toContain('notification_outbox_status_available_idx');
    expect(sql).toContain('prevent_alert_revision_mutation');
  });

  it('contains portfolio numeric, ownership, reversal and snapshot guards', () => {
    for (const table of [
      'portfolios',
      'portfolio_transactions',
      'portfolio_positions',
      'portfolio_cash_balances',
      'portfolio_valuation_snapshots',
      'portfolio_position_snapshots',
      'portfolio_performance_snapshots',
      'portfolio_risk_snapshots',
      'portfolio_risk_exposures',
      'portfolio_import_jobs',
      'portfolio_import_rows',
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }

    expect(sql).toContain('numeric(28, 10)');
    expect(sql).toContain('numeric(20, 12)');
    expect(sql).toContain('"portfolios"."reporting_currency" = \'TRY\'');
    expect(sql).not.toMatch(/\b(real|double precision)\b/i);
    expect(sql).toContain(
      'portfolio_transactions_portfolio_source_idempotency_unique',
    );
    expect(sql).toContain('portfolio_transactions_external_normalized_unique');
    expect(sql).toContain(
      'portfolio_transactions_corporate_action_identity_unique',
    );
    expect(sql).toContain('"net_contributions" numeric(28, 10)');
    expect(sql).toContain('portfolio_transactions_reversal_same_portfolio_fk');
    expect(sql).toContain('portfolio_positions_portfolio_instrument_unique');
    expect(sql).toContain('portfolio_valuation_snapshots_identity_unique');
    expect(sql).toContain('portfolio_performance_snapshots_identity_unique');
    expect(sql).toContain('portfolio_risk_snapshots_identity_unique');
    expect(sql).toContain('portfolio_import_jobs_portfolio_owner_fk');
    expect(sql).toContain('portfolio_import_rows_job_owner_fk');
    expect(sql).toContain('prevent_finalized_portfolio_transaction_mutation');
  });
});
