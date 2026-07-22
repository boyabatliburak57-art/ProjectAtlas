import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const securityUsers = pgTable(
  'security_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    normalizedEmail: varchar('normalized_email', { length: 320 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    accountStatus: varchar('account_status', { length: 24 })
      .default('active')
      .notNull(),
    roles: jsonb('roles').$type<readonly string[]>().default([]).notNull(),
    sessionVersion: integer('session_version').default(1).notNull(),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('security_users_normalized_email_unique').on(table.normalizedEmail),
    index('security_users_status_idx').on(table.accountStatus),
    check(
      'security_users_status_check',
      sql`${table.accountStatus} in ('active', 'disabled', 'locked')`,
    ),
    check(
      'security_users_session_version_check',
      sql`${table.sessionVersion} > 0`,
    ),
    check(
      'security_users_roles_size_check',
      sql`octet_length(${table.roles}::text) <= 4096`,
    ),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => securityUsers.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    csrfTokenHash: varchar('csrf_token_hash', { length: 64 }).notNull(),
    sessionVersion: integer('session_version').notNull(),
    authenticationAt: timestamp('authentication_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    idleExpiresAt: timestamp('idle_expires_at', {
      withTimezone: true,
    }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: varchar('revoke_reason', { length: 64 }),
    replacedBySessionId: uuid('replaced_by_session_id'),
    ipHash: varchar('ip_hash', { length: 64 }).notNull(),
    userAgentHash: varchar('user_agent_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('auth_sessions_token_hash_unique').on(table.tokenHash),
    index('auth_sessions_user_active_idx').on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
    index('auth_sessions_expiry_idx').on(table.expiresAt),
    check(
      'auth_sessions_expiry_order_check',
      sql`${table.expiresAt} > ${table.createdAt} and ${table.idleExpiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => securityUsers.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('password_reset_tokens_hash_unique').on(table.tokenHash),
    index('password_reset_tokens_user_expiry_idx').on(
      table.userId,
      table.expiresAt,
    ),
    check(
      'password_reset_tokens_expiry_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);

export const securityRateLimitBuckets = pgTable(
  'security_rate_limit_buckets',
  {
    subjectHash: varchar('subject_hash', { length: 64 }).notNull(),
    limitClass: varchar('limit_class', { length: 40 }).notNull(),
    windowStartedAt: timestamp('window_started_at', {
      withTimezone: true,
    }).notNull(),
    requestCount: integer('request_count').default(0).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('security_rate_limit_bucket_unique').on(
      table.subjectHash,
      table.limitClass,
      table.windowStartedAt,
    ),
    index('security_rate_limit_expiry_idx').on(table.expiresAt),
    check('security_rate_limit_count_check', sql`${table.requestCount} >= 0`),
  ],
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: varchar('key', { length: 120 }).notNull(),
    description: text('description').notNull(),
    flagType: varchar('flag_type', { length: 24 }).notNull(),
    defaultEnabled: boolean('default_enabled').default(false).notNull(),
    owner: varchar('owner', { length: 120 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('feature_flags_key_unique').on(table.key),
    check(
      'feature_flags_type_check',
      sql`${table.flagType} in ('release', 'experiment', 'kill_switch', 'entitlement', 'maintenance')`,
    ),
  ],
);

export const featureFlagVersions = pgTable(
  'feature_flag_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    flagId: uuid('flag_id')
      .notNull()
      .references(() => featureFlags.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    environment: varchar('environment', { length: 24 }).notNull(),
    enabled: boolean('enabled').notNull(),
    rolloutPercentage: numeric('rollout_percentage', {
      precision: 5,
      scale: 2,
    }),
    targetingRules: jsonb('targeting_rules')
      .$type<Readonly<Record<string, unknown>>>()
      .default({})
      .notNull(),
    reason: text('reason').notNull(),
    changedBy: uuid('changed_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('feature_flag_versions_flag_version_environment_unique').on(
      table.flagId,
      table.version,
      table.environment,
    ),
    index('feature_flag_versions_environment_idx').on(table.environment),
    check('feature_flag_versions_version_check', sql`${table.version} > 0`),
    check(
      'feature_flag_versions_rollout_check',
      sql`${table.rolloutPercentage} is null or (${table.rolloutPercentage} >= 0 and ${table.rolloutPercentage} <= 100)`,
    ),
    check(
      'feature_flag_versions_payload_size_check',
      sql`octet_length(${table.targetingRules}::text) <= 16384 and octet_length(${table.reason}) <= 4096`,
    ),
  ],
);

export const operationalAuditEvents = pgTable(
  'operational_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id'),
    actorType: varchar('actor_type', { length: 24 }).notNull(),
    action: varchar('action', { length: 120 }).notNull(),
    resourceType: varchar('resource_type', { length: 80 }).notNull(),
    resourceId: varchar('resource_id', { length: 160 }),
    environment: varchar('environment', { length: 24 }).notNull(),
    reason: text('reason'),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    requestId: varchar('request_id', { length: 128 }),
    correlationId: varchar('correlation_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('operational_audit_resource_created_idx').on(
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    index('operational_audit_actor_created_idx').on(
      table.actorUserId,
      table.createdAt,
    ),
    check(
      'operational_audit_payload_size_check',
      sql`(${table.reason} is null or octet_length(${table.reason}) <= 4096)
          and (${table.beforeState} is null or octet_length(${table.beforeState}::text) <= 32768)
          and (${table.afterState} is null or octet_length(${table.afterState}::text) <= 32768)`,
    ),
  ],
);

export const releaseRecords = pgTable(
  'release_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    version: varchar('version', { length: 128 }).notNull(),
    commitSha: varchar('commit_sha', { length: 64 }).notNull(),
    imageDigest: varchar('image_digest', { length: 80 }).notNull(),
    environment: varchar('environment', { length: 24 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    migrations: jsonb('migrations').default({}).notNull(),
    featureFlags: jsonb('feature_flags').default({}).notNull(),
    validationSummary: jsonb('validation_summary').default({}).notNull(),
    startedBy: uuid('started_by'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    rollbackOf: uuid('rollback_of'),
    rollbackReason: text('rollback_reason'),
  },
  (table) => [
    unique('release_records_environment_version_unique').on(
      table.environment,
      table.version,
    ),
    index('release_records_environment_status_idx').on(
      table.environment,
      table.status,
      table.startedAt,
    ),
    check(
      'release_records_status_check',
      sql`${table.status} in ('planned', 'deploying', 'healthy', 'failed', 'rolled_back')`,
    ),
    check(
      'release_records_digest_check',
      sql`${table.imageDigest} ~ '^sha256:[a-f0-9]{64}$'`,
    ),
    check(
      'release_records_payload_size_check',
      sql`octet_length(${table.migrations}::text) <= 32768
          and octet_length(${table.featureFlags}::text) <= 32768
          and octet_length(${table.validationSummary}::text) <= 65536`,
    ),
  ],
);

export const securitySchema = {
  authSessions,
  featureFlags,
  featureFlagVersions,
  operationalAuditEvents,
  passwordResetTokens,
  releaseRecords,
  securityRateLimitBuckets,
  securityUsers,
};
