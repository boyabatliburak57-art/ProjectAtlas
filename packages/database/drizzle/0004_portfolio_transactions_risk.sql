CREATE TABLE "portfolio_cash_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"currency_code" char(3) NOT NULL,
	"balance" numeric(28, 10) NOT NULL,
	"projection_ledger_version" bigint NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_cash_balances_numeric_check" CHECK ("portfolio_cash_balances"."balance" <> 'NaN'::numeric and "portfolio_cash_balances"."projection_ledger_version" >= 0),
	CONSTRAINT "portfolio_cash_balances_currency_check" CHECK ("portfolio_cash_balances"."currency_code" = 'TRY')
);
--> statement-breakpoint
CREATE TABLE "portfolio_import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" varchar(24) DEFAULT 'uploaded' NOT NULL,
	"commit_mode" varchar(16) DEFAULT 'atomic' NOT NULL,
	"source_filename" varchar(255) NOT NULL,
	"file_hash" varchar(128) NOT NULL,
	"idempotency_key_hash" varchar(128) NOT NULL,
	"total_row_count" integer DEFAULT 0 NOT NULL,
	"valid_row_count" integer DEFAULT 0 NOT NULL,
	"invalid_row_count" integer DEFAULT 0 NOT NULL,
	"duplicate_row_count" integer DEFAULT 0 NOT NULL,
	"committed_row_count" integer DEFAULT 0 NOT NULL,
	"preview_expires_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_import_jobs_owner_identity_unique" UNIQUE("id","portfolio_id","user_id"),
	CONSTRAINT "portfolio_import_jobs_status_check" CHECK ("portfolio_import_jobs"."status" in ('uploaded', 'validating', 'preview_ready', 'committing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "portfolio_import_jobs_commit_mode_check" CHECK ("portfolio_import_jobs"."commit_mode" in ('atomic', 'partial')),
	CONSTRAINT "portfolio_import_jobs_hashes_not_blank" CHECK (length(trim("portfolio_import_jobs"."file_hash")) > 0 and length(trim("portfolio_import_jobs"."idempotency_key_hash")) > 0),
	CONSTRAINT "portfolio_import_jobs_counts_check" CHECK (
        "portfolio_import_jobs"."total_row_count" >= 0 and "portfolio_import_jobs"."valid_row_count" >= 0
        and "portfolio_import_jobs"."invalid_row_count" >= 0 and "portfolio_import_jobs"."duplicate_row_count" >= 0
        and "portfolio_import_jobs"."committed_row_count" >= 0
        and "portfolio_import_jobs"."valid_row_count" + "portfolio_import_jobs"."invalid_row_count" + "portfolio_import_jobs"."duplicate_row_count" <= "portfolio_import_jobs"."total_row_count"
        and "portfolio_import_jobs"."committed_row_count" <= "portfolio_import_jobs"."valid_row_count"
      ),
	CONSTRAINT "portfolio_import_jobs_terminal_timestamp_check" CHECK (
        ("portfolio_import_jobs"."status" = 'completed') = ("portfolio_import_jobs"."committed_at" is not null)
        and ("portfolio_import_jobs"."status" = 'cancelled') = ("portfolio_import_jobs"."cancelled_at" is not null)
      )
);
--> statement-breakpoint
CREATE TABLE "portfolio_import_rows" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "portfolio_import_rows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"import_job_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"status" varchar(24) NOT NULL,
	"duplicate_of_transaction_id" uuid,
	"normalized_transaction_hash" varchar(128),
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"normalized_data" jsonb,
	"validation_errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_import_rows_status_check" CHECK ("portfolio_import_rows"."status" in ('valid', 'invalid', 'duplicate', 'committed', 'skipped')),
	CONSTRAINT "portfolio_import_rows_row_number_check" CHECK ("portfolio_import_rows"."row_number" >= 1),
	CONSTRAINT "portfolio_import_rows_duplicate_state_check" CHECK (("portfolio_import_rows"."status" = 'duplicate') = ("portfolio_import_rows"."duplicate_of_transaction_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "portfolio_performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"ledger_version" bigint NOT NULL,
	"range_start_at" timestamp with time zone NOT NULL,
	"range_end_at" timestamp with time zone NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"performance_policy_version" varchar(64) NOT NULL,
	"benchmark_code" varchar(64) DEFAULT 'none' NOT NULL,
	"status" varchar(24) NOT NULL,
	"twr" numeric(20, 12),
	"xirr" numeric(20, 12),
	"benchmark_return" numeric(20, 12),
	"net_contribution" numeric(28, 10) NOT NULL,
	"start_value" numeric(28, 10) NOT NULL,
	"end_value" numeric(28, 10) NOT NULL,
	"observation_count" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_performance_snapshots_status_check" CHECK ("portfolio_performance_snapshots"."status" in ('complete', 'partial', 'not_evaluable')),
	CONSTRAINT "portfolio_performance_snapshots_range_check" CHECK ("portfolio_performance_snapshots"."range_end_at" >= "portfolio_performance_snapshots"."range_start_at" and "portfolio_performance_snapshots"."data_cutoff_at" >= "portfolio_performance_snapshots"."range_end_at"),
	CONSTRAINT "portfolio_performance_snapshots_values_check" CHECK (
        "portfolio_performance_snapshots"."ledger_version" >= 0 and "portfolio_performance_snapshots"."observation_count" >= 0
        and ("portfolio_performance_snapshots"."twr" is null or "portfolio_performance_snapshots"."twr" <> 'NaN'::numeric)
        and ("portfolio_performance_snapshots"."xirr" is null or "portfolio_performance_snapshots"."xirr" <> 'NaN'::numeric)
        and ("portfolio_performance_snapshots"."benchmark_return" is null or "portfolio_performance_snapshots"."benchmark_return" <> 'NaN'::numeric)
        and "portfolio_performance_snapshots"."net_contribution" <> 'NaN'::numeric
        and "portfolio_performance_snapshots"."start_value" <> 'NaN'::numeric
        and "portfolio_performance_snapshots"."end_value" <> 'NaN'::numeric
      )
);
--> statement-breakpoint
CREATE TABLE "portfolio_position_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"valuation_snapshot_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"ledger_version" bigint NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"price_policy_version" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"average_cost" numeric(28, 10) NOT NULL,
	"cost_basis" numeric(28, 10) NOT NULL,
	"market_price" numeric(28, 10),
	"market_value" numeric(28, 10),
	"unrealized_pnl" numeric(28, 10),
	"price_at" timestamp with time zone,
	"warning_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_position_snapshots_status_check" CHECK ("portfolio_position_snapshots"."status" in ('valued', 'missing_price', 'stale_price')),
	CONSTRAINT "portfolio_position_snapshots_values_check" CHECK (
        "portfolio_position_snapshots"."ledger_version" >= 0
        and "portfolio_position_snapshots"."quantity" <> 'NaN'::numeric and "portfolio_position_snapshots"."quantity" >= 0
        and "portfolio_position_snapshots"."average_cost" <> 'NaN'::numeric and "portfolio_position_snapshots"."average_cost" >= 0
        and "portfolio_position_snapshots"."cost_basis" <> 'NaN'::numeric and "portfolio_position_snapshots"."cost_basis" >= 0
        and ("portfolio_position_snapshots"."market_price" is null or ("portfolio_position_snapshots"."market_price" <> 'NaN'::numeric and "portfolio_position_snapshots"."market_price" >= 0))
        and ("portfolio_position_snapshots"."market_value" is null or "portfolio_position_snapshots"."market_value" <> 'NaN'::numeric)
        and ("portfolio_position_snapshots"."unrealized_pnl" is null or "portfolio_position_snapshots"."unrealized_pnl" <> 'NaN'::numeric)
      ),
	CONSTRAINT "portfolio_position_snapshots_price_state_check" CHECK (
        ("portfolio_position_snapshots"."status" = 'missing_price' and "portfolio_position_snapshots"."market_price" is null and "portfolio_position_snapshots"."market_value" is null and "portfolio_position_snapshots"."price_at" is null)
        or ("portfolio_position_snapshots"."status" in ('valued', 'stale_price') and "portfolio_position_snapshots"."market_price" is not null and "portfolio_position_snapshots"."market_value" is not null and "portfolio_position_snapshots"."price_at" is not null)
      ),
	CONSTRAINT "portfolio_position_snapshots_price_cutoff_check" CHECK ("portfolio_position_snapshots"."price_at" is null or "portfolio_position_snapshots"."price_at" <= "portfolio_position_snapshots"."data_cutoff_at")
);
--> statement-breakpoint
CREATE TABLE "portfolio_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"average_cost" numeric(28, 10) NOT NULL,
	"cost_basis" numeric(28, 10) NOT NULL,
	"realized_pnl" numeric(28, 10) DEFAULT '0' NOT NULL,
	"dividend_income" numeric(28, 10) DEFAULT '0' NOT NULL,
	"projection_ledger_version" bigint NOT NULL,
	"calculated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_positions_numeric_check" CHECK (
        "portfolio_positions"."quantity" <> 'NaN'::numeric and "portfolio_positions"."quantity" >= 0
        and "portfolio_positions"."average_cost" <> 'NaN'::numeric and "portfolio_positions"."average_cost" >= 0
        and "portfolio_positions"."cost_basis" <> 'NaN'::numeric and "portfolio_positions"."cost_basis" >= 0
        and "portfolio_positions"."realized_pnl" <> 'NaN'::numeric
        and "portfolio_positions"."dividend_income" <> 'NaN'::numeric
        and "portfolio_positions"."projection_ledger_version" >= 0
      )
);
--> statement-breakpoint
CREATE TABLE "portfolio_risk_exposures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"risk_snapshot_id" uuid NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"risk_policy_version" varchar(64) NOT NULL,
	"exposure_type" varchar(24) NOT NULL,
	"exposure_key" varchar(160) NOT NULL,
	"weight" numeric(20, 12) NOT NULL,
	"market_value" numeric(28, 10) NOT NULL,
	"rank" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_risk_exposures_type_check" CHECK ("portfolio_risk_exposures"."exposure_type" in ('instrument', 'sector', 'cash')),
	CONSTRAINT "portfolio_risk_exposures_values_check" CHECK (
        "portfolio_risk_exposures"."weight" <> 'NaN'::numeric and "portfolio_risk_exposures"."weight" >= 0
        and "portfolio_risk_exposures"."market_value" <> 'NaN'::numeric
        and ("portfolio_risk_exposures"."rank" is null or "portfolio_risk_exposures"."rank" >= 1)
      )
);
--> statement-breakpoint
CREATE TABLE "portfolio_risk_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"ledger_version" bigint NOT NULL,
	"valuation_series_version" bigint NOT NULL,
	"range_start_at" timestamp with time zone NOT NULL,
	"range_end_at" timestamp with time zone NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"benchmark_code" varchar(64) DEFAULT 'none' NOT NULL,
	"risk_policy_version" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"observation_count" integer DEFAULT 0 NOT NULL,
	"volatility" numeric(20, 12),
	"beta" numeric(20, 12),
	"maximum_drawdown" numeric(20, 12),
	"historical_var_95" numeric(20, 12),
	"historical_var_99" numeric(20, 12),
	"expected_shortfall" numeric(20, 12),
	"hhi" numeric(20, 12),
	"methodology" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_risk_snapshots_identity_unique" UNIQUE("portfolio_id","ledger_version","valuation_series_version","range_start_at","range_end_at","data_cutoff_at","benchmark_code","risk_policy_version"),
	CONSTRAINT "portfolio_risk_snapshots_child_identity_unique" UNIQUE("id","portfolio_id","risk_policy_version"),
	CONSTRAINT "portfolio_risk_snapshots_status_check" CHECK ("portfolio_risk_snapshots"."status" in ('complete', 'partial', 'not_evaluable')),
	CONSTRAINT "portfolio_risk_snapshots_range_check" CHECK ("portfolio_risk_snapshots"."range_end_at" >= "portfolio_risk_snapshots"."range_start_at" and "portfolio_risk_snapshots"."data_cutoff_at" >= "portfolio_risk_snapshots"."range_end_at"),
	CONSTRAINT "portfolio_risk_snapshots_values_check" CHECK (
        "portfolio_risk_snapshots"."ledger_version" >= 0 and "portfolio_risk_snapshots"."valuation_series_version" >= 0 and "portfolio_risk_snapshots"."observation_count" >= 0
        and ("portfolio_risk_snapshots"."volatility" is null or "portfolio_risk_snapshots"."volatility" <> 'NaN'::numeric)
        and ("portfolio_risk_snapshots"."beta" is null or "portfolio_risk_snapshots"."beta" <> 'NaN'::numeric)
        and ("portfolio_risk_snapshots"."maximum_drawdown" is null or "portfolio_risk_snapshots"."maximum_drawdown" <> 'NaN'::numeric)
        and ("portfolio_risk_snapshots"."historical_var_95" is null or "portfolio_risk_snapshots"."historical_var_95" <> 'NaN'::numeric)
        and ("portfolio_risk_snapshots"."historical_var_99" is null or "portfolio_risk_snapshots"."historical_var_99" <> 'NaN'::numeric)
        and ("portfolio_risk_snapshots"."expected_shortfall" is null or "portfolio_risk_snapshots"."expected_shortfall" <> 'NaN'::numeric)
        and ("portfolio_risk_snapshots"."hhi" is null or "portfolio_risk_snapshots"."hhi" <> 'NaN'::numeric)
      )
);
--> statement-breakpoint
CREATE TABLE "portfolio_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"instrument_id" uuid,
	"reversal_of_transaction_id" uuid,
	"transaction_sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "portfolio_transactions_transaction_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" varchar(32) NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"trade_at" timestamp with time zone NOT NULL,
	"settlement_at" timestamp with time zone,
	"quantity" numeric(28, 10),
	"unit_price" numeric(28, 10),
	"fee" numeric(28, 10) DEFAULT '0' NOT NULL,
	"tax" numeric(28, 10) DEFAULT '0' NOT NULL,
	"cash_amount" numeric(28, 10),
	"source" varchar(32) NOT NULL,
	"external_reference" varchar(255),
	"idempotency_key_hash" varchar(128) NOT NULL,
	"normalized_transaction_hash" varchar(128) NOT NULL,
	"adjustment_reason" text,
	"note" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"posted_at" timestamp with time zone,
	"reversed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_transactions_id_portfolio_unique" UNIQUE("id","portfolio_id"),
	CONSTRAINT "portfolio_transactions_type_check" CHECK ("portfolio_transactions"."type" in ('buy', 'sell', 'cashDeposit', 'cashWithdrawal', 'dividend', 'fee', 'tax', 'split', 'bonusShare', 'rightsIssue', 'adjustment')),
	CONSTRAINT "portfolio_transactions_status_check" CHECK ("portfolio_transactions"."status" in ('draft', 'posted', 'reversed', 'deleted')),
	CONSTRAINT "portfolio_transactions_source_check" CHECK ("portfolio_transactions"."source" in ('manual', 'csv_import', 'corporate_action', 'system')),
	CONSTRAINT "portfolio_transactions_hashes_not_blank" CHECK (length(trim("portfolio_transactions"."idempotency_key_hash")) > 0 and length(trim("portfolio_transactions"."normalized_transaction_hash")) > 0),
	CONSTRAINT "portfolio_transactions_settlement_check" CHECK ("portfolio_transactions"."settlement_at" is null or "portfolio_transactions"."settlement_at" >= "portfolio_transactions"."trade_at"),
	CONSTRAINT "portfolio_transactions_numeric_check" CHECK (
        ("portfolio_transactions"."quantity" is null or ("portfolio_transactions"."quantity" <> 'NaN'::numeric and "portfolio_transactions"."quantity" >= 0))
        and ("portfolio_transactions"."unit_price" is null or ("portfolio_transactions"."unit_price" <> 'NaN'::numeric and "portfolio_transactions"."unit_price" >= 0))
        and "portfolio_transactions"."fee" <> 'NaN'::numeric and "portfolio_transactions"."fee" >= 0
        and "portfolio_transactions"."tax" <> 'NaN'::numeric and "portfolio_transactions"."tax" >= 0
        and ("portfolio_transactions"."cash_amount" is null or "portfolio_transactions"."cash_amount" <> 'NaN'::numeric)
      ),
	CONSTRAINT "portfolio_transactions_adjustment_reason_check" CHECK ("portfolio_transactions"."type" <> 'adjustment' or length(trim(coalesce("portfolio_transactions"."adjustment_reason", ''))) > 0),
	CONSTRAINT "portfolio_transactions_lifecycle_timestamps_check" CHECK (
        ("portfolio_transactions"."status" = 'draft' and "portfolio_transactions"."posted_at" is null and "portfolio_transactions"."reversed_at" is null and "portfolio_transactions"."deleted_at" is null)
        or ("portfolio_transactions"."status" = 'posted' and "portfolio_transactions"."posted_at" is not null and "portfolio_transactions"."reversed_at" is null and "portfolio_transactions"."deleted_at" is null)
        or ("portfolio_transactions"."status" = 'reversed' and "portfolio_transactions"."posted_at" is not null and "portfolio_transactions"."reversed_at" is not null and "portfolio_transactions"."deleted_at" is null)
        or ("portfolio_transactions"."status" = 'deleted' and "portfolio_transactions"."posted_at" is null and "portfolio_transactions"."reversed_at" is null and "portfolio_transactions"."deleted_at" is not null)
      ),
	CONSTRAINT "portfolio_transactions_no_self_reversal" CHECK ("portfolio_transactions"."reversal_of_transaction_id" is null or "portfolio_transactions"."reversal_of_transaction_id" <> "portfolio_transactions"."id")
);
--> statement-breakpoint
CREATE TABLE "portfolio_valuation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"ledger_version" bigint NOT NULL,
	"valuation_at" timestamp with time zone NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"price_policy_version" varchar(64) NOT NULL,
	"status" varchar(24) NOT NULL,
	"cash_balance" numeric(28, 10) NOT NULL,
	"positions_market_value" numeric(28, 10) NOT NULL,
	"total_value" numeric(28, 10) NOT NULL,
	"realized_pnl" numeric(28, 10) NOT NULL,
	"unrealized_pnl" numeric(28, 10),
	"missing_price_count" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_valuation_snapshots_identity_unique" UNIQUE("portfolio_id","ledger_version","valuation_at","data_cutoff_at","price_policy_version"),
	CONSTRAINT "portfolio_valuation_snapshots_child_identity_unique" UNIQUE("id","portfolio_id","ledger_version","data_cutoff_at","price_policy_version"),
	CONSTRAINT "portfolio_valuation_snapshots_status_check" CHECK ("portfolio_valuation_snapshots"."status" in ('complete', 'partial', 'not_evaluable')),
	CONSTRAINT "portfolio_valuation_snapshots_values_check" CHECK (
        "portfolio_valuation_snapshots"."ledger_version" >= 0 and "portfolio_valuation_snapshots"."missing_price_count" >= 0
        and "portfolio_valuation_snapshots"."cash_balance" <> 'NaN'::numeric
        and "portfolio_valuation_snapshots"."positions_market_value" <> 'NaN'::numeric
        and "portfolio_valuation_snapshots"."total_value" <> 'NaN'::numeric
        and "portfolio_valuation_snapshots"."realized_pnl" <> 'NaN'::numeric
        and ("portfolio_valuation_snapshots"."unrealized_pnl" is null or "portfolio_valuation_snapshots"."unrealized_pnl" <> 'NaN'::numeric)
      ),
	CONSTRAINT "portfolio_valuation_snapshots_cutoff_check" CHECK ("portfolio_valuation_snapshots"."data_cutoff_at" <= "portfolio_valuation_snapshots"."valuation_at"),
	CONSTRAINT "portfolio_valuation_snapshots_partial_check" CHECK (("portfolio_valuation_snapshots"."status" = 'complete' and "portfolio_valuation_snapshots"."missing_price_count" = 0) or "portfolio_valuation_snapshots"."status" <> 'complete')
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"reporting_currency" char(3) DEFAULT 'TRY' NOT NULL,
	"default_benchmark_code" varchar(64),
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"ledger_version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "portfolios_id_user_unique" UNIQUE("id","user_id"),
	CONSTRAINT "portfolios_name_not_blank" CHECK (length(trim("portfolios"."name")) > 0),
	CONSTRAINT "portfolios_currency_check" CHECK ("portfolios"."reporting_currency" = 'TRY'),
	CONSTRAINT "portfolios_status_check" CHECK ("portfolios"."status" in ('active', 'archived', 'deleted')),
	CONSTRAINT "portfolios_ledger_version_check" CHECK ("portfolios"."ledger_version" >= 0),
	CONSTRAINT "portfolios_deleted_state_check" CHECK (("portfolios"."status" = 'deleted') = ("portfolios"."deleted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "portfolio_cash_balances" ADD CONSTRAINT "portfolio_cash_balances_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_import_jobs" ADD CONSTRAINT "portfolio_import_jobs_portfolio_owner_fk" FOREIGN KEY ("portfolio_id","user_id") REFERENCES "public"."portfolios"("id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_import_rows" ADD CONSTRAINT "portfolio_import_rows_job_owner_fk" FOREIGN KEY ("import_job_id","portfolio_id","user_id") REFERENCES "public"."portfolio_import_jobs"("id","portfolio_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_import_rows" ADD CONSTRAINT "portfolio_import_rows_duplicate_transaction_fk" FOREIGN KEY ("duplicate_of_transaction_id","portfolio_id") REFERENCES "public"."portfolio_transactions"("id","portfolio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_performance_snapshots" ADD CONSTRAINT "portfolio_performance_snapshots_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_position_snapshots" ADD CONSTRAINT "portfolio_position_snapshots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_position_snapshots" ADD CONSTRAINT "portfolio_position_snapshots_valuation_identity_fk" FOREIGN KEY ("valuation_snapshot_id","portfolio_id","ledger_version","data_cutoff_at","price_policy_version") REFERENCES "public"."portfolio_valuation_snapshots"("id","portfolio_id","ledger_version","data_cutoff_at","price_policy_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_risk_exposures" ADD CONSTRAINT "portfolio_risk_exposures_snapshot_identity_fk" FOREIGN KEY ("risk_snapshot_id","portfolio_id","risk_policy_version") REFERENCES "public"."portfolio_risk_snapshots"("id","portfolio_id","risk_policy_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_risk_snapshots" ADD CONSTRAINT "portfolio_risk_snapshots_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_transactions" ADD CONSTRAINT "portfolio_transactions_reversal_same_portfolio_fk" FOREIGN KEY ("reversal_of_transaction_id","portfolio_id") REFERENCES "public"."portfolio_transactions"("id","portfolio_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_valuation_snapshots" ADD CONSTRAINT "portfolio_valuation_snapshots_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_cash_balances_portfolio_currency_unique" ON "portfolio_cash_balances" USING btree ("portfolio_id","currency_code");--> statement-breakpoint
CREATE INDEX "portfolio_cash_balances_portfolio_idx" ON "portfolio_cash_balances" USING btree ("portfolio_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_import_jobs_owner_idempotency_unique" ON "portfolio_import_jobs" USING btree ("portfolio_id","user_id","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "portfolio_import_jobs_owner_status_created_idx" ON "portfolio_import_jobs" USING btree ("user_id","portfolio_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_import_rows_job_row_unique" ON "portfolio_import_rows" USING btree ("import_job_id","row_number");--> statement-breakpoint
CREATE INDEX "portfolio_import_rows_owner_status_row_idx" ON "portfolio_import_rows" USING btree ("user_id","portfolio_id","status","row_number");--> statement-breakpoint
CREATE INDEX "portfolio_import_rows_normalized_hash_idx" ON "portfolio_import_rows" USING btree ("portfolio_id","normalized_transaction_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_performance_snapshots_identity_unique" ON "portfolio_performance_snapshots" USING btree ("portfolio_id","ledger_version","range_start_at","range_end_at","data_cutoff_at","performance_policy_version","benchmark_code");--> statement-breakpoint
CREATE INDEX "portfolio_performance_snapshots_portfolio_range_idx" ON "portfolio_performance_snapshots" USING btree ("portfolio_id","range_end_at" DESC NULLS LAST,"range_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_position_snapshots_valuation_instrument_unique" ON "portfolio_position_snapshots" USING btree ("valuation_snapshot_id","instrument_id");--> statement-breakpoint
CREATE INDEX "portfolio_position_snapshots_portfolio_value_idx" ON "portfolio_position_snapshots" USING btree ("portfolio_id","market_value" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_positions_portfolio_instrument_unique" ON "portfolio_positions" USING btree ("portfolio_id","instrument_id");--> statement-breakpoint
CREATE INDEX "portfolio_positions_portfolio_value_idx" ON "portfolio_positions" USING btree ("portfolio_id","cost_basis" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "portfolio_positions_instrument_idx" ON "portfolio_positions" USING btree ("instrument_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_risk_exposures_snapshot_type_key_unique" ON "portfolio_risk_exposures" USING btree ("risk_snapshot_id","exposure_type","exposure_key");--> statement-breakpoint
CREATE INDEX "portfolio_risk_exposures_portfolio_weight_idx" ON "portfolio_risk_exposures" USING btree ("portfolio_id","weight" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "portfolio_risk_snapshots_portfolio_range_idx" ON "portfolio_risk_snapshots" USING btree ("portfolio_id","range_end_at" DESC NULLS LAST,"range_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_transactions_portfolio_source_idempotency_unique" ON "portfolio_transactions" USING btree ("portfolio_id","source","idempotency_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_transactions_external_normalized_unique" ON "portfolio_transactions" USING btree ("portfolio_id","source","external_reference","normalized_transaction_hash") WHERE "portfolio_transactions"."external_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_transactions_reversal_unique" ON "portfolio_transactions" USING btree ("reversal_of_transaction_id") WHERE "portfolio_transactions"."reversal_of_transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "portfolio_transactions_portfolio_trade_sequence_idx" ON "portfolio_transactions" USING btree ("portfolio_id","trade_at","transaction_sequence");--> statement-breakpoint
CREATE INDEX "portfolio_transactions_portfolio_status_trade_idx" ON "portfolio_transactions" USING btree ("portfolio_id","status","trade_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "portfolio_transactions_instrument_trade_idx" ON "portfolio_transactions" USING btree ("instrument_id","trade_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "portfolio_valuation_snapshots_portfolio_valuation_idx" ON "portfolio_valuation_snapshots" USING btree ("portfolio_id","valuation_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "portfolios_user_status_updated_idx" ON "portfolios" USING btree ("user_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE FUNCTION prevent_finalized_portfolio_transaction_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' AND OLD.status IN ('posted', 'reversed') THEN
		RAISE EXCEPTION 'finalized portfolio transactions are immutable' USING ERRCODE = '23514';
	END IF;

	IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
		IF NEW.status = 'reversed'
			AND NEW.reversed_at IS NOT NULL
			AND (to_jsonb(NEW) - 'status' - 'reversed_at' - 'updated_at')
				IS NOT DISTINCT FROM
				(to_jsonb(OLD) - 'status' - 'reversed_at' - 'updated_at') THEN
			RETURN NEW;
		END IF;
		RAISE EXCEPTION 'posted portfolio transactions may only transition to reversed' USING ERRCODE = '23514';
	END IF;

	IF TG_OP = 'UPDATE' AND OLD.status = 'reversed' THEN
		RAISE EXCEPTION 'reversed portfolio transactions are immutable' USING ERRCODE = '23514';
	END IF;

	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER portfolio_transactions_finalized_immutable
BEFORE UPDATE OR DELETE ON portfolio_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_portfolio_transaction_mutation();
