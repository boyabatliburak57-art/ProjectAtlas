CREATE TABLE "account_deletion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"subject_hash" varchar(64) NOT NULL,
	"idempotency_key" varchar(160) NOT NULL,
	"status" varchar(24) NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"grace_until" timestamp with time zone NOT NULL,
	"purge_started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" varchar(80),
	CONSTRAINT "account_deletion_requests_idempotency_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "account_deletion_requests_status_check" CHECK ("account_deletion_requests"."status" in ('pending', 'disabled', 'purging', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "account_deletion_requests_subject_hash_check" CHECK ("account_deletion_requests"."subject_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "account_deletion_requests_grace_check" CHECK ("account_deletion_requests"."grace_until" >= "account_deletion_requests"."requested_at"),
	CONSTRAINT "account_deletion_requests_attempt_check" CHECK ("account_deletion_requests"."attempt_count" >= 0),
	CONSTRAINT "account_deletion_requests_completed_check" CHECK (("account_deletion_requests"."status" = 'completed' and "account_deletion_requests"."completed_at" is not null and "account_deletion_requests"."user_id" is null)
          or "account_deletion_requests"."status" <> 'completed')
);
--> statement-breakpoint
CREATE TABLE "backup_status_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" varchar(24) NOT NULL,
	"provider_adapter" varchar(80) NOT NULL,
	"backup_reference" varchar(256) NOT NULL,
	"backup_created_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"encrypted" boolean NOT NULL,
	"pitr_enabled" boolean NOT NULL,
	"separate_failure_domain" boolean NOT NULL,
	"retention_days" integer NOT NULL,
	"status" varchar(24) NOT NULL,
	"failure_code" varchar(80),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "backup_status_environment_reference_unique" UNIQUE("environment","backup_reference"),
	CONSTRAINT "backup_status_environment_check" CHECK ("backup_status_checks"."environment" in ('local', 'test', 'staging', 'production', 'recovery')),
	CONSTRAINT "backup_status_status_check" CHECK ("backup_status_checks"."status" in ('healthy', 'failed', 'stale', 'unknown')),
	CONSTRAINT "backup_status_retention_check" CHECK ("backup_status_checks"."retention_days" between 1 and 3650),
	CONSTRAINT "backup_status_failure_check" CHECK (("backup_status_checks"."status" = 'healthy' and "backup_status_checks"."failure_code" is null) or "backup_status_checks"."status" <> 'healthy'),
	CONSTRAINT "backup_status_metadata_size_check" CHECK (octet_length("backup_status_checks"."metadata"::text) <= 16384)
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope_type" varchar(40) NOT NULL,
	"scope_id" varchar(160) NOT NULL,
	"reason" text NOT NULL,
	"status" varchar(24) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	CONSTRAINT "legal_holds_status_check" CHECK ("legal_holds"."status" in ('active', 'released', 'expired')),
	CONSTRAINT "legal_holds_reason_size_check" CHECK (length(trim("legal_holds"."reason")) > 0 and octet_length("legal_holds"."reason") <= 4096),
	CONSTRAINT "legal_holds_release_check" CHECK (("legal_holds"."status" = 'released' and "legal_holds"."released_at" is not null) or "legal_holds"."status" <> 'released')
);
--> statement-breakpoint
CREATE TABLE "recovery_drills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"drill_type" varchar(40) NOT NULL,
	"environment" varchar(24) NOT NULL,
	"backup_reference" varchar(256),
	"source_cutoff_at" timestamp with time zone,
	"target_rpo_seconds" integer,
	"achieved_rpo_seconds" integer,
	"target_rto_seconds" integer,
	"achieved_rto_seconds" integer,
	"status" varchar(24) NOT NULL,
	"validation_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"cleanup_completed_at" timestamp with time zone,
	"executed_by" uuid,
	CONSTRAINT "recovery_drills_type_check" CHECK ("recovery_drills"."drill_type" in ('postgres_pitr', 'postgres_backup', 'object_restore', 'redis_loss', 'full')),
	CONSTRAINT "recovery_drills_environment_check" CHECK ("recovery_drills"."environment" in ('local', 'test', 'staging', 'production', 'recovery')),
	CONSTRAINT "recovery_drills_status_check" CHECK ("recovery_drills"."status" in ('planned', 'running', 'passed', 'failed', 'cancelled')),
	CONSTRAINT "recovery_drills_duration_check" CHECK ("recovery_drills"."target_rpo_seconds" is null or "recovery_drills"."target_rpo_seconds" >= 0),
	CONSTRAINT "recovery_drills_rpo_check" CHECK ("recovery_drills"."achieved_rpo_seconds" is null or "recovery_drills"."achieved_rpo_seconds" >= 0),
	CONSTRAINT "recovery_drills_rto_target_check" CHECK ("recovery_drills"."target_rto_seconds" is null or "recovery_drills"."target_rto_seconds" > 0),
	CONSTRAINT "recovery_drills_rto_check" CHECK ("recovery_drills"."achieved_rto_seconds" is null or "recovery_drills"."achieved_rto_seconds" >= 0),
	CONSTRAINT "recovery_drills_terminal_check" CHECK (("recovery_drills"."status" in ('passed', 'failed', 'cancelled') and "recovery_drills"."completed_at" is not null)
          or ("recovery_drills"."status" in ('planned', 'running') and "recovery_drills"."completed_at" is null)),
	CONSTRAINT "recovery_drills_summary_size_check" CHECK (octet_length("recovery_drills"."validation_summary"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "retention_job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_key" varchar(160) NOT NULL,
	"policy_code" varchar(80) NOT NULL,
	"policy_version" varchar(40) NOT NULL,
	"status" varchar(24) NOT NULL,
	"scanned_count" bigint DEFAULT 0 NOT NULL,
	"deleted_count" bigint DEFAULT 0 NOT NULL,
	"skipped_count" bigint DEFAULT 0 NOT NULL,
	"error_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "retention_job_runs_execution_key_unique" UNIQUE("execution_key"),
	CONSTRAINT "retention_job_runs_status_check" CHECK ("retention_job_runs"."status" in ('running', 'completed', 'failed')),
	CONSTRAINT "retention_job_runs_counts_check" CHECK ("retention_job_runs"."scanned_count" >= 0 and "retention_job_runs"."deleted_count" >= 0 and "retention_job_runs"."skipped_count" >= 0),
	CONSTRAINT "retention_job_runs_terminal_check" CHECK (("retention_job_runs"."status" = 'running' and "retention_job_runs"."completed_at" is null)
          or ("retention_job_runs"."status" in ('completed', 'failed') and "retention_job_runs"."completed_at" is not null)),
	CONSTRAINT "retention_job_runs_error_size_check" CHECK (octet_length("retention_job_runs"."error_summary"::text) <= 32768)
);
--> statement-breakpoint
CREATE TABLE "stored_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"artifact_type" varchar(40) NOT NULL,
	"object_key" varchar(512) NOT NULL,
	"version" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"encryption_key_reference" varchar(256) NOT NULL,
	"byte_size" bigint NOT NULL,
	"status" varchar(24) NOT NULL,
	"retention_until" timestamp with time zone,
	"orphaned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "stored_artifacts_object_version_unique" UNIQUE("object_key","version"),
	CONSTRAINT "stored_artifacts_type_check" CHECK ("stored_artifacts"."artifact_type" in ('backtest_series', 'export', 'import', 'error_report', 'recovery')),
	CONSTRAINT "stored_artifacts_status_check" CHECK ("stored_artifacts"."status" in ('active', 'orphaned', 'deleted')),
	CONSTRAINT "stored_artifacts_version_check" CHECK ("stored_artifacts"."version" > 0),
	CONSTRAINT "stored_artifacts_size_check" CHECK ("stored_artifacts"."byte_size" >= 0),
	CONSTRAINT "stored_artifacts_checksum_check" CHECK ("stored_artifacts"."checksum_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "stored_artifacts_deleted_check" CHECK (("stored_artifacts"."status" = 'deleted' and "stored_artifacts"."deleted_at" is not null) or "stored_artifacts"."status" <> 'deleted')
);
--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_security_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."security_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_created_by_security_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."security_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_released_by_security_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."security_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_drills" ADD CONSTRAINT "recovery_drills_executed_by_security_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."security_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stored_artifacts" ADD CONSTRAINT "stored_artifacts_owner_user_id_security_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."security_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_deletion_requests_status_grace_idx" ON "account_deletion_requests" USING btree ("status","grace_until");--> statement-breakpoint
CREATE INDEX "backup_status_environment_checked_idx" ON "backup_status_checks" USING btree ("environment","checked_at");--> statement-breakpoint
CREATE INDEX "legal_holds_scope_status_idx" ON "legal_holds" USING btree ("scope_type","scope_id","status");--> statement-breakpoint
CREATE INDEX "recovery_drills_environment_status_completed_idx" ON "recovery_drills" USING btree ("environment","status","completed_at");--> statement-breakpoint
CREATE INDEX "retention_job_runs_policy_status_started_idx" ON "retention_job_runs" USING btree ("policy_code","status","started_at");--> statement-breakpoint
CREATE INDEX "stored_artifacts_owner_status_idx" ON "stored_artifacts" USING btree ("owner_user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "stored_artifacts_retention_idx" ON "stored_artifacts" USING btree ("status","retention_until");
--> statement-breakpoint
CREATE FUNCTION prevent_recovery_drill_terminal_rewrite() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('passed', 'failed', 'cancelled') AND (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.backup_reference IS DISTINCT FROM OLD.backup_reference OR
    NEW.achieved_rpo_seconds IS DISTINCT FROM OLD.achieved_rpo_seconds OR
    NEW.achieved_rto_seconds IS DISTINCT FROM OLD.achieved_rto_seconds OR
    NEW.validation_summary IS DISTINCT FROM OLD.validation_summary OR
    NEW.completed_at IS DISTINCT FROM OLD.completed_at
  ) THEN
    RAISE EXCEPTION 'terminal recovery drill evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER recovery_drills_terminal_immutable
BEFORE UPDATE ON recovery_drills
FOR EACH ROW EXECUTE FUNCTION prevent_recovery_drill_terminal_rewrite();
--> statement-breakpoint
CREATE FUNCTION prevent_retention_run_terminal_rewrite() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'terminal retention run is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER retention_job_runs_terminal_immutable
BEFORE UPDATE ON retention_job_runs
FOR EACH ROW EXECUTE FUNCTION prevent_retention_run_terminal_rewrite();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_incident_timeline_mutation()
RETURNS trigger AS $$
BEGIN
  IF current_setting('atlas.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'incident timeline events are immutable';
END;
$$ LANGUAGE plpgsql;
