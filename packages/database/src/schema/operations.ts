import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    severity: varchar('severity', { length: 8 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    summary: text('summary').notNull(),
    impact: text('impact'),
    commanderUserId: uuid('commander_user_id'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
    rootCause: text('root_cause'),
    followUpSummary: jsonb('follow_up_summary')
      .$type<Readonly<Record<string, unknown>>>()
      .default({})
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('incidents_status_severity_detected_idx').on(
      table.status,
      table.severity,
      table.detectedAt,
    ),
    index('incidents_commander_status_idx').on(
      table.commanderUserId,
      table.status,
    ),
    check(
      'incidents_severity_check',
      sql`${table.severity} in ('SEV-1', 'SEV-2', 'SEV-3', 'SEV-4')`,
    ),
    check(
      'incidents_status_check',
      sql`${table.status} in ('detected', 'acknowledged', 'mitigating', 'resolved')`,
    ),
    check(
      'incidents_resolution_consistency_check',
      sql`(${table.status} = 'resolved' and ${table.resolvedAt} is not null and ${table.resolution} is not null)
          or (${table.status} <> 'resolved' and ${table.resolvedAt} is null)`,
    ),
    check(
      'incidents_timeline_order_check',
      sql`${table.acknowledgedAt} is null or ${table.acknowledgedAt} >= ${table.detectedAt}`,
    ),
    check(
      'incidents_resolved_order_check',
      sql`${table.resolvedAt} is null or ${table.resolvedAt} >= ${table.detectedAt}`,
    ),
    check('incidents_title_not_blank', sql`length(trim(${table.title})) > 0`),
    check(
      'incidents_payload_size_check',
      sql`octet_length(${table.summary}) <= 8192
          and (${table.impact} is null or octet_length(${table.impact}) <= 8192)
          and octet_length(${table.followUpSummary}::text) <= 32768`,
    ),
  ],
);

export const incidentTimelineEvents = pgTable(
  'incident_timeline_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'restrict' }),
    sequence: bigint('sequence', { mode: 'number' }).notNull(),
    eventType: varchar('event_type', { length: 48 }).notNull(),
    message: text('message').notNull(),
    actorUserId: uuid('actor_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('incident_timeline_events_incident_sequence_unique').on(
      table.incidentId,
      table.sequence,
    ),
    index('incident_timeline_events_incident_created_idx').on(
      table.incidentId,
      table.createdAt,
    ),
    check(
      'incident_timeline_events_type_check',
      sql`${table.eventType} in ('detected', 'acknowledged', 'mitigation_started', 'mitigation_update', 'resolved', 'follow_up')`,
    ),
    check(
      'incident_timeline_events_message_size_check',
      sql`length(trim(${table.message})) > 0 and octet_length(${table.message}) <= 8192`,
    ),
  ],
);
