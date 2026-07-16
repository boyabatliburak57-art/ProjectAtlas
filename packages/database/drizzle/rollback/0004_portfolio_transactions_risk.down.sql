-- DESTRUCTIVE MANUAL ROLLBACK for 0004_portfolio_transactions_risk.sql.
-- Portfolio ledger, projection, valuation, performance, risk and import data must be backed up.
-- Drizzle migrations remain forward-only; after this rollback remove only the matching
-- migration journal row before reapplying forward.

BEGIN;

DROP TABLE IF EXISTS portfolio_risk_exposures;
DROP TABLE IF EXISTS portfolio_risk_snapshots;
DROP TABLE IF EXISTS portfolio_performance_snapshots;
DROP TABLE IF EXISTS portfolio_position_snapshots;
DROP TABLE IF EXISTS portfolio_valuation_snapshots;
DROP TABLE IF EXISTS portfolio_import_rows;
DROP TABLE IF EXISTS portfolio_import_jobs;
DROP TABLE IF EXISTS portfolio_cash_balances;
DROP TABLE IF EXISTS portfolio_positions;
DROP TABLE IF EXISTS portfolio_transactions;
DROP TABLE IF EXISTS portfolios;
DROP FUNCTION IF EXISTS prevent_finalized_portfolio_transaction_mutation();

COMMIT;
