CREATE TABLE "incident_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"event_type" varchar(48) NOT NULL,
	"message" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_timeline_events_incident_sequence_unique" UNIQUE("incident_id","sequence"),
	CONSTRAINT "incident_timeline_events_type_check" CHECK ("incident_timeline_events"."event_type" in ('detected', 'acknowledged', 'mitigation_started', 'mitigation_update', 'resolved', 'follow_up')),
	CONSTRAINT "incident_timeline_events_message_size_check" CHECK (length(trim("incident_timeline_events"."message")) > 0 and octet_length("incident_timeline_events"."message") <= 8192)
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"severity" varchar(8) NOT NULL,
	"status" varchar(24) NOT NULL,
	"title" varchar(240) NOT NULL,
	"summary" text NOT NULL,
	"impact" text,
	"commander_user_id" uuid,
	"detected_at" timestamp with time zone NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"root_cause" text,
	"follow_up_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_severity_check" CHECK ("incidents"."severity" in ('SEV-1', 'SEV-2', 'SEV-3', 'SEV-4')),
	CONSTRAINT "incidents_status_check" CHECK ("incidents"."status" in ('detected', 'acknowledged', 'mitigating', 'resolved')),
	CONSTRAINT "incidents_resolution_consistency_check" CHECK (("incidents"."status" = 'resolved' and "incidents"."resolved_at" is not null and "incidents"."resolution" is not null)
          or ("incidents"."status" <> 'resolved' and "incidents"."resolved_at" is null)),
	CONSTRAINT "incidents_timeline_order_check" CHECK ("incidents"."acknowledged_at" is null or "incidents"."acknowledged_at" >= "incidents"."detected_at"),
	CONSTRAINT "incidents_resolved_order_check" CHECK ("incidents"."resolved_at" is null or "incidents"."resolved_at" >= "incidents"."detected_at"),
	CONSTRAINT "incidents_title_not_blank" CHECK (length(trim("incidents"."title")) > 0),
	CONSTRAINT "incidents_payload_size_check" CHECK (octet_length("incidents"."summary") <= 8192
          and ("incidents"."impact" is null or octet_length("incidents"."impact") <= 8192)
          and octet_length("incidents"."follow_up_summary"::text) <= 32768)
);
--> statement-breakpoint
ALTER TABLE "incident_timeline_events" ADD CONSTRAINT "incident_timeline_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_timeline_events_incident_created_idx" ON "incident_timeline_events" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE INDEX "incidents_status_severity_detected_idx" ON "incidents" USING btree ("status","severity","detected_at");--> statement-breakpoint
CREATE INDEX "incidents_commander_status_idx" ON "incidents" USING btree ("commander_user_id","status");--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_incident_timeline_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'incident timeline events are immutable';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER incident_timeline_events_immutable
BEFORE UPDATE OR DELETE ON incident_timeline_events
FOR EACH ROW EXECUTE FUNCTION prevent_incident_timeline_mutation();
