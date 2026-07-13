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

  it('creates the eighteen scoped tables and current revision view', () => {
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(18);
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
});
