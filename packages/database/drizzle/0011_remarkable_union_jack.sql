CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"csrf_token_hash" varchar(64) NOT NULL,
	"session_version" integer NOT NULL,
	"authentication_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"idle_expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" varchar(64),
	"replaced_by_session_id" uuid,
	"ip_hash" varchar(64) NOT NULL,
	"user_agent_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_sessions_expiry_order_check" CHECK ("auth_sessions"."expires_at" > "auth_sessions"."created_at" and "auth_sessions"."idle_expires_at" > "auth_sessions"."created_at")
);
--> statement-breakpoint
CREATE TABLE "feature_flag_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"environment" varchar(24) NOT NULL,
	"enabled" boolean NOT NULL,
	"rollout_percentage" numeric(5, 2),
	"targeting_rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reason" text NOT NULL,
	"changed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flag_versions_flag_version_environment_unique" UNIQUE("flag_id","version","environment"),
	CONSTRAINT "feature_flag_versions_version_check" CHECK ("feature_flag_versions"."version" > 0),
	CONSTRAINT "feature_flag_versions_rollout_check" CHECK ("feature_flag_versions"."rollout_percentage" is null or ("feature_flag_versions"."rollout_percentage" >= 0 and "feature_flag_versions"."rollout_percentage" <= 100)),
	CONSTRAINT "feature_flag_versions_payload_size_check" CHECK (octet_length("feature_flag_versions"."targeting_rules"::text) <= 16384 and octet_length("feature_flag_versions"."reason") <= 4096)
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"flag_type" varchar(24) NOT NULL,
	"default_enabled" boolean DEFAULT false NOT NULL,
	"owner" varchar(120),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_key_unique" UNIQUE("key"),
	CONSTRAINT "feature_flags_type_check" CHECK ("feature_flags"."flag_type" in ('release', 'experiment', 'kill_switch'))
);
--> statement-breakpoint
CREATE TABLE "operational_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_type" varchar(24) NOT NULL,
	"action" varchar(120) NOT NULL,
	"resource_type" varchar(80) NOT NULL,
	"resource_id" varchar(160),
	"environment" varchar(24) NOT NULL,
	"reason" text,
	"before_state" jsonb,
	"after_state" jsonb,
	"request_id" varchar(128),
	"correlation_id" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_audit_payload_size_check" CHECK (("operational_audit_events"."reason" is null or octet_length("operational_audit_events"."reason") <= 4096)
          and ("operational_audit_events"."before_state" is null or octet_length("operational_audit_events"."before_state"::text) <= 32768)
          and ("operational_audit_events"."after_state" is null or octet_length("operational_audit_events"."after_state"::text) <= 32768))
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "password_reset_tokens_expiry_check" CHECK ("password_reset_tokens"."expires_at" > "password_reset_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "release_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" varchar(128) NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"image_digest" varchar(80) NOT NULL,
	"environment" varchar(24) NOT NULL,
	"status" varchar(24) NOT NULL,
	"migrations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"feature_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"validation_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"rollback_of" uuid,
	"rollback_reason" text,
	CONSTRAINT "release_records_environment_version_unique" UNIQUE("environment","version"),
	CONSTRAINT "release_records_status_check" CHECK ("release_records"."status" in ('planned', 'deploying', 'healthy', 'failed', 'rolled_back')),
	CONSTRAINT "release_records_digest_check" CHECK ("release_records"."image_digest" ~ '^sha256:[a-f0-9]{64}$'),
	CONSTRAINT "release_records_payload_size_check" CHECK (octet_length("release_records"."migrations"::text) <= 32768
          and octet_length("release_records"."feature_flags"::text) <= 32768
          and octet_length("release_records"."validation_summary"::text) <= 65536)
);
--> statement-breakpoint
CREATE TABLE "security_rate_limit_buckets" (
	"subject_hash" varchar(64) NOT NULL,
	"limit_class" varchar(40) NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "security_rate_limit_bucket_unique" UNIQUE("subject_hash","limit_class","window_started_at"),
	CONSTRAINT "security_rate_limit_count_check" CHECK ("security_rate_limit_buckets"."request_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "security_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"normalized_email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"account_status" varchar(24) DEFAULT 'active' NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"session_version" integer DEFAULT 1 NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_users_normalized_email_unique" UNIQUE("normalized_email"),
	CONSTRAINT "security_users_status_check" CHECK ("security_users"."account_status" in ('active', 'disabled', 'locked')),
	CONSTRAINT "security_users_session_version_check" CHECK ("security_users"."session_version" > 0),
	CONSTRAINT "security_users_roles_size_check" CHECK (octet_length("security_users"."roles"::text) <= 4096)
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_security_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."security_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_flag_versions" ADD CONSTRAINT "feature_flag_versions_flag_id_feature_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."feature_flags"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_security_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."security_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_active_idx" ON "auth_sessions" USING btree ("user_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "feature_flag_versions_environment_idx" ON "feature_flag_versions" USING btree ("environment");--> statement-breakpoint
CREATE INDEX "operational_audit_resource_created_idx" ON "operational_audit_events" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "operational_audit_actor_created_idx" ON "operational_audit_events" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_expiry_idx" ON "password_reset_tokens" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "release_records_environment_status_idx" ON "release_records" USING btree ("environment","status","started_at");--> statement-breakpoint
CREATE INDEX "security_rate_limit_expiry_idx" ON "security_rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "security_users_status_idx" ON "security_users" USING btree ("account_status");--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_replaced_by_fk" FOREIGN KEY ("replaced_by_session_id") REFERENCES "public"."auth_sessions"("id") ON DELETE set null DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE FUNCTION prevent_immutable_operational_record_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER operational_audit_events_immutable
BEFORE UPDATE OR DELETE ON operational_audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_operational_record_mutation();--> statement-breakpoint
CREATE TRIGGER feature_flag_versions_immutable
BEFORE UPDATE OR DELETE ON feature_flag_versions
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_operational_record_mutation();
