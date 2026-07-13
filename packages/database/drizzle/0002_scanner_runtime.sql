CREATE TABLE "preset_scan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"preset_scan_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_ast" jsonb NOT NULL,
	"complexity_score" numeric NOT NULL,
	"lifecycle_status" varchar(24) DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "preset_scan_revisions_revision_check" CHECK ("preset_scan_revisions"."revision" >= 1),
	CONSTRAINT "preset_scan_revisions_rule_version_check" CHECK ("preset_scan_revisions"."rule_version" >= 1),
	CONSTRAINT "preset_scan_revisions_complexity_check" CHECK ("preset_scan_revisions"."complexity_score" >= 0),
	CONSTRAINT "preset_scan_revisions_lifecycle_check" CHECK ("preset_scan_revisions"."lifecycle_status" in ('draft', 'review', 'published', 'archived')),
	CONSTRAINT "preset_scan_revisions_publication_check" CHECK (("preset_scan_revisions"."lifecycle_status" = 'published') = ("preset_scan_revisions"."published_by" is not null and "preset_scan_revisions"."published_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "preset_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"category_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "preset_scans_status_check" CHECK ("preset_scans"."status" in ('draft', 'review', 'published', 'archived')),
	CONSTRAINT "preset_scans_current_revision_check" CHECK ("preset_scans"."current_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "saved_scan_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"saved_scan_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"rule_version" integer NOT NULL,
	"rule_ast" jsonb NOT NULL,
	"complexity_score" numeric,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_scan_revisions_revision_check" CHECK ("saved_scan_revisions"."revision" >= 1),
	CONSTRAINT "saved_scan_revisions_rule_version_check" CHECK ("saved_scan_revisions"."rule_version" >= 1),
	CONSTRAINT "saved_scan_revisions_complexity_check" CHECK ("saved_scan_revisions"."complexity_score" is null or "saved_scan_revisions"."complexity_score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "saved_scan_tags" (
	"saved_scan_id" uuid NOT NULL,
	"tag" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_scan_tags_pk" PRIMARY KEY("saved_scan_id","tag"),
	CONSTRAINT "saved_scan_tags_tag_not_blank" CHECK (length(trim("saved_scan_tags"."tag")) > 0)
);
--> statement-breakpoint
CREATE TABLE "saved_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"visibility" varchar(24) DEFAULT 'private' NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "saved_scans_visibility_check" CHECK ("saved_scans"."visibility" in ('private', 'shared', 'public')),
	CONSTRAINT "saved_scans_status_check" CHECK ("saved_scans"."status" in ('active', 'deleted', 'archived')),
	CONSTRAINT "saved_scans_current_revision_check" CHECK ("saved_scans"."current_revision" >= 0),
	CONSTRAINT "saved_scans_deleted_state_check" CHECK (("saved_scans"."status" = 'deleted') = ("saved_scans"."deleted_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "scan_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_categories_code_not_blank" CHECK (length(trim("scan_categories"."code")) > 0),
	CONSTRAINT "scan_categories_sort_order_check" CHECK ("scan_categories"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scan_results" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scan_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"scan_run_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"rank" integer,
	"status" varchar(24) NOT NULL,
	"computed_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"explanation" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"matched_at" timestamp with time zone,
	"source_batch_index" integer NOT NULL,
	"result_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_results_status_check" CHECK ("scan_results"."status" in ('matched', 'not_matched', 'not_evaluable')),
	CONSTRAINT "scan_results_rank_check" CHECK ("scan_results"."rank" is null or "scan_results"."rank" >= 1),
	CONSTRAINT "scan_results_source_batch_check" CHECK ("scan_results"."source_batch_index" >= 0),
	CONSTRAINT "scan_results_version_check" CHECK ("scan_results"."result_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "scan_run_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"batch_index" integer NOT NULL,
	"plan_version" integer NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"instrument_ids" jsonb,
	"snapshot_segment_reference" varchar(255),
	"attempt" integer DEFAULT 0 NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" varchar(64),
	"processed_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"not_evaluable_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_run_batches_index_check" CHECK ("scan_run_batches"."batch_index" >= 0),
	CONSTRAINT "scan_run_batches_plan_version_check" CHECK ("scan_run_batches"."plan_version" >= 1),
	CONSTRAINT "scan_run_batches_status_check" CHECK ("scan_run_batches"."status" in ('queued', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "scan_run_batches_source_check" CHECK (num_nonnulls("scan_run_batches"."instrument_ids", "scan_run_batches"."snapshot_segment_reference") = 1),
	CONSTRAINT "scan_run_batches_attempt_check" CHECK ("scan_run_batches"."attempt" >= 0),
	CONSTRAINT "scan_run_batches_counts_check" CHECK ("scan_run_batches"."processed_count" >= 0 and "scan_run_batches"."matched_count" >= 0 and "scan_run_batches"."matched_count" <= "scan_run_batches"."processed_count" and "scan_run_batches"."not_evaluable_count" >= 0 and "scan_run_batches"."not_evaluable_count" <= "scan_run_batches"."processed_count")
);
--> statement-breakpoint
CREATE TABLE "scan_run_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "scan_run_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"scan_run_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"from_status" varchar(24),
	"to_status" varchar(24),
	"actor_user_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_run_events_transition_check" CHECK (("scan_run_events"."from_status" is null and "scan_run_events"."to_status" is null) or ("scan_run_events"."to_status" is not null))
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" varchar(24) NOT NULL,
	"source_id" uuid,
	"source_revision" integer,
	"requested_by" uuid NOT NULL,
	"idempotency_key_hash" varchar(128) NOT NULL,
	"request_hash" varchar(128) NOT NULL,
	"status" varchar(24) DEFAULT 'queued' NOT NULL,
	"execution_mode" varchar(16) NOT NULL,
	"plan_version" integer NOT NULL,
	"rule_version" integer NOT NULL,
	"normalized_rule_ast" jsonb NOT NULL,
	"execution_plan" jsonb NOT NULL,
	"universe_snapshot" jsonb NOT NULL,
	"complexity_score" numeric NOT NULL,
	"data_cutoff_at" timestamp with time zone NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"timeout_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"retention_policy" varchar(32) DEFAULT 'standard' NOT NULL,
	"progress_total" integer DEFAULT 0 NOT NULL,
	"progress_processed" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"not_evaluable_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"error_code" varchar(64),
	"error_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_runs_source_check" CHECK ("scan_runs"."source_type" in ('ad_hoc', 'saved_scan', 'preset_scan', 'admin')),
	CONSTRAINT "scan_runs_source_reference_check" CHECK (("scan_runs"."source_type" in ('saved_scan', 'preset_scan')) = ("scan_runs"."source_id" is not null and "scan_runs"."source_revision" is not null)),
	CONSTRAINT "scan_runs_status_check" CHECK ("scan_runs"."status" in ('queued', 'running', 'completed', 'failed', 'cancel_requested', 'cancelled', 'expired')),
	CONSTRAINT "scan_runs_execution_mode_check" CHECK ("scan_runs"."execution_mode" in ('sync', 'async')),
	CONSTRAINT "scan_runs_versions_check" CHECK ("scan_runs"."plan_version" >= 1 and "scan_runs"."rule_version" >= 1),
	CONSTRAINT "scan_runs_complexity_check" CHECK ("scan_runs"."complexity_score" >= 0),
	CONSTRAINT "scan_runs_counts_check" CHECK ("scan_runs"."progress_total" >= 0 and "scan_runs"."progress_processed" >= 0 and "scan_runs"."progress_processed" <= "scan_runs"."progress_total" and "scan_runs"."matched_count" >= 0 and "scan_runs"."matched_count" <= "scan_runs"."progress_processed" and "scan_runs"."not_evaluable_count" >= 0 and "scan_runs"."not_evaluable_count" <= "scan_runs"."progress_processed" and "scan_runs"."warning_count" >= 0),
	CONSTRAINT "scan_runs_timestamps_check" CHECK (("scan_runs"."started_at" is null or "scan_runs"."started_at" >= "scan_runs"."queued_at") and ("scan_runs"."completed_at" is null or "scan_runs"."started_at" is not null and "scan_runs"."completed_at" >= "scan_runs"."started_at") and ("scan_runs"."cancelled_at" is null or "scan_runs"."cancel_requested_at" is not null and "scan_runs"."cancelled_at" >= "scan_runs"."cancel_requested_at"))
);
--> statement-breakpoint
ALTER TABLE "preset_scan_revisions" ADD CONSTRAINT "preset_scan_revisions_preset_scan_id_preset_scans_id_fk" FOREIGN KEY ("preset_scan_id") REFERENCES "public"."preset_scans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preset_scans" ADD CONSTRAINT "preset_scans_category_id_scan_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."scan_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_scan_revisions" ADD CONSTRAINT "saved_scan_revisions_saved_scan_id_saved_scans_id_fk" FOREIGN KEY ("saved_scan_id") REFERENCES "public"."saved_scans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_scan_tags" ADD CONSTRAINT "saved_scan_tags_saved_scan_id_saved_scans_id_fk" FOREIGN KEY ("saved_scan_id") REFERENCES "public"."saved_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_categories" ADD CONSTRAINT "scan_categories_parent_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."scan_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_results" ADD CONSTRAINT "scan_results_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_run_batches" ADD CONSTRAINT "scan_run_batches_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_run_events" ADD CONSTRAINT "scan_run_events_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "preset_scan_revisions_scan_revision_unique" ON "preset_scan_revisions" USING btree ("preset_scan_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "preset_scan_revisions_one_published_unique" ON "preset_scan_revisions" USING btree ("preset_scan_id") WHERE "preset_scan_revisions"."lifecycle_status" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX "preset_scans_code_unique" ON "preset_scans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "preset_scans_category_status_idx" ON "preset_scans" USING btree ("category_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_scan_revisions_scan_revision_unique" ON "saved_scan_revisions" USING btree ("saved_scan_id","revision");--> statement-breakpoint
CREATE INDEX "saved_scans_owner_status_updated_idx" ON "saved_scans" USING btree ("owner_user_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "scan_categories_code_unique" ON "scan_categories" USING btree ("code");--> statement-breakpoint
CREATE INDEX "scan_categories_parent_sort_idx" ON "scan_categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_results_run_instrument_unique" ON "scan_results" USING btree ("scan_run_id","instrument_id");--> statement-breakpoint
CREATE INDEX "scan_results_run_rank_idx" ON "scan_results" USING btree ("scan_run_id","rank");--> statement-breakpoint
CREATE INDEX "scan_results_instrument_created_idx" ON "scan_results" USING btree ("instrument_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "scan_run_batches_run_batch_unique" ON "scan_run_batches" USING btree ("scan_run_id","batch_index");--> statement-breakpoint
CREATE INDEX "scan_run_batches_run_status_idx" ON "scan_run_batches" USING btree ("scan_run_id","status");--> statement-breakpoint
CREATE INDEX "scan_run_events_run_occurred_idx" ON "scan_run_events" USING btree ("scan_run_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_runs_requester_idempotency_unique" ON "scan_runs" USING btree ("requested_by","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "scan_runs_requested_queued_idx" ON "scan_runs" USING btree ("requested_by","queued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "scan_runs_status_queued_idx" ON "scan_runs" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "scan_runs_terminal_expiry_idx" ON "scan_runs" USING btree ("expires_at") WHERE "scan_runs"."status" in ('completed', 'failed', 'cancelled', 'expired') and "scan_runs"."expires_at" is not null;
--> statement-breakpoint
CREATE FUNCTION prevent_scanner_revision_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'scanner revisions are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER saved_scan_revisions_immutable
BEFORE UPDATE OR DELETE ON saved_scan_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_scanner_revision_mutation();
--> statement-breakpoint
CREATE TRIGGER preset_scan_revisions_immutable
BEFORE UPDATE OR DELETE ON preset_scan_revisions
FOR EACH ROW EXECUTE FUNCTION prevent_scanner_revision_mutation();
--> statement-breakpoint
CREATE FUNCTION prevent_scan_run_identity_mutation() RETURNS trigger AS $$
BEGIN
	IF NEW.requested_by IS DISTINCT FROM OLD.requested_by
		OR NEW.idempotency_key_hash IS DISTINCT FROM OLD.idempotency_key_hash
		OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
		OR NEW.plan_version IS DISTINCT FROM OLD.plan_version
		OR NEW.rule_version IS DISTINCT FROM OLD.rule_version
		OR NEW.normalized_rule_ast IS DISTINCT FROM OLD.normalized_rule_ast
		OR NEW.execution_plan IS DISTINCT FROM OLD.execution_plan
		OR NEW.universe_snapshot IS DISTINCT FROM OLD.universe_snapshot
		OR NEW.data_cutoff_at IS DISTINCT FROM OLD.data_cutoff_at THEN
		RAISE EXCEPTION 'scan run identity and snapshot fields are immutable' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER scan_runs_identity_immutable
BEFORE UPDATE ON scan_runs
FOR EACH ROW EXECUTE FUNCTION prevent_scan_run_identity_mutation();
