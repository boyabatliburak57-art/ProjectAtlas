CREATE TABLE "backtest_data_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_hash" varchar(128) NOT NULL,
	"schema_version" integer NOT NULL,
	"market_revision_hash" varchar(128) NOT NULL,
	"universe_revision_hash" varchar(128) NOT NULL,
	"fundamental_revision_hash" varchar(128) NOT NULL,
	"corporate_action_revision_hash" varchar(128) NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"coverage_status" varchar(24) NOT NULL,
	"revision_manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_data_snapshots_hashes_not_blank" CHECK (
        length(trim("backtest_data_snapshots"."snapshot_hash")) > 0
        and length(trim("backtest_data_snapshots"."market_revision_hash")) > 0
        and length(trim("backtest_data_snapshots"."universe_revision_hash")) > 0
        and length(trim("backtest_data_snapshots"."fundamental_revision_hash")) > 0
        and length(trim("backtest_data_snapshots"."corporate_action_revision_hash")) > 0
      ),
	CONSTRAINT "backtest_data_snapshots_schema_version_check" CHECK ("backtest_data_snapshots"."schema_version" >= 1),
	CONSTRAINT "backtest_data_snapshots_coverage_status_check" CHECK ("backtest_data_snapshots"."coverage_status" in ('complete', 'partial', 'not_evaluable'))
);
--> statement-breakpoint
CREATE TABLE "backtest_fills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"fill_sequence" integer NOT NULL,
	"filled_at" timestamp with time zone NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"raw_price" numeric(28, 10) NOT NULL,
	"fill_price" numeric(28, 10) NOT NULL,
	"commission" numeric(28, 10) DEFAULT '0' NOT NULL,
	"slippage_cost" numeric(28, 10) DEFAULT '0' NOT NULL,
	"fee" numeric(28, 10) DEFAULT '0' NOT NULL,
	"tax" numeric(28, 10) DEFAULT '0' NOT NULL,
	"deduplication_key" varchar(160) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_fills_id_run_unique" UNIQUE("id","run_id"),
	CONSTRAINT "backtest_fills_run_sequence_unique" UNIQUE("run_id","fill_sequence"),
	CONSTRAINT "backtest_fills_sequence_check" CHECK ("backtest_fills"."fill_sequence" >= 0),
	CONSTRAINT "backtest_fills_numeric_check" CHECK (
        "backtest_fills"."quantity" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_fills"."quantity" > 0
        and "backtest_fills"."raw_price" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_fills"."raw_price" >= 0
        and "backtest_fills"."fill_price" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_fills"."fill_price" >= 0
        and "backtest_fills"."commission" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_fills"."commission" >= 0
        and "backtest_fills"."slippage_cost" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_fills"."slippage_cost" >= 0
        and "backtest_fills"."fee" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_fills"."fee" >= 0
        and "backtest_fills"."tax" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_fills"."tax" >= 0
      )
);
--> statement-breakpoint
CREATE TABLE "backtest_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"order_sequence" integer NOT NULL,
	"event_at" timestamp with time zone NOT NULL,
	"side" varchar(8) NOT NULL,
	"order_type" varchar(24) NOT NULL,
	"status" varchar(24) NOT NULL,
	"requested_quantity" numeric(28, 10) NOT NULL,
	"signal_price" numeric(28, 10),
	"limit_price" numeric(28, 10),
	"stop_price" numeric(28, 10),
	"reason_code" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_orders_id_run_unique" UNIQUE("id","run_id"),
	CONSTRAINT "backtest_orders_run_sequence_unique" UNIQUE("run_id","order_sequence"),
	CONSTRAINT "backtest_orders_sequence_check" CHECK ("backtest_orders"."order_sequence" >= 0),
	CONSTRAINT "backtest_orders_side_check" CHECK ("backtest_orders"."side" in ('buy', 'sell')),
	CONSTRAINT "backtest_orders_type_check" CHECK ("backtest_orders"."order_type" in ('market', 'limit', 'stop', 'stop_limit')),
	CONSTRAINT "backtest_orders_status_check" CHECK ("backtest_orders"."status" in ('created', 'accepted', 'partially_filled', 'filled', 'cancelled', 'rejected')),
	CONSTRAINT "backtest_orders_quantity_check" CHECK ("backtest_orders"."requested_quantity" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_orders"."requested_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "backtest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"strategy_revision" integer NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"request_hash" varchar(128) NOT NULL,
	"idempotency_key_hash" varchar(128) NOT NULL,
	"engine_version" varchar(64) NOT NULL,
	"execution_policy_version" varchar(64) NOT NULL,
	"cost_policy_version" varchar(64) NOT NULL,
	"metric_policy_version" varchar(64) NOT NULL,
	"event_ordering_policy_version" varchar(64) NOT NULL,
	"rounding_policy_version" varchar(64) NOT NULL,
	"data_snapshot_id" uuid NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"universe_snapshot" jsonb NOT NULL,
	"timeframe" varchar(16) NOT NULL,
	"adjustment_mode" varchar(32) NOT NULL,
	"range_from" timestamp with time zone NOT NULL,
	"range_to" timestamp with time zone NOT NULL,
	"initial_capital" numeric(28, 10) NOT NULL,
	"progress" numeric(20, 12) DEFAULT '0' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_code" varchar(64),
	"error_message" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_runs_id_requester_unique" UNIQUE("id","requested_by"),
	CONSTRAINT "backtest_runs_status_check" CHECK ("backtest_runs"."status" in ('queued', 'resolving_data', 'running', 'calculating_metrics', 'completed', 'failed', 'cancel_requested', 'cancelled', 'expired')),
	CONSTRAINT "backtest_runs_hashes_not_blank" CHECK (length(trim("backtest_runs"."request_hash")) > 0 and length(trim("backtest_runs"."idempotency_key_hash")) > 0),
	CONSTRAINT "backtest_runs_versions_not_blank" CHECK (
        length(trim("backtest_runs"."engine_version")) > 0
        and length(trim("backtest_runs"."execution_policy_version")) > 0
        and length(trim("backtest_runs"."cost_policy_version")) > 0
        and length(trim("backtest_runs"."metric_policy_version")) > 0
        and length(trim("backtest_runs"."event_ordering_policy_version")) > 0
        and length(trim("backtest_runs"."rounding_policy_version")) > 0
      ),
	CONSTRAINT "backtest_runs_range_check" CHECK ("backtest_runs"."range_to" >= "backtest_runs"."range_from"),
	CONSTRAINT "backtest_runs_adjustment_mode_check" CHECK ("backtest_runs"."adjustment_mode" in ('raw', 'split_adjusted', 'total_return_adjusted')),
	CONSTRAINT "backtest_runs_financial_check" CHECK (
        "backtest_runs"."initial_capital" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_runs"."initial_capital" > 0
        and "backtest_runs"."progress" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_runs"."progress" >= 0 and "backtest_runs"."progress" <= 100
      )
);
--> statement-breakpoint
CREATE TABLE "backtest_series_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"series_type" varchar(32) NOT NULL,
	"chunk_index" integer NOT NULL,
	"range_start" timestamp with time zone NOT NULL,
	"range_end" timestamp with time zone NOT NULL,
	"point_count" integer NOT NULL,
	"encoding" varchar(32) DEFAULT 'json_v1' NOT NULL,
	"payload" jsonb NOT NULL,
	"checksum" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_series_chunks_type_check" CHECK ("backtest_series_chunks"."series_type" in ('equity', 'drawdown', 'cash', 'exposure', 'benchmark')),
	CONSTRAINT "backtest_series_chunks_range_check" CHECK ("backtest_series_chunks"."range_end" >= "backtest_series_chunks"."range_start"),
	CONSTRAINT "backtest_series_chunks_counts_check" CHECK ("backtest_series_chunks"."chunk_index" >= 0 and "backtest_series_chunks"."point_count" >= 0),
	CONSTRAINT "backtest_series_chunks_payload_check" CHECK (jsonb_typeof("backtest_series_chunks"."payload") = 'array')
);
--> statement-breakpoint
CREATE TABLE "backtest_summaries" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"ending_equity" numeric(28, 10) NOT NULL,
	"total_return" numeric(20, 12) NOT NULL,
	"annualized_return" numeric(20, 12),
	"maximum_drawdown" numeric(20, 12) NOT NULL,
	"volatility" numeric(20, 12),
	"sharpe_ratio" numeric(20, 12),
	"sortino_ratio" numeric(20, 12),
	"calmar_ratio" numeric(20, 12),
	"win_rate" numeric(20, 12),
	"profit_factor" numeric(20, 12),
	"expectancy" numeric(28, 10),
	"turnover" numeric(20, 12) NOT NULL,
	"exposure" numeric(20, 12) NOT NULL,
	"total_fees" numeric(28, 10) NOT NULL,
	"total_slippage" numeric(28, 10) NOT NULL,
	"benchmark_return" numeric(20, 12),
	"trade_count" integer NOT NULL,
	"methodology" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_summaries_counts_check" CHECK ("backtest_summaries"."trade_count" >= 0),
	CONSTRAINT "backtest_summaries_required_numeric_check" CHECK (
        "backtest_summaries"."ending_equity" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_summaries"."total_return" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_summaries"."maximum_drawdown" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_summaries"."turnover" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_summaries"."exposure" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_summaries"."total_fees" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_summaries"."total_slippage" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      )
);
--> statement-breakpoint
CREATE TABLE "backtest_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"trade_sequence" integer NOT NULL,
	"entry_fill_id" uuid NOT NULL,
	"exit_fill_id" uuid NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"quantity" numeric(28, 10) NOT NULL,
	"entry_price" numeric(28, 10) NOT NULL,
	"exit_price" numeric(28, 10) NOT NULL,
	"gross_pnl" numeric(28, 10) NOT NULL,
	"net_pnl" numeric(28, 10) NOT NULL,
	"total_cost" numeric(28, 10) NOT NULL,
	"return_rate" numeric(20, 12) NOT NULL,
	"holding_bars" integer NOT NULL,
	"close_reason" varchar(64) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backtest_trades_run_sequence_unique" UNIQUE("run_id","trade_sequence"),
	CONSTRAINT "backtest_trades_sequence_check" CHECK ("backtest_trades"."trade_sequence" >= 0),
	CONSTRAINT "backtest_trades_time_check" CHECK ("backtest_trades"."closed_at" >= "backtest_trades"."opened_at"),
	CONSTRAINT "backtest_trades_numeric_check" CHECK (
        "backtest_trades"."quantity" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_trades"."quantity" > 0
        and "backtest_trades"."entry_price" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_trades"."entry_price" >= 0
        and "backtest_trades"."exit_price" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_trades"."exit_price" >= 0
        and "backtest_trades"."gross_pnl" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_trades"."net_pnl" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_trades"."total_cost" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and "backtest_trades"."total_cost" >= 0
        and "backtest_trades"."return_rate" not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and "backtest_trades"."holding_bars" >= 0
      )
);
--> statement-breakpoint
CREATE TABLE "research_experiment_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"backtest_run_id" uuid NOT NULL,
	"binding_hash" varchar(128) NOT NULL,
	"parameter_binding" jsonb NOT NULL,
	"combination_index" integer NOT NULL,
	"sample_role" varchar(24) NOT NULL,
	"status" varchar(24) NOT NULL,
	"rank" integer,
	"selected_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "research_experiment_runs_experiment_index_unique" UNIQUE("experiment_id","combination_index"),
	CONSTRAINT "research_experiment_runs_index_check" CHECK ("research_experiment_runs"."combination_index" >= 0),
	CONSTRAINT "research_experiment_runs_sample_role_check" CHECK ("research_experiment_runs"."sample_role" in ('train', 'validation', 'test', 'holdout')),
	CONSTRAINT "research_experiment_runs_status_check" CHECK ("research_experiment_runs"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled', 'reused')),
	CONSTRAINT "research_experiment_runs_rank_check" CHECK ("research_experiment_runs"."rank" is null or "research_experiment_runs"."rank" >= 1)
);
--> statement-breakpoint
CREATE TABLE "research_experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"strategy_revision" integer NOT NULL,
	"data_snapshot_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"experiment_hash" varchar(128) NOT NULL,
	"definition" jsonb NOT NULL,
	"combination_count" integer NOT NULL,
	"completed_run_count" integer DEFAULT 0 NOT NULL,
	"failed_run_count" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_experiments_id_owner_unique" UNIQUE("id","owner_user_id"),
	CONSTRAINT "research_experiments_owner_hash_unique" UNIQUE("owner_user_id","experiment_hash"),
	CONSTRAINT "research_experiments_status_check" CHECK ("research_experiments"."status" in ('draft', 'queued', 'running', 'completed', 'partial', 'failed', 'cancel_requested', 'cancelled')),
	CONSTRAINT "research_experiments_counts_check" CHECK (
        "research_experiments"."combination_count" >= 1
        and "research_experiments"."completed_run_count" >= 0
        and "research_experiments"."failed_run_count" >= 0
        and "research_experiments"."completed_run_count" + "research_experiments"."failed_run_count" <= "research_experiments"."combination_count"
      ),
	CONSTRAINT "research_experiments_hash_not_blank" CHECK (length(trim("research_experiments"."experiment_hash")) > 0)
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"visibility" varchar(24) DEFAULT 'private' NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "strategies_id_owner_unique" UNIQUE("id","owner_user_id"),
	CONSTRAINT "strategies_name_not_blank" CHECK (length(trim("strategies"."name")) > 0),
	CONSTRAINT "strategies_visibility_check" CHECK ("strategies"."visibility" = 'private'),
	CONSTRAINT "strategies_status_check" CHECK ("strategies"."status" in ('draft', 'validated', 'archived', 'deleted')),
	CONSTRAINT "strategies_current_revision_check" CHECK ("strategies"."current_revision" >= 0),
	CONSTRAINT "strategies_deleted_state_check" CHECK (("strategies"."status" = 'deleted') = ("strategies"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "strategy_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"parameter_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_status" varchar(24) DEFAULT 'draft' NOT NULL,
	"complexity_score" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strategy_revisions_strategy_revision_unique" UNIQUE("strategy_id","revision"),
	CONSTRAINT "strategy_revisions_id_strategy_unique" UNIQUE("id","strategy_id"),
	CONSTRAINT "strategy_revisions_revision_check" CHECK ("strategy_revisions"."revision" >= 1),
	CONSTRAINT "strategy_revisions_schema_version_check" CHECK ("strategy_revisions"."schema_version" >= 1),
	CONSTRAINT "strategy_revisions_complexity_check" CHECK ("strategy_revisions"."complexity_score" >= 0),
	CONSTRAINT "strategy_revisions_validation_status_check" CHECK ("strategy_revisions"."validation_status" in ('draft', 'valid', 'invalid'))
);
--> statement-breakpoint
ALTER TABLE "backtest_fills" ADD CONSTRAINT "backtest_fills_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_fills" ADD CONSTRAINT "backtest_fills_run_owner_fk" FOREIGN KEY ("run_id","owner_user_id") REFERENCES "public"."backtest_runs"("id","requested_by") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_fills" ADD CONSTRAINT "backtest_fills_order_run_fk" FOREIGN KEY ("order_id","run_id") REFERENCES "public"."backtest_orders"("id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_orders" ADD CONSTRAINT "backtest_orders_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_orders" ADD CONSTRAINT "backtest_orders_run_owner_fk" FOREIGN KEY ("run_id","owner_user_id") REFERENCES "public"."backtest_runs"("id","requested_by") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_data_snapshot_id_backtest_data_snapshots_id_fk" FOREIGN KEY ("data_snapshot_id") REFERENCES "public"."backtest_data_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_strategy_revision_fk" FOREIGN KEY ("strategy_id","strategy_revision") REFERENCES "public"."strategy_revisions"("strategy_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_strategy_owner_fk" FOREIGN KEY ("strategy_id","requested_by") REFERENCES "public"."strategies"("id","owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_series_chunks" ADD CONSTRAINT "backtest_series_chunks_run_owner_fk" FOREIGN KEY ("run_id","owner_user_id") REFERENCES "public"."backtest_runs"("id","requested_by") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_summaries" ADD CONSTRAINT "backtest_summaries_run_owner_fk" FOREIGN KEY ("run_id","owner_user_id") REFERENCES "public"."backtest_runs"("id","requested_by") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_run_owner_fk" FOREIGN KEY ("run_id","owner_user_id") REFERENCES "public"."backtest_runs"("id","requested_by") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_entry_fill_run_fk" FOREIGN KEY ("entry_fill_id","run_id") REFERENCES "public"."backtest_fills"("id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_exit_fill_run_fk" FOREIGN KEY ("exit_fill_id","run_id") REFERENCES "public"."backtest_fills"("id","run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_experiment_runs" ADD CONSTRAINT "research_experiment_runs_experiment_owner_fk" FOREIGN KEY ("experiment_id","owner_user_id") REFERENCES "public"."research_experiments"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_experiment_runs" ADD CONSTRAINT "research_experiment_runs_backtest_owner_fk" FOREIGN KEY ("backtest_run_id","owner_user_id") REFERENCES "public"."backtest_runs"("id","requested_by") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_experiments" ADD CONSTRAINT "research_experiments_data_snapshot_id_backtest_data_snapshots_id_fk" FOREIGN KEY ("data_snapshot_id") REFERENCES "public"."backtest_data_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_experiments" ADD CONSTRAINT "research_experiments_strategy_revision_fk" FOREIGN KEY ("strategy_id","strategy_revision") REFERENCES "public"."strategy_revisions"("strategy_id","revision") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_experiments" ADD CONSTRAINT "research_experiments_strategy_owner_fk" FOREIGN KEY ("strategy_id","owner_user_id") REFERENCES "public"."strategies"("id","owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_revisions" ADD CONSTRAINT "strategy_revisions_strategy_owner_fk" FOREIGN KEY ("strategy_id","created_by") REFERENCES "public"."strategies"("id","owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backtest_data_snapshots_hash_unique" ON "backtest_data_snapshots" USING btree ("snapshot_hash");--> statement-breakpoint
CREATE INDEX "backtest_data_snapshots_cutoff_idx" ON "backtest_data_snapshots" USING btree ("data_cutoff_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "backtest_fills_deduplication_key_unique" ON "backtest_fills" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "backtest_fills_run_filled_idx" ON "backtest_fills" USING btree ("run_id","filled_at","fill_sequence");--> statement-breakpoint
CREATE INDEX "backtest_fills_owner_run_idx" ON "backtest_fills" USING btree ("owner_user_id","run_id");--> statement-breakpoint
CREATE INDEX "backtest_orders_run_event_idx" ON "backtest_orders" USING btree ("run_id","event_at","order_sequence");--> statement-breakpoint
CREATE INDEX "backtest_orders_owner_run_idx" ON "backtest_orders" USING btree ("owner_user_id","run_id");--> statement-breakpoint
CREATE INDEX "backtest_orders_instrument_event_idx" ON "backtest_orders" USING btree ("instrument_id","event_at");--> statement-breakpoint
CREATE UNIQUE INDEX "backtest_runs_requester_idempotency_unique" ON "backtest_runs" USING btree ("requested_by","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "backtest_runs_requester_status_updated_idx" ON "backtest_runs" USING btree ("requested_by","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "backtest_runs_strategy_revision_idx" ON "backtest_runs" USING btree ("strategy_id","strategy_revision");--> statement-breakpoint
CREATE INDEX "backtest_runs_snapshot_idx" ON "backtest_runs" USING btree ("data_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "backtest_series_chunks_run_type_chunk_unique" ON "backtest_series_chunks" USING btree ("run_id","series_type","chunk_index");--> statement-breakpoint
CREATE INDEX "backtest_series_chunks_owner_run_type_idx" ON "backtest_series_chunks" USING btree ("owner_user_id","run_id","series_type");--> statement-breakpoint
CREATE INDEX "backtest_summaries_owner_calculated_idx" ON "backtest_summaries" USING btree ("owner_user_id","calculated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "backtest_trades_run_closed_idx" ON "backtest_trades" USING btree ("run_id","closed_at","trade_sequence");--> statement-breakpoint
CREATE INDEX "backtest_trades_owner_run_idx" ON "backtest_trades" USING btree ("owner_user_id","run_id");--> statement-breakpoint
CREATE INDEX "backtest_trades_instrument_closed_idx" ON "backtest_trades" USING btree ("instrument_id","closed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "research_experiment_runs_experiment_binding_unique" ON "research_experiment_runs" USING btree ("experiment_id","binding_hash");--> statement-breakpoint
CREATE INDEX "research_experiment_runs_owner_experiment_idx" ON "research_experiment_runs" USING btree ("owner_user_id","experiment_id","combination_index");--> statement-breakpoint
CREATE INDEX "research_experiment_runs_backtest_run_idx" ON "research_experiment_runs" USING btree ("backtest_run_id");--> statement-breakpoint
CREATE INDEX "research_experiments_owner_status_updated_idx" ON "research_experiments" USING btree ("owner_user_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "research_experiments_strategy_revision_idx" ON "research_experiments" USING btree ("strategy_id","strategy_revision");--> statement-breakpoint
CREATE INDEX "strategies_owner_status_updated_idx" ON "strategies" USING btree ("owner_user_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "strategy_revisions_strategy_created_idx" ON "strategy_revisions" USING btree ("strategy_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_strategy_revision_mutation()
RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'strategy revisions are immutable'
		USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER strategy_revisions_immutable
BEFORE UPDATE OR DELETE ON strategy_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_strategy_revision_mutation();
