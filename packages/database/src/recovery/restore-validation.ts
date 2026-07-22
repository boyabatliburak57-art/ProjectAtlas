import type { Pool } from 'pg';

export interface RestoreValidationSummary {
  readonly businessInvariantFailures: number;
  readonly duplicateFillFailures: number;
  readonly duplicateResultFailures: number;
  readonly featureFlagCount: number;
  readonly foreignKeyFailures: number;
  readonly migrationCount: number;
  readonly operationalAuditCount: number;
  readonly ownershipFailures: number;
  readonly portfolioProjectionFailures: number;
  readonly rowCounts: Readonly<Record<string, number>>;
  readonly terminalStateFailures: number;
}

export async function validateRestoredDatabase(
  pool: Pool,
): Promise<RestoreValidationSummary> {
  const rowCountResult = await pool.query<{
    estimated_count: string;
    table_name: string;
  }>(
    `select c.relname as table_name, c.reltuples::bigint::text as estimated_count
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname`,
  );
  const rowCounts = Object.fromEntries(
    await Promise.all(
      rowCountResult.rows.map(async ({ table_name: tableName }) => {
        const safeName = `"${tableName.replaceAll('"', '""')}"`;
        const count = await pool.query<{ count: string }>(
          `select count(*)::text as count from ${safeName}`,
        );
        return [tableName, Number(count.rows[0]!.count)] as const;
      }),
    ),
  );

  const values = await Promise.all([
    scalar(
      pool,
      `select count(*) from pg_constraint c
       join pg_namespace n on n.oid = c.connamespace
       where n.nspname = 'public' and c.contype = 'f' and not c.convalidated`,
    ),
    scalar(
      pool,
      `select count(*) from scan_results r left join scan_runs s on s.id = r.scan_run_id
       where s.id is null`,
    ),
    scalar(
      pool,
      `select count(*) from backtest_fills f join backtest_runs r on r.id = f.run_id
       where f.owner_user_id <> r.requested_by`,
    ),
    scalar(
      pool,
      `select count(*) from portfolio_import_rows r
       join portfolio_import_jobs j on j.id = r.import_job_id
       where r.user_id <> j.user_id or r.portfolio_id <> j.portfolio_id`,
    ),
    scalar(
      pool,
      `select count(*) from scan_runs
       where (status = 'completed' and completed_at is null)
          or (status = 'cancelled' and cancelled_at is null)`,
    ),
    scalar(
      pool,
      `select count(*) from backtest_runs
       where (status = 'completed' and completed_at is null)
          or (status = 'cancelled' and cancelled_at is null)`,
    ),
    scalar(
      pool,
      `select count(*) from (
         select scan_run_id, instrument_id from scan_results
         group by scan_run_id, instrument_id having count(*) > 1
       ) duplicate_results`,
    ),
    scalar(
      pool,
      `select count(*) from (
         select deduplication_key from backtest_fills
         group by deduplication_key having count(*) > 1
       ) duplicate_fills`,
    ),
    scalar(
      pool,
      `select count(*) from portfolio_positions pp
       join portfolios p on p.id = pp.portfolio_id
       where pp.projection_ledger_version <> p.ledger_version`,
    ),
    scalar(
      pool,
      `select count(*) from portfolio_cash_balances cb
       join portfolios p on p.id = cb.portfolio_id
       where cb.projection_ledger_version <> p.ledger_version`,
    ),
    scalar(pool, 'select count(*) from feature_flags'),
    scalar(pool, 'select count(*) from operational_audit_events'),
    scalar(pool, 'select count(*) from drizzle.__drizzle_migrations'),
  ]);
  const [
    foreignKeyFailures,
    scanOwnershipFailures,
    fillOwnershipFailures,
    importOwnershipFailures,
    scanTerminalFailures,
    backtestTerminalFailures,
    duplicateResultFailures,
    duplicateFillFailures,
    positionProjectionFailures,
    cashProjectionFailures,
    featureFlagCount,
    operationalAuditCount,
    migrationCount,
  ] = values;
  const ownershipFailures =
    scanOwnershipFailures + fillOwnershipFailures + importOwnershipFailures;
  const terminalStateFailures = scanTerminalFailures + backtestTerminalFailures;
  const portfolioProjectionFailures =
    positionProjectionFailures + cashProjectionFailures;
  const businessInvariantFailures =
    foreignKeyFailures +
    ownershipFailures +
    terminalStateFailures +
    duplicateResultFailures +
    duplicateFillFailures +
    portfolioProjectionFailures;
  return {
    businessInvariantFailures,
    duplicateFillFailures,
    duplicateResultFailures,
    featureFlagCount,
    foreignKeyFailures,
    migrationCount,
    operationalAuditCount,
    ownershipFailures,
    portfolioProjectionFailures,
    rowCounts,
    terminalStateFailures,
  };
}

async function scalar(pool: Pool, statement: string): Promise<number> {
  const result = await pool.query<{ count: string }>(statement);
  return Number(result.rows[0]!.count);
}
