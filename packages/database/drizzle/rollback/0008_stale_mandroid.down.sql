-- Destructive rollback for TASK-063 strategy, backtest and experiment persistence.
-- Drizzle migrations remain forward-only. Stop writers, back up all eleven
-- tables, run this file in a transaction, and remove only the matching migration
-- journal row before an immediate controlled forward reapplication.
DROP TRIGGER IF EXISTS strategy_revisions_immutable ON strategy_revisions;
DROP FUNCTION IF EXISTS prevent_strategy_revision_mutation();

DROP TABLE IF EXISTS research_experiment_runs;
DROP TABLE IF EXISTS research_experiments;
DROP TABLE IF EXISTS backtest_trades;
DROP TABLE IF EXISTS backtest_fills;
DROP TABLE IF EXISTS backtest_orders;
DROP TABLE IF EXISTS backtest_series_chunks;
DROP TABLE IF EXISTS backtest_summaries;
DROP TABLE IF EXISTS backtest_runs;
DROP TABLE IF EXISTS backtest_data_snapshots;
DROP TABLE IF EXISTS strategy_revisions;
DROP TABLE IF EXISTS strategies;
