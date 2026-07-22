import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { securityUsers } from './security';

export const backupStatusChecks = pgTable(
  'backup_status_checks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    environment: varchar('environment', { length: 24 }).notNull(),
    providerAdapter: varchar('provider_adapter', { length: 80 }).notNull(),
    backupReference: varchar('backup_reference', { length: 256 }).notNull(),
    backupCreatedAt: timestamp('backup_created_at', {
      withTimezone: true,
    }).notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    encrypted: boolean('encrypted').notNull(),
    pitrEnabled: boolean('pitr_enabled').notNull(),
    separateFailureDomain: boolean('separate_failure_domain').notNull(),
    retentionDays: integer('retention_days').notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    failureCode: varchar('failure_code', { length: 80 }),
    metadata: jsonb('metadata')
      .$type<Readonly<Record<string, unknown>>>()
      .default({})
      .notNull(),
  },
  (table) => [
    unique('backup_status_environment_reference_unique').on(
      table.environment,
      table.backupReference,
    ),
    index('backup_status_environment_checked_idx').on(
      table.environment,
      table.checkedAt,
    ),
    check(
      'backup_status_environment_check',
      sql`${table.environment} in ('local', 'test', 'staging', 'production', 'recovery')`,
    ),
    check(
      'backup_status_status_check',
      sql`${table.status} in ('healthy', 'failed', 'stale', 'unknown')`,
    ),
    check(
      'backup_status_retention_check',
      sql`${table.retentionDays} between 1 and 3650`,
    ),
    check(
      'backup_status_failure_check',
      sql`(${table.status} = 'healthy' and ${table.failureCode} is null) or ${table.status} <> 'healthy'`,
    ),
    check(
      'backup_status_metadata_size_check',
      sql`octet_length(${table.metadata}::text) <= 16384`,
    ),
  ],
);

export const recoveryDrills = pgTable(
  'recovery_drills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    drillType: varchar('drill_type', { length: 40 }).notNull(),
    environment: varchar('environment', { length: 24 }).notNull(),
    backupReference: varchar('backup_reference', { length: 256 }),
    sourceCutoffAt: timestamp('source_cutoff_at', { withTimezone: true }),
    targetRpoSeconds: integer('target_rpo_seconds'),
    achievedRpoSeconds: integer('achieved_rpo_seconds'),
    targetRtoSeconds: integer('target_rto_seconds'),
    achievedRtoSeconds: integer('achieved_rto_seconds'),
    status: varchar('status', { length: 24 }).notNull(),
    validationSummary: jsonb('validation_summary')
      .$type<Readonly<Record<string, unknown>>>()
      .default({})
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cleanupCompletedAt: timestamp('cleanup_completed_at', {
      withTimezone: true,
    }),
    executedBy: uuid('executed_by').references(() => securityUsers.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    index('recovery_drills_environment_status_completed_idx').on(
      table.environment,
      table.status,
      table.completedAt,
    ),
    check(
      'recovery_drills_type_check',
      sql`${table.drillType} in ('postgres_pitr', 'postgres_backup', 'object_restore', 'redis_loss', 'full')`,
    ),
    check(
      'recovery_drills_environment_check',
      sql`${table.environment} in ('local', 'test', 'staging', 'production', 'recovery')`,
    ),
    check(
      'recovery_drills_status_check',
      sql`${table.status} in ('planned', 'running', 'passed', 'failed', 'cancelled')`,
    ),
    check(
      'recovery_drills_duration_check',
      sql`${table.targetRpoSeconds} is null or ${table.targetRpoSeconds} >= 0`,
    ),
    check(
      'recovery_drills_rpo_check',
      sql`${table.achievedRpoSeconds} is null or ${table.achievedRpoSeconds} >= 0`,
    ),
    check(
      'recovery_drills_rto_target_check',
      sql`${table.targetRtoSeconds} is null or ${table.targetRtoSeconds} > 0`,
    ),
    check(
      'recovery_drills_rto_check',
      sql`${table.achievedRtoSeconds} is null or ${table.achievedRtoSeconds} >= 0`,
    ),
    check(
      'recovery_drills_terminal_check',
      sql`(${table.status} in ('passed', 'failed', 'cancelled') and ${table.completedAt} is not null)
          or (${table.status} in ('planned', 'running') and ${table.completedAt} is null)`,
    ),
    check(
      'recovery_drills_summary_size_check',
      sql`octet_length(${table.validationSummary}::text) <= 65536`,
    ),
  ],
);

export const retentionJobRuns = pgTable(
  'retention_job_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionKey: varchar('execution_key', { length: 160 }).notNull(),
    policyCode: varchar('policy_code', { length: 80 }).notNull(),
    policyVersion: varchar('policy_version', { length: 40 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    scannedCount: bigint('scanned_count', { mode: 'number' })
      .default(0)
      .notNull(),
    deletedCount: bigint('deleted_count', { mode: 'number' })
      .default(0)
      .notNull(),
    skippedCount: bigint('skipped_count', { mode: 'number' })
      .default(0)
      .notNull(),
    errorSummary: jsonb('error_summary')
      .$type<Readonly<Record<string, unknown>>>()
      .default({})
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    unique('retention_job_runs_execution_key_unique').on(table.executionKey),
    index('retention_job_runs_policy_status_started_idx').on(
      table.policyCode,
      table.status,
      table.startedAt,
    ),
    check(
      'retention_job_runs_status_check',
      sql`${table.status} in ('running', 'completed', 'failed')`,
    ),
    check(
      'retention_job_runs_counts_check',
      sql`${table.scannedCount} >= 0 and ${table.deletedCount} >= 0 and ${table.skippedCount} >= 0`,
    ),
    check(
      'retention_job_runs_terminal_check',
      sql`(${table.status} = 'running' and ${table.completedAt} is null)
          or (${table.status} in ('completed', 'failed') and ${table.completedAt} is not null)`,
    ),
    check(
      'retention_job_runs_error_size_check',
      sql`octet_length(${table.errorSummary}::text) <= 32768`,
    ),
  ],
);

export const legalHolds = pgTable(
  'legal_holds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scopeType: varchar('scope_type', { length: 40 }).notNull(),
    scopeId: varchar('scope_id', { length: 160 }).notNull(),
    reason: text('reason').notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => securityUsers.id, {
      onDelete: 'set null',
    }),
    releasedBy: uuid('released_by').references(() => securityUsers.id, {
      onDelete: 'set null',
    }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    index('legal_holds_scope_status_idx').on(
      table.scopeType,
      table.scopeId,
      table.status,
    ),
    check(
      'legal_holds_status_check',
      sql`${table.status} in ('active', 'released', 'expired')`,
    ),
    check(
      'legal_holds_reason_size_check',
      sql`length(trim(${table.reason})) > 0 and octet_length(${table.reason}) <= 4096`,
    ),
    check(
      'legal_holds_release_check',
      sql`(${table.status} = 'released' and ${table.releasedAt} is not null) or ${table.status} <> 'released'`,
    ),
  ],
);

export const storedArtifacts = pgTable(
  'stored_artifacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id').references(() => securityUsers.id, {
      onDelete: 'set null',
    }),
    artifactType: varchar('artifact_type', { length: 40 }).notNull(),
    objectKey: varchar('object_key', { length: 512 }).notNull(),
    version: integer('version').notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    encryptionKeyReference: varchar('encryption_key_reference', {
      length: 256,
    }).notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    retentionUntil: timestamp('retention_until', { withTimezone: true }),
    orphanedAt: timestamp('orphaned_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('stored_artifacts_object_version_unique').on(
      table.objectKey,
      table.version,
    ),
    index('stored_artifacts_owner_status_idx').on(
      table.ownerUserId,
      table.status,
      table.createdAt,
    ),
    index('stored_artifacts_retention_idx').on(
      table.status,
      table.retentionUntil,
    ),
    check(
      'stored_artifacts_type_check',
      sql`${table.artifactType} in ('backtest_series', 'export', 'import', 'error_report', 'recovery')`,
    ),
    check(
      'stored_artifacts_status_check',
      sql`${table.status} in ('active', 'orphaned', 'deleted')`,
    ),
    check('stored_artifacts_version_check', sql`${table.version} > 0`),
    check('stored_artifacts_size_check', sql`${table.byteSize} >= 0`),
    check(
      'stored_artifacts_checksum_check',
      sql`${table.checksumSha256} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'stored_artifacts_deleted_check',
      sql`(${table.status} = 'deleted' and ${table.deletedAt} is not null) or ${table.status} <> 'deleted'`,
    ),
  ],
);

export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => securityUsers.id, {
      onDelete: 'set null',
    }),
    subjectHash: varchar('subject_hash', { length: 64 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 160 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    graceUntil: timestamp('grace_until', { withTimezone: true }).notNull(),
    purgeStartedAt: timestamp('purge_started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').default(0).notNull(),
    lastErrorCode: varchar('last_error_code', { length: 80 }),
  },
  (table) => [
    unique('account_deletion_requests_idempotency_unique').on(
      table.idempotencyKey,
    ),
    index('account_deletion_requests_status_grace_idx').on(
      table.status,
      table.graceUntil,
    ),
    check(
      'account_deletion_requests_status_check',
      sql`${table.status} in ('pending', 'disabled', 'purging', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      'account_deletion_requests_subject_hash_check',
      sql`${table.subjectHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      'account_deletion_requests_grace_check',
      sql`${table.graceUntil} >= ${table.requestedAt}`,
    ),
    check(
      'account_deletion_requests_attempt_check',
      sql`${table.attemptCount} >= 0`,
    ),
    check(
      'account_deletion_requests_completed_check',
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null and ${table.userId} is null)
          or ${table.status} <> 'completed'`,
    ),
  ],
);

export const recoverySchema = {
  accountDeletionRequests,
  backupStatusChecks,
  legalHolds,
  recoveryDrills,
  retentionJobRuns,
  storedArtifacts,
};
