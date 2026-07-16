ALTER TABLE "portfolio_valuation_snapshots" DROP CONSTRAINT "portfolio_valuation_snapshots_values_check";--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ADD COLUMN "corporate_action_identity_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "portfolio_valuation_snapshots" ADD COLUMN "net_contributions" numeric(28, 10) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_transactions_corporate_action_identity_unique" ON "portfolio_transactions" USING btree ("portfolio_id","corporate_action_identity_hash") WHERE "portfolio_transactions"."corporate_action_identity_hash" is not null;--> statement-breakpoint
ALTER TABLE "portfolio_valuation_snapshots" ADD CONSTRAINT "portfolio_valuation_snapshots_values_check" CHECK (
        "portfolio_valuation_snapshots"."ledger_version" >= 0 and "portfolio_valuation_snapshots"."missing_price_count" >= 0
        and "portfolio_valuation_snapshots"."cash_balance" <> 'NaN'::numeric
        and "portfolio_valuation_snapshots"."positions_market_value" <> 'NaN'::numeric
        and "portfolio_valuation_snapshots"."total_value" <> 'NaN'::numeric
        and "portfolio_valuation_snapshots"."realized_pnl" <> 'NaN'::numeric
        and ("portfolio_valuation_snapshots"."unrealized_pnl" is null or "portfolio_valuation_snapshots"."unrealized_pnl" <> 'NaN'::numeric)
        and "portfolio_valuation_snapshots"."net_contributions" <> 'NaN'::numeric
      );