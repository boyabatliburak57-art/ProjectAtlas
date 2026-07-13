import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { instruments } from './instrument-master';

const auditTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
};

const emptyObject = sql`'{}'::jsonb`;
const emptyArray = sql`'[]'::jsonb`;

export const scanCategories = pgTable(
  'scan_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    parentId: uuid('parent_id'),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('scan_categories_code_unique').on(table.code),
    index('scan_categories_parent_sort_idx').on(
      table.parentId,
      table.sortOrder,
    ),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'scan_categories_parent_id_fk',
    }).onDelete('restrict'),
    check(
      'scan_categories_code_not_blank',
      sql`length(trim(${table.code})) > 0`,
    ),
    check('scan_categories_sort_order_check', sql`${table.sortOrder} >= 0`),
  ],
);

export const savedScans = pgTable(
  'saved_scans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id').notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    visibility: varchar('visibility', { length: 24 })
      .default('private')
      .notNull(),
    status: varchar('status', { length: 24 }).default('active').notNull(),
    currentRevision: integer('current_revision').default(0).notNull(),
    ...auditTimestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('saved_scans_owner_status_updated_idx').on(
      table.ownerUserId,
      table.status,
      table.updatedAt.desc(),
    ),
    check(
      'saved_scans_visibility_check',
      sql`${table.visibility} in ('private', 'shared', 'public')`,
    ),
    check(
      'saved_scans_status_check',
      sql`${table.status} in ('active', 'deleted', 'archived')`,
    ),
    check(
      'saved_scans_current_revision_check',
      sql`${table.currentRevision} >= 0`,
    ),
    check(
      'saved_scans_deleted_state_check',
      sql`(${table.status} = 'deleted') = (${table.deletedAt} is not null)`,
    ),
  ],
);

export const savedScanRevisions = pgTable(
  'saved_scan_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    savedScanId: uuid('saved_scan_id')
      .notNull()
      .references(() => savedScans.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    ruleAst: jsonb('rule_ast').$type<Record<string, unknown>>().notNull(),
    complexityScore: numeric('complexity_score'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('saved_scan_revisions_scan_revision_unique').on(
      table.savedScanId,
      table.revision,
    ),
    check('saved_scan_revisions_revision_check', sql`${table.revision} >= 1`),
    check(
      'saved_scan_revisions_rule_version_check',
      sql`${table.ruleVersion} >= 1`,
    ),
    check(
      'saved_scan_revisions_complexity_check',
      sql`${table.complexityScore} is null or ${table.complexityScore} >= 0`,
    ),
  ],
);

export const savedScanTags = pgTable(
  'saved_scan_tags',
  {
    savedScanId: uuid('saved_scan_id')
      .notNull()
      .references(() => savedScans.id, { onDelete: 'cascade' }),
    tag: varchar('tag', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.savedScanId, table.tag],
      name: 'saved_scan_tags_pk',
    }),
    check('saved_scan_tags_tag_not_blank', sql`length(trim(${table.tag})) > 0`),
  ],
);

export const presetScans = pgTable(
  'preset_scans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 64 }).notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => scanCategories.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 24 }).default('draft').notNull(),
    currentRevision: integer('current_revision').default(0).notNull(),
    ...auditTimestamps,
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('preset_scans_code_unique').on(table.code),
    index('preset_scans_category_status_idx').on(
      table.categoryId,
      table.status,
    ),
    check(
      'preset_scans_status_check',
      sql`${table.status} in ('draft', 'review', 'published', 'archived')`,
    ),
    check(
      'preset_scans_current_revision_check',
      sql`${table.currentRevision} >= 0`,
    ),
  ],
);

export const presetScanRevisions = pgTable(
  'preset_scan_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    presetScanId: uuid('preset_scan_id')
      .notNull()
      .references(() => presetScans.id, { onDelete: 'restrict' }),
    revision: integer('revision').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    ruleAst: jsonb('rule_ast').$type<Record<string, unknown>>().notNull(),
    complexityScore: numeric('complexity_score').notNull(),
    lifecycleStatus: varchar('lifecycle_status', { length: 24 })
      .default('draft')
      .notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    publishedBy: uuid('published_by'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('preset_scan_revisions_scan_revision_unique').on(
      table.presetScanId,
      table.revision,
    ),
    uniqueIndex('preset_scan_revisions_one_published_unique')
      .on(table.presetScanId)
      .where(sql`${table.lifecycleStatus} = 'published'`),
    check('preset_scan_revisions_revision_check', sql`${table.revision} >= 1`),
    check(
      'preset_scan_revisions_rule_version_check',
      sql`${table.ruleVersion} >= 1`,
    ),
    check(
      'preset_scan_revisions_complexity_check',
      sql`${table.complexityScore} >= 0`,
    ),
    check(
      'preset_scan_revisions_lifecycle_check',
      sql`${table.lifecycleStatus} in ('draft', 'review', 'published', 'archived')`,
    ),
    check(
      'preset_scan_revisions_publication_check',
      sql`(${table.lifecycleStatus} = 'published') = (${table.publishedBy} is not null and ${table.publishedAt} is not null)`,
    ),
  ],
);

export const scanRuns = pgTable(
  'scan_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sourceType: varchar('source_type', { length: 24 }).notNull(),
    sourceId: uuid('source_id'),
    sourceRevision: integer('source_revision'),
    requestedBy: uuid('requested_by').notNull(),
    idempotencyKeyHash: varchar('idempotency_key_hash', {
      length: 128,
    }).notNull(),
    requestHash: varchar('request_hash', { length: 128 }).notNull(),
    status: varchar('status', { length: 24 }).default('queued').notNull(),
    executionMode: varchar('execution_mode', { length: 16 }).notNull(),
    planVersion: integer('plan_version').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    normalizedRuleAst: jsonb('normalized_rule_ast')
      .$type<Record<string, unknown>>()
      .notNull(),
    executionPlan: jsonb('execution_plan')
      .$type<Record<string, unknown>>()
      .notNull(),
    universeSnapshot: jsonb('universe_snapshot')
      .$type<Record<string, unknown>>()
      .notNull(),
    complexityScore: numeric('complexity_score').notNull(),
    dataCutoffAt: timestamp('data_cutoff_at', { withTimezone: true }).notNull(),
    queuedAt: timestamp('queued_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    timeoutAt: timestamp('timeout_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    retentionPolicy: varchar('retention_policy', { length: 32 })
      .default('standard')
      .notNull(),
    progressTotal: integer('progress_total').default(0).notNull(),
    progressProcessed: integer('progress_processed').default(0).notNull(),
    matchedCount: integer('matched_count').default(0).notNull(),
    notEvaluableCount: integer('not_evaluable_count').default(0).notNull(),
    warningCount: integer('warning_count').default(0).notNull(),
    errorCode: varchar('error_code', { length: 64 }),
    errorDetails: jsonb('error_details').$type<Record<string, unknown>>(),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('scan_runs_requester_idempotency_unique').on(
      table.requestedBy,
      table.idempotencyKeyHash,
    ),
    index('scan_runs_requested_queued_idx').on(
      table.requestedBy,
      table.queuedAt.desc(),
    ),
    index('scan_runs_status_queued_idx').on(table.status, table.queuedAt),
    index('scan_runs_terminal_expiry_idx')
      .on(table.expiresAt)
      .where(
        sql`${table.status} in ('completed', 'failed', 'cancelled', 'expired') and ${table.expiresAt} is not null`,
      ),
    check(
      'scan_runs_source_check',
      sql`${table.sourceType} in ('ad_hoc', 'saved_scan', 'preset_scan', 'admin')`,
    ),
    check(
      'scan_runs_source_reference_check',
      sql`(${table.sourceType} in ('saved_scan', 'preset_scan')) = (${table.sourceId} is not null and ${table.sourceRevision} is not null)`,
    ),
    check(
      'scan_runs_status_check',
      sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'cancel_requested', 'cancelled', 'expired')`,
    ),
    check(
      'scan_runs_execution_mode_check',
      sql`${table.executionMode} in ('sync', 'async')`,
    ),
    check(
      'scan_runs_versions_check',
      sql`${table.planVersion} >= 1 and ${table.ruleVersion} >= 1`,
    ),
    check('scan_runs_complexity_check', sql`${table.complexityScore} >= 0`),
    check(
      'scan_runs_counts_check',
      sql`${table.progressTotal} >= 0 and ${table.progressProcessed} >= 0 and ${table.progressProcessed} <= ${table.progressTotal} and ${table.matchedCount} >= 0 and ${table.matchedCount} <= ${table.progressProcessed} and ${table.notEvaluableCount} >= 0 and ${table.notEvaluableCount} <= ${table.progressProcessed} and ${table.warningCount} >= 0`,
    ),
    check(
      'scan_runs_timestamps_check',
      sql`(${table.startedAt} is null or ${table.startedAt} >= ${table.queuedAt}) and (${table.completedAt} is null or ${table.startedAt} is not null and ${table.completedAt} >= ${table.startedAt}) and (${table.cancelledAt} is null or ${table.cancelRequestedAt} is not null and ${table.cancelledAt} >= ${table.cancelRequestedAt})`,
    ),
  ],
);

export const scanRunBatches = pgTable(
  'scan_run_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scanRunId: uuid('scan_run_id')
      .notNull()
      .references(() => scanRuns.id, { onDelete: 'cascade' }),
    batchIndex: integer('batch_index').notNull(),
    planVersion: integer('plan_version').notNull(),
    status: varchar('status', { length: 24 }).default('queued').notNull(),
    instrumentIds: jsonb('instrument_ids').$type<readonly string[]>(),
    snapshotSegmentReference: varchar('snapshot_segment_reference', {
      length: 255,
    }),
    attempt: integer('attempt').default(0).notNull(),
    queuedAt: timestamp('queued_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorCode: varchar('error_code', { length: 64 }),
    processedCount: integer('processed_count').default(0).notNull(),
    matchedCount: integer('matched_count').default(0).notNull(),
    notEvaluableCount: integer('not_evaluable_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('scan_run_batches_run_batch_unique').on(
      table.scanRunId,
      table.batchIndex,
    ),
    index('scan_run_batches_run_status_idx').on(table.scanRunId, table.status),
    check('scan_run_batches_index_check', sql`${table.batchIndex} >= 0`),
    check(
      'scan_run_batches_plan_version_check',
      sql`${table.planVersion} >= 1`,
    ),
    check(
      'scan_run_batches_status_check',
      sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      'scan_run_batches_source_check',
      sql`num_nonnulls(${table.instrumentIds}, ${table.snapshotSegmentReference}) = 1`,
    ),
    check('scan_run_batches_attempt_check', sql`${table.attempt} >= 0`),
    check(
      'scan_run_batches_counts_check',
      sql`${table.processedCount} >= 0 and ${table.matchedCount} >= 0 and ${table.matchedCount} <= ${table.processedCount} and ${table.notEvaluableCount} >= 0 and ${table.notEvaluableCount} <= ${table.processedCount}`,
    ),
  ],
);

export const scanResults = pgTable(
  'scan_results',
  {
    id: bigint('id', { mode: 'bigint' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    scanRunId: uuid('scan_run_id')
      .notNull()
      .references(() => scanRuns.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    rank: integer('rank'),
    status: varchar('status', { length: 24 }).notNull(),
    computedValues: jsonb('computed_values')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    explanation: jsonb('explanation')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    warnings: jsonb('warnings')
      .$type<readonly Record<string, unknown>[]>()
      .default(emptyArray)
      .notNull(),
    dataCutoffAt: timestamp('data_cutoff_at', { withTimezone: true }).notNull(),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    sourceBatchIndex: integer('source_batch_index').notNull(),
    resultVersion: integer('result_version').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('scan_results_run_instrument_unique').on(
      table.scanRunId,
      table.instrumentId,
    ),
    index('scan_results_run_rank_idx').on(table.scanRunId, table.rank),
    index('scan_results_instrument_created_idx').on(
      table.instrumentId,
      table.createdAt.desc(),
    ),
    check(
      'scan_results_status_check',
      sql`${table.status} in ('matched', 'not_matched', 'not_evaluable')`,
    ),
    check(
      'scan_results_rank_check',
      sql`${table.rank} is null or ${table.rank} >= 1`,
    ),
    check(
      'scan_results_source_batch_check',
      sql`${table.sourceBatchIndex} >= 0`,
    ),
    check('scan_results_version_check', sql`${table.resultVersion} >= 1`),
  ],
);

export const scanRunEvents = pgTable(
  'scan_run_events',
  {
    id: bigint('id', { mode: 'bigint' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    scanRunId: uuid('scan_run_id')
      .notNull()
      .references(() => scanRuns.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    fromStatus: varchar('from_status', { length: 24 }),
    toStatus: varchar('to_status', { length: 24 }),
    actorUserId: uuid('actor_user_id'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('scan_run_events_run_occurred_idx').on(
      table.scanRunId,
      table.occurredAt,
    ),
    check(
      'scan_run_events_transition_check',
      sql`(${table.fromStatus} is null and ${table.toStatus} is null) or (${table.toStatus} is not null)`,
    ),
  ],
);
