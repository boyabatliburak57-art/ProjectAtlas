-- Destructive rollback for TASK-053 Market Intelligence persistence.
-- Drizzle migrations remain forward-only. Stop API/worker writes, back up the
-- eight tables, run this file in a transaction, and remove only the matching
-- migration journal row before an immediate controlled forward reapplication.
DROP TRIGGER IF EXISTS fundamental_statement_snapshots_immutable
  ON fundamental_statement_snapshots;
DROP FUNCTION IF EXISTS prevent_fundamental_statement_snapshot_mutation();

DROP TABLE IF EXISTS pattern_instances;
DROP TABLE IF EXISTS pattern_definitions;
DROP TABLE IF EXISTS fundamental_ratio_snapshots;
DROP TABLE IF EXISTS fundamental_metric_snapshots;
DROP TABLE IF EXISTS fundamental_statement_snapshots;
DROP TABLE IF EXISTS market_rank_snapshots;
DROP TABLE IF EXISTS sector_market_snapshots;
DROP TABLE IF EXISTS market_overview_snapshots;
