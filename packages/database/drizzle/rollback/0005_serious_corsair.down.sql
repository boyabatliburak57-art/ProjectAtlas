DROP INDEX IF EXISTS "portfolio_transactions_corporate_action_identity_unique";
ALTER TABLE "portfolio_transactions" DROP COLUMN IF EXISTS "corporate_action_identity_hash";
ALTER TABLE "portfolio_valuation_snapshots" DROP COLUMN IF EXISTS "net_contributions";
ALTER TABLE "portfolio_valuation_snapshots"
  ADD CONSTRAINT "portfolio_valuation_snapshots_values_check" CHECK (
    "ledger_version" >= 0 AND "missing_price_count" >= 0
    AND "cash_balance" <> 'NaN'::numeric
    AND "positions_market_value" <> 'NaN'::numeric
    AND "total_value" <> 'NaN'::numeric
    AND "realized_pnl" <> 'NaN'::numeric
    AND ("unrealized_pnl" IS NULL OR "unrealized_pnl" <> 'NaN'::numeric)
  );
