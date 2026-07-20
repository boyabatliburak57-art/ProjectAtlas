import { desc, sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  boolean,
} from 'drizzle-orm/pg-core';

import { dataProviders, instruments } from './instrument-master';

const auditTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const priceBars = pgTable(
  'price_bars',
  {
    id: bigint('id', { mode: 'bigint' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => dataProviders.id, { onDelete: 'restrict' }),
    timeframe: varchar('timeframe', { length: 16 }).notNull(),
    openTime: timestamp('open_time', { withTimezone: true }).notNull(),
    closeTime: timestamp('close_time', { withTimezone: true }).notNull(),
    open: numeric('open').notNull(),
    high: numeric('high').notNull(),
    low: numeric('low').notNull(),
    close: numeric('close').notNull(),
    volume: numeric('volume').notNull(),
    isClosed: boolean('is_closed').default(false).notNull(),
    sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    qualityStatus: varchar('quality_status', { length: 24 })
      .default('accepted')
      .notNull(),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('price_bars_natural_revision_unique').on(
      table.instrumentId,
      table.providerId,
      table.timeframe,
      table.openTime,
      table.revision,
    ),
    index('price_bars_instrument_timeframe_open_time_idx').on(
      table.instrumentId,
      table.timeframe,
      table.openTime.desc(),
    ),
    index('price_bars_timeframe_open_time_idx').on(
      table.timeframe,
      table.openTime.desc(),
    ),
    index('price_bars_provider_ingested_at_idx').on(
      table.providerId,
      table.ingestedAt.desc(),
    ),
    index('price_bars_snapshot_resolution_idx').on(
      table.providerId,
      table.timeframe,
      table.instrumentId,
      table.openTime,
      table.revision.desc(),
    ),
    check('price_bars_volume_check', sql`${table.volume} >= 0`),
    check('price_bars_revision_check', sql`${table.revision} >= 1`),
    check('price_bars_time_check', sql`${table.closeTime} > ${table.openTime}`),
    check(
      'price_bars_ohlc_check',
      sql`${table.high} >= greatest(${table.open}, ${table.close}, ${table.low}) and ${table.low} <= least(${table.open}, ${table.close}, ${table.high})`,
    ),
    check(
      'price_bars_quality_status_check',
      sql`${table.qualityStatus} in ('accepted', 'provisional', 'corrected')`,
    ),
  ],
);

export const currentPriceBars = pgView('current_price_bars').as((query) =>
  query
    .selectDistinctOn([
      priceBars.instrumentId,
      priceBars.providerId,
      priceBars.timeframe,
      priceBars.openTime,
    ])
    .from(priceBars)
    .orderBy(
      priceBars.instrumentId,
      priceBars.providerId,
      priceBars.timeframe,
      priceBars.openTime,
      desc(priceBars.revision),
    ),
);

export const dataQualityIssues = pgTable(
  'data_quality_issues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerId: uuid('provider_id').references(() => dataProviders.id, {
      onDelete: 'set null',
    }),
    instrumentId: uuid('instrument_id').references(() => instruments.id, {
      onDelete: 'set null',
    }),
    timeframe: varchar('timeframe', { length: 16 }),
    openTime: timestamp('open_time', { withTimezone: true }),
    issueType: varchar('issue_type', { length: 64 }).notNull(),
    severity: varchar('severity', { length: 24 }).notNull(),
    details: jsonb('details')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    ...auditTimestamps,
  },
  (table) => [
    index('data_quality_issues_unresolved_idx')
      .on(table.detectedAt.desc())
      .where(sql`${table.resolvedAt} is null`),
    index('data_quality_issues_instrument_time_idx').on(
      table.instrumentId,
      table.openTime,
    ),
    check(
      'data_quality_issues_severity_check',
      sql`${table.severity} in ('info', 'warning', 'error', 'critical')`,
    ),
    check(
      'data_quality_issues_resolution_time_check',
      sql`${table.resolvedAt} is null or ${table.resolvedAt} >= ${table.detectedAt}`,
    ),
  ],
);

export const ingestionRuns = pgTable(
  'ingestion_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => dataProviders.id, { onDelete: 'restrict' }),
    jobType: varchar('job_type', { length: 64 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    requestedFrom: timestamp('requested_from', { withTimezone: true }),
    requestedTo: timestamp('requested_to', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    fetchedCount: integer('fetched_count').default(0).notNull(),
    acceptedCount: integer('accepted_count').default(0).notNull(),
    rejectedCount: integer('rejected_count').default(0).notNull(),
    errorCode: varchar('error_code', { length: 64 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    ...auditTimestamps,
  },
  (table) => [
    index('ingestion_runs_provider_started_at_idx').on(
      table.providerId,
      table.startedAt.desc(),
    ),
    check(
      'ingestion_runs_status_check',
      sql`${table.status} in ('pending', 'running', 'completed', 'failed')`,
    ),
    check(
      'ingestion_runs_counts_check',
      sql`${table.fetchedCount} >= 0 and ${table.acceptedCount} >= 0 and ${table.rejectedCount} >= 0`,
    ),
    check(
      'ingestion_runs_request_range_check',
      sql`${table.requestedTo} is null or ${table.requestedFrom} is null or ${table.requestedTo} >= ${table.requestedFrom}`,
    ),
    check(
      'ingestion_runs_completion_time_check',
      sql`${table.completedAt} is null or ${table.completedAt} >= ${table.startedAt}`,
    ),
  ],
);
