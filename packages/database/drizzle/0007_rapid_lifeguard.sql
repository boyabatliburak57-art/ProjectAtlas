CREATE TABLE "fundamental_metric_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_snapshot_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"metric_code" varchar(64) NOT NULL,
	"value" numeric(28, 10),
	"status" varchar(24) NOT NULL,
	"reason_code" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundamental_metric_snapshots_statement_metric_unique" UNIQUE("statement_snapshot_id","metric_code"),
	CONSTRAINT "fundamental_metric_snapshots_status_check" CHECK ("fundamental_metric_snapshots"."status" in ('complete', 'missing', 'not_evaluable')),
	CONSTRAINT "fundamental_metric_snapshots_value_status_check" CHECK (("fundamental_metric_snapshots"."status" = 'complete' and "fundamental_metric_snapshots"."value" is not null and "fundamental_metric_snapshots"."value" <> 'NaN'::numeric and "fundamental_metric_snapshots"."reason_code" is null) or ("fundamental_metric_snapshots"."status" <> 'complete' and "fundamental_metric_snapshots"."value" is null and "fundamental_metric_snapshots"."reason_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "fundamental_ratio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"generation_id" uuid NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"ratio_code" varchar(64) NOT NULL,
	"formula_version" varchar(64) NOT NULL,
	"fiscal_period_reference" varchar(64) NOT NULL,
	"market_data_cutoff_at" timestamp with time zone,
	"value" numeric(20, 12),
	"status" varchar(24) NOT NULL,
	"reason_code" varchar(64),
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundamental_ratio_snapshots_formula_identity_unique" UNIQUE("instrument_id","ratio_code","formula_version","fiscal_period_reference","data_cutoff_at"),
	CONSTRAINT "fundamental_ratio_snapshots_status_check" CHECK ("fundamental_ratio_snapshots"."status" in ('complete', 'missing', 'not_evaluable')),
	CONSTRAINT "fundamental_ratio_snapshots_value_status_check" CHECK (("fundamental_ratio_snapshots"."status" = 'complete' and "fundamental_ratio_snapshots"."value" is not null and "fundamental_ratio_snapshots"."value" <> 'NaN'::numeric and "fundamental_ratio_snapshots"."reason_code" is null) or ("fundamental_ratio_snapshots"."status" <> 'complete' and "fundamental_ratio_snapshots"."value" is null and "fundamental_ratio_snapshots"."reason_code" is not null))
);
--> statement-breakpoint
CREATE TABLE "fundamental_statement_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"statement_type" varchar(40) NOT NULL,
	"fiscal_year" integer NOT NULL,
	"fiscal_period" varchar(24) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"currency_code" varchar(3) NOT NULL,
	"unit_scale" numeric(28, 10) NOT NULL,
	"provider_revision" varchar(128) NOT NULL,
	"generation_id" uuid NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"source_timestamp" timestamp with time zone NOT NULL,
	"normalized_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quality_status" varchar(24) NOT NULL,
	"quality_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fundamental_statement_snapshots_revision_unique" UNIQUE("instrument_id","provider_id","statement_type","fiscal_year","fiscal_period","provider_revision"),
	CONSTRAINT "fundamental_statement_snapshots_metric_context_unique" UNIQUE("id","generation_id","policy_version","data_cutoff_at"),
	CONSTRAINT "fundamental_statement_snapshots_period_check" CHECK ("fundamental_statement_snapshots"."period_end" >= "fundamental_statement_snapshots"."period_start"),
	CONSTRAINT "fundamental_statement_snapshots_unit_scale_check" CHECK ("fundamental_statement_snapshots"."unit_scale" <> 'NaN'::numeric and "fundamental_statement_snapshots"."unit_scale" > 0),
	CONSTRAINT "fundamental_statement_snapshots_quality_check" CHECK ("fundamental_statement_snapshots"."quality_status" in ('complete', 'partial', 'not_evaluable'))
);
--> statement-breakpoint
CREATE TABLE "market_overview_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_code" varchar(32) NOT NULL,
	"timeframe" varchar(16) NOT NULL,
	"universe_version" varchar(64) NOT NULL,
	"generation_id" uuid NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"source_timestamp" timestamp with time zone,
	"status" varchar(24) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evaluated_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"quality_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_overview_snapshots_identity_unique" UNIQUE("market_code","timeframe","universe_version","data_cutoff_at","policy_version"),
	CONSTRAINT "market_overview_snapshots_generation_context_unique" UNIQUE("generation_id","market_code","timeframe","policy_version","data_cutoff_at"),
	CONSTRAINT "market_overview_snapshots_status_check" CHECK ("market_overview_snapshots"."status" in ('complete', 'partial', 'stale', 'not_evaluable', 'invalidated')),
	CONSTRAINT "market_overview_snapshots_counts_check" CHECK ("market_overview_snapshots"."evaluated_count" >= 0 and "market_overview_snapshots"."excluded_count" >= 0),
	CONSTRAINT "market_overview_snapshots_versions_not_blank" CHECK (length(trim("market_overview_snapshots"."universe_version")) > 0 and length(trim("market_overview_snapshots"."policy_version")) > 0),
	CONSTRAINT "market_overview_snapshots_invalidation_check" CHECK (("market_overview_snapshots"."status" = 'invalidated') = ("market_overview_snapshots"."invalidated_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "market_rank_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_code" varchar(32) NOT NULL,
	"timeframe" varchar(16) NOT NULL,
	"generation_id" uuid NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"ranking_type" varchar(40) NOT NULL,
	"instrument_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"sort_value" numeric(28, 10) NOT NULL,
	"status" varchar(24) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evaluated_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"quality_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_rank_snapshots_generation_type_instrument_unique" UNIQUE("generation_id","ranking_type","instrument_id"),
	CONSTRAINT "market_rank_snapshots_generation_type_rank_unique" UNIQUE("generation_id","ranking_type","rank"),
	CONSTRAINT "market_rank_snapshots_rank_check" CHECK ("market_rank_snapshots"."rank" >= 1),
	CONSTRAINT "market_rank_snapshots_sort_value_check" CHECK ("market_rank_snapshots"."sort_value" <> 'NaN'::numeric),
	CONSTRAINT "market_rank_snapshots_status_check" CHECK ("market_rank_snapshots"."status" in ('complete', 'partial', 'stale', 'not_evaluable')),
	CONSTRAINT "market_rank_snapshots_counts_check" CHECK ("market_rank_snapshots"."evaluated_count" >= 0 and "market_rank_snapshots"."excluded_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pattern_definitions" (
	"code" varchar(64) NOT NULL,
	"version" integer NOT NULL,
	"algorithm_version" varchar(64) NOT NULL,
	"category" varchar(40) NOT NULL,
	"parameter_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_schema_version" integer DEFAULT 1 NOT NULL,
	"status" varchar(24) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pattern_definitions_pk" PRIMARY KEY("code","version"),
	CONSTRAINT "pattern_definitions_version_check" CHECK ("pattern_definitions"."version" >= 1),
	CONSTRAINT "pattern_definitions_evidence_version_check" CHECK ("pattern_definitions"."evidence_schema_version" >= 1),
	CONSTRAINT "pattern_definitions_status_check" CHECK ("pattern_definitions"."status" in ('active', 'deprecated', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "pattern_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instrument_id" uuid NOT NULL,
	"timeframe" varchar(16) NOT NULL,
	"adjustment_mode" varchar(32) NOT NULL,
	"pattern_code" varchar(64) NOT NULL,
	"pattern_version" integer NOT NULL,
	"algorithm_version" varchar(64) NOT NULL,
	"state" varchar(24) NOT NULL,
	"direction" varchar(24) NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"invalidated_at" timestamp with time zone,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"confidence" numeric(7, 4),
	"evidence_version" integer DEFAULT 1 NOT NULL,
	"evidence" jsonb NOT NULL,
	"deduplication_key" varchar(160) NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quality_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pattern_instances_adjustment_mode_check" CHECK ("pattern_instances"."adjustment_mode" in ('raw', 'split_adjusted', 'total_return_adjusted')),
	CONSTRAINT "pattern_instances_state_check" CHECK ("pattern_instances"."state" in ('candidate', 'confirmed', 'invalidated')),
	CONSTRAINT "pattern_instances_direction_check" CHECK ("pattern_instances"."direction" in ('bullish', 'bearish', 'neutral')),
	CONSTRAINT "pattern_instances_time_check" CHECK ("pattern_instances"."end_time" >= "pattern_instances"."start_time" and "pattern_instances"."detected_at" >= "pattern_instances"."end_time" and "pattern_instances"."data_cutoff_at" >= "pattern_instances"."end_time"),
	CONSTRAINT "pattern_instances_transition_check" CHECK (("pattern_instances"."state" = 'candidate' and "pattern_instances"."confirmed_at" is null and "pattern_instances"."invalidated_at" is null) or ("pattern_instances"."state" = 'confirmed' and "pattern_instances"."confirmed_at" is not null and "pattern_instances"."invalidated_at" is null) or ("pattern_instances"."state" = 'invalidated' and "pattern_instances"."invalidated_at" is not null and "pattern_instances"."confirmed_at" is null)),
	CONSTRAINT "pattern_instances_confidence_check" CHECK ("pattern_instances"."confidence" is null or ("pattern_instances"."confidence" <> 'NaN'::numeric and "pattern_instances"."confidence" >= 0 and "pattern_instances"."confidence" <= 100)),
	CONSTRAINT "pattern_instances_evidence_version_check" CHECK ("pattern_instances"."evidence_version" >= 1),
	CONSTRAINT "pattern_instances_evidence_shape_check" CHECK (jsonb_typeof("pattern_instances"."evidence") = 'object' and "pattern_instances"."evidence" ? 'schemaVersion')
);
--> statement-breakpoint
CREATE TABLE "sector_market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_code" varchar(32) NOT NULL,
	"timeframe" varchar(16) NOT NULL,
	"generation_id" uuid NOT NULL,
	"policy_version" varchar(64) NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"sector_id" uuid NOT NULL,
	"status" varchar(24) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evaluated_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"quality_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sector_market_snapshots_generation_sector_unique" UNIQUE("generation_id","sector_id"),
	CONSTRAINT "sector_market_snapshots_status_check" CHECK ("sector_market_snapshots"."status" in ('complete', 'partial', 'stale', 'not_evaluable')),
	CONSTRAINT "sector_market_snapshots_counts_check" CHECK ("sector_market_snapshots"."evaluated_count" >= 0 and "sector_market_snapshots"."excluded_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "fundamental_metric_snapshots" ADD CONSTRAINT "fundamental_metric_snapshots_statement_context_fk" FOREIGN KEY ("statement_snapshot_id","generation_id","policy_version","data_cutoff_at") REFERENCES "public"."fundamental_statement_snapshots"("id","generation_id","policy_version","data_cutoff_at") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundamental_ratio_snapshots" ADD CONSTRAINT "fundamental_ratio_snapshots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundamental_statement_snapshots" ADD CONSTRAINT "fundamental_statement_snapshots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundamental_statement_snapshots" ADD CONSTRAINT "fundamental_statement_snapshots_provider_id_data_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."data_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_rank_snapshots" ADD CONSTRAINT "market_rank_snapshots_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_rank_snapshots" ADD CONSTRAINT "market_rank_snapshots_generation_context_fk" FOREIGN KEY ("generation_id","market_code","timeframe","policy_version","data_cutoff_at") REFERENCES "public"."market_overview_snapshots"("generation_id","market_code","timeframe","policy_version","data_cutoff_at") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_instances" ADD CONSTRAINT "pattern_instances_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_instances" ADD CONSTRAINT "pattern_instances_definition_fk" FOREIGN KEY ("pattern_code","pattern_version") REFERENCES "public"."pattern_definitions"("code","version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_market_snapshots" ADD CONSTRAINT "sector_market_snapshots_sector_id_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."sectors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_market_snapshots" ADD CONSTRAINT "sector_market_snapshots_generation_context_fk" FOREIGN KEY ("generation_id","market_code","timeframe","policy_version","data_cutoff_at") REFERENCES "public"."market_overview_snapshots"("generation_id","market_code","timeframe","policy_version","data_cutoff_at") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fundamental_metric_snapshots_metric_cutoff_idx" ON "fundamental_metric_snapshots" USING btree ("metric_code","data_cutoff_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fundamental_ratio_snapshots_instrument_ratio_period_idx" ON "fundamental_ratio_snapshots" USING btree ("instrument_id","ratio_code","fiscal_period_reference","data_cutoff_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fundamental_statement_snapshots_instrument_period_idx" ON "fundamental_statement_snapshots" USING btree ("instrument_id","statement_type","fiscal_year" DESC NULLS LAST,"fiscal_period");--> statement-breakpoint
CREATE INDEX "fundamental_statement_snapshots_provider_revision_idx" ON "fundamental_statement_snapshots" USING btree ("provider_id","provider_revision");--> statement-breakpoint
CREATE INDEX "market_overview_snapshots_market_cutoff_idx" ON "market_overview_snapshots" USING btree ("market_code","timeframe","data_cutoff_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "market_overview_snapshots_generation_idx" ON "market_overview_snapshots" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "market_rank_snapshots_type_generation_rank_idx" ON "market_rank_snapshots" USING btree ("ranking_type","generation_id","rank");--> statement-breakpoint
CREATE INDEX "market_rank_snapshots_instrument_cutoff_idx" ON "market_rank_snapshots" USING btree ("instrument_id","data_cutoff_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "pattern_instances_deduplication_key_unique" ON "pattern_instances" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "pattern_instances_instrument_timeframe_detected_idx" ON "pattern_instances" USING btree ("instrument_id","timeframe","detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pattern_instances_code_state_detected_idx" ON "pattern_instances" USING btree ("pattern_code","state","detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sector_market_snapshots_generation_idx" ON "sector_market_snapshots" USING btree ("generation_id");--> statement-breakpoint
CREATE INDEX "sector_market_snapshots_sector_cutoff_idx" ON "sector_market_snapshots" USING btree ("sector_id","data_cutoff_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_fundamental_statement_snapshot_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'fundamental statement snapshots are immutable revisions'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER fundamental_statement_snapshots_immutable
BEFORE UPDATE OR DELETE ON fundamental_statement_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_fundamental_statement_snapshot_mutation();
