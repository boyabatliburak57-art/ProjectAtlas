import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { dataProviders, instruments, sectors } from './instrument-master';

const emptyObject = sql`'{}'::jsonb`;
const emptyArray = sql`'[]'::jsonb`;
const financialValue = (name: string) =>
  numeric(name, { precision: 28, scale: 10 });
const ratioValue = (name: string) =>
  numeric(name, { precision: 20, scale: 12 });

const snapshotContext = () => ({
  generationId: uuid('generation_id').notNull(),
  policyVersion: varchar('policy_version', { length: 64 }).notNull(),
  dataCutoffAt: timestamp('data_cutoff_at', { withTimezone: true }).notNull(),
});

const qualityMetadata = () =>
  jsonb('quality_metadata')
    .$type<Record<string, unknown>>()
    .default(emptyObject)
    .notNull();

export const marketOverviewSnapshots = pgTable(
  'market_overview_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketCode: varchar('market_code', { length: 32 }).notNull(),
    timeframe: varchar('timeframe', { length: 16 }).notNull(),
    universeVersion: varchar('universe_version', { length: 64 }).notNull(),
    ...snapshotContext(),
    sourceTimestamp: timestamp('source_timestamp', { withTimezone: true }),
    status: varchar('status', { length: 24 }).notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    evaluatedCount: integer('evaluated_count').default(0).notNull(),
    excludedCount: integer('excluded_count').default(0).notNull(),
    qualityMetadata: qualityMetadata(),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('market_overview_snapshots_identity_unique').on(
      table.marketCode,
      table.timeframe,
      table.universeVersion,
      table.dataCutoffAt,
      table.policyVersion,
    ),
    unique('market_overview_snapshots_generation_context_unique').on(
      table.generationId,
      table.marketCode,
      table.timeframe,
      table.policyVersion,
      table.dataCutoffAt,
    ),
    index('market_overview_snapshots_market_cutoff_idx').on(
      table.marketCode,
      table.timeframe,
      table.dataCutoffAt.desc(),
    ),
    index('market_overview_snapshots_generation_idx').on(table.generationId),
    check(
      'market_overview_snapshots_status_check',
      sql`${table.status} in ('complete', 'partial', 'stale', 'not_evaluable', 'invalidated')`,
    ),
    check(
      'market_overview_snapshots_counts_check',
      sql`${table.evaluatedCount} >= 0 and ${table.excludedCount} >= 0`,
    ),
    check(
      'market_overview_snapshots_versions_not_blank',
      sql`length(trim(${table.universeVersion})) > 0 and length(trim(${table.policyVersion})) > 0`,
    ),
    check(
      'market_overview_snapshots_invalidation_check',
      sql`(${table.status} = 'invalidated') = (${table.invalidatedAt} is not null)`,
    ),
  ],
);

export const sectorMarketSnapshots = pgTable(
  'sector_market_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketCode: varchar('market_code', { length: 32 }).notNull(),
    timeframe: varchar('timeframe', { length: 16 }).notNull(),
    ...snapshotContext(),
    sectorId: uuid('sector_id')
      .notNull()
      .references(() => sectors.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 24 }).notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    evaluatedCount: integer('evaluated_count').default(0).notNull(),
    excludedCount: integer('excluded_count').default(0).notNull(),
    qualityMetadata: qualityMetadata(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('sector_market_snapshots_generation_sector_unique').on(
      table.generationId,
      table.sectorId,
    ),
    index('sector_market_snapshots_generation_idx').on(table.generationId),
    index('sector_market_snapshots_sector_cutoff_idx').on(
      table.sectorId,
      table.dataCutoffAt.desc(),
    ),
    foreignKey({
      columns: [
        table.generationId,
        table.marketCode,
        table.timeframe,
        table.policyVersion,
        table.dataCutoffAt,
      ],
      foreignColumns: [
        marketOverviewSnapshots.generationId,
        marketOverviewSnapshots.marketCode,
        marketOverviewSnapshots.timeframe,
        marketOverviewSnapshots.policyVersion,
        marketOverviewSnapshots.dataCutoffAt,
      ],
      name: 'sector_market_snapshots_generation_context_fk',
    }).onDelete('cascade'),
    check(
      'sector_market_snapshots_status_check',
      sql`${table.status} in ('complete', 'partial', 'stale', 'not_evaluable')`,
    ),
    check(
      'sector_market_snapshots_counts_check',
      sql`${table.evaluatedCount} >= 0 and ${table.excludedCount} >= 0`,
    ),
  ],
);

export const marketRankSnapshots = pgTable(
  'market_rank_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    marketCode: varchar('market_code', { length: 32 }).notNull(),
    timeframe: varchar('timeframe', { length: 16 }).notNull(),
    ...snapshotContext(),
    rankingType: varchar('ranking_type', { length: 40 }).notNull(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    rank: integer('rank').notNull(),
    sortValue: financialValue('sort_value').notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    evaluatedCount: integer('evaluated_count').default(0).notNull(),
    excludedCount: integer('excluded_count').default(0).notNull(),
    qualityMetadata: qualityMetadata(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('market_rank_snapshots_generation_type_instrument_unique').on(
      table.generationId,
      table.rankingType,
      table.instrumentId,
    ),
    unique('market_rank_snapshots_generation_type_rank_unique').on(
      table.generationId,
      table.rankingType,
      table.rank,
    ),
    index('market_rank_snapshots_type_generation_rank_idx').on(
      table.rankingType,
      table.generationId,
      table.rank,
    ),
    index('market_rank_snapshots_instrument_cutoff_idx').on(
      table.instrumentId,
      table.dataCutoffAt.desc(),
    ),
    foreignKey({
      columns: [
        table.generationId,
        table.marketCode,
        table.timeframe,
        table.policyVersion,
        table.dataCutoffAt,
      ],
      foreignColumns: [
        marketOverviewSnapshots.generationId,
        marketOverviewSnapshots.marketCode,
        marketOverviewSnapshots.timeframe,
        marketOverviewSnapshots.policyVersion,
        marketOverviewSnapshots.dataCutoffAt,
      ],
      name: 'market_rank_snapshots_generation_context_fk',
    }).onDelete('cascade'),
    check('market_rank_snapshots_rank_check', sql`${table.rank} >= 1`),
    check(
      'market_rank_snapshots_sort_value_check',
      sql`${table.sortValue} <> 'NaN'::numeric`,
    ),
    check(
      'market_rank_snapshots_status_check',
      sql`${table.status} in ('complete', 'partial', 'stale', 'not_evaluable')`,
    ),
    check(
      'market_rank_snapshots_counts_check',
      sql`${table.evaluatedCount} >= 0 and ${table.excludedCount} >= 0`,
    ),
  ],
);

export const fundamentalStatementSnapshots = pgTable(
  'fundamental_statement_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => dataProviders.id, { onDelete: 'restrict' }),
    statementType: varchar('statement_type', { length: 40 }).notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    fiscalPeriod: varchar('fiscal_period', { length: 24 }).notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    currencyCode: varchar('currency_code', { length: 3 }).notNull(),
    unitScale: financialValue('unit_scale').notNull(),
    providerRevision: varchar('provider_revision', { length: 128 }).notNull(),
    ...snapshotContext(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull(),
    sourceTimestamp: timestamp('source_timestamp', {
      withTimezone: true,
    }).notNull(),
    normalizedPayload: jsonb('normalized_payload')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    qualityStatus: varchar('quality_status', { length: 24 }).notNull(),
    qualityMetadata: qualityMetadata(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('fundamental_statement_snapshots_revision_unique').on(
      table.instrumentId,
      table.providerId,
      table.statementType,
      table.fiscalYear,
      table.fiscalPeriod,
      table.providerRevision,
    ),
    unique('fundamental_statement_snapshots_metric_context_unique').on(
      table.id,
      table.generationId,
      table.policyVersion,
      table.dataCutoffAt,
    ),
    index('fundamental_statement_snapshots_instrument_period_idx').on(
      table.instrumentId,
      table.statementType,
      table.fiscalYear.desc(),
      table.fiscalPeriod,
    ),
    index('fundamental_statement_snapshots_provider_revision_idx').on(
      table.providerId,
      table.providerRevision,
    ),
    check(
      'fundamental_statement_snapshots_period_check',
      sql`${table.periodEnd} >= ${table.periodStart}`,
    ),
    check(
      'fundamental_statement_snapshots_unit_scale_check',
      sql`${table.unitScale} <> 'NaN'::numeric and ${table.unitScale} > 0`,
    ),
    check(
      'fundamental_statement_snapshots_quality_check',
      sql`${table.qualityStatus} in ('complete', 'partial', 'not_evaluable')`,
    ),
  ],
);

export const fundamentalMetricSnapshots = pgTable(
  'fundamental_metric_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    statementSnapshotId: uuid('statement_snapshot_id').notNull(),
    ...snapshotContext(),
    metricCode: varchar('metric_code', { length: 64 }).notNull(),
    value: financialValue('value'),
    status: varchar('status', { length: 24 }).notNull(),
    reasonCode: varchar('reason_code', { length: 64 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    qualityMetadata: qualityMetadata(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('fundamental_metric_snapshots_statement_metric_unique').on(
      table.statementSnapshotId,
      table.metricCode,
    ),
    index('fundamental_metric_snapshots_metric_cutoff_idx').on(
      table.metricCode,
      table.dataCutoffAt.desc(),
    ),
    foreignKey({
      columns: [
        table.statementSnapshotId,
        table.generationId,
        table.policyVersion,
        table.dataCutoffAt,
      ],
      foreignColumns: [
        fundamentalStatementSnapshots.id,
        fundamentalStatementSnapshots.generationId,
        fundamentalStatementSnapshots.policyVersion,
        fundamentalStatementSnapshots.dataCutoffAt,
      ],
      name: 'fundamental_metric_snapshots_statement_context_fk',
    }).onDelete('restrict'),
    check(
      'fundamental_metric_snapshots_status_check',
      sql`${table.status} in ('complete', 'missing', 'not_evaluable')`,
    ),
    check(
      'fundamental_metric_snapshots_value_status_check',
      sql`(${table.status} = 'complete' and ${table.value} is not null and ${table.value} <> 'NaN'::numeric and ${table.reasonCode} is null) or (${table.status} <> 'complete' and ${table.value} is null and ${table.reasonCode} is not null)`,
    ),
  ],
);

export const fundamentalRatioSnapshots = pgTable(
  'fundamental_ratio_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    ...snapshotContext(),
    ratioCode: varchar('ratio_code', { length: 64 }).notNull(),
    formulaVersion: varchar('formula_version', { length: 64 }).notNull(),
    fiscalPeriodReference: varchar('fiscal_period_reference', {
      length: 64,
    }).notNull(),
    marketDataCutoffAt: timestamp('market_data_cutoff_at', {
      withTimezone: true,
    }),
    value: ratioValue('value'),
    status: varchar('status', { length: 24 }).notNull(),
    reasonCode: varchar('reason_code', { length: 64 }),
    inputs: jsonb('inputs')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    qualityMetadata: qualityMetadata(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('fundamental_ratio_snapshots_formula_identity_unique').on(
      table.instrumentId,
      table.ratioCode,
      table.formulaVersion,
      table.fiscalPeriodReference,
      table.dataCutoffAt,
    ),
    index('fundamental_ratio_snapshots_instrument_ratio_period_idx').on(
      table.instrumentId,
      table.ratioCode,
      table.fiscalPeriodReference,
      table.dataCutoffAt.desc(),
    ),
    check(
      'fundamental_ratio_snapshots_status_check',
      sql`${table.status} in ('complete', 'missing', 'not_evaluable')`,
    ),
    check(
      'fundamental_ratio_snapshots_value_status_check',
      sql`(${table.status} = 'complete' and ${table.value} is not null and ${table.value} <> 'NaN'::numeric and ${table.reasonCode} is null) or (${table.status} <> 'complete' and ${table.value} is null and ${table.reasonCode} is not null)`,
    ),
  ],
);

export const patternDefinitions = pgTable(
  'pattern_definitions',
  {
    code: varchar('code', { length: 64 }).notNull(),
    version: integer('version').notNull(),
    algorithmVersion: varchar('algorithm_version', { length: 64 }).notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    parameterSchema: jsonb('parameter_schema')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    evidenceSchemaVersion: integer('evidence_schema_version')
      .default(1)
      .notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.code, table.version],
      name: 'pattern_definitions_pk',
    }),
    check('pattern_definitions_version_check', sql`${table.version} >= 1`),
    check(
      'pattern_definitions_evidence_version_check',
      sql`${table.evidenceSchemaVersion} >= 1`,
    ),
    check(
      'pattern_definitions_status_check',
      sql`${table.status} in ('active', 'deprecated', 'disabled')`,
    ),
  ],
);

export const patternInstances = pgTable(
  'pattern_instances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    timeframe: varchar('timeframe', { length: 16 }).notNull(),
    adjustmentMode: varchar('adjustment_mode', { length: 32 }).notNull(),
    patternCode: varchar('pattern_code', { length: 64 }).notNull(),
    patternVersion: integer('pattern_version').notNull(),
    algorithmVersion: varchar('algorithm_version', { length: 64 }).notNull(),
    state: varchar('state', { length: 24 }).notNull(),
    direction: varchar('direction', { length: 24 }).notNull(),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }).notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    dataCutoffAt: timestamp('data_cutoff_at', { withTimezone: true }).notNull(),
    confidence: numeric('confidence', { precision: 7, scale: 4 }),
    evidenceVersion: integer('evidence_version').default(1).notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull(),
    deduplicationKey: varchar('deduplication_key', {
      length: 160,
    }).notNull(),
    warnings: jsonb('warnings')
      .$type<readonly Record<string, unknown>[]>()
      .default(emptyArray)
      .notNull(),
    qualityMetadata: qualityMetadata(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('pattern_instances_deduplication_key_unique').on(
      table.deduplicationKey,
    ),
    index('pattern_instances_instrument_timeframe_detected_idx').on(
      table.instrumentId,
      table.timeframe,
      table.detectedAt.desc(),
    ),
    index('pattern_instances_code_state_detected_idx').on(
      table.patternCode,
      table.state,
      table.detectedAt.desc(),
    ),
    foreignKey({
      columns: [table.patternCode, table.patternVersion],
      foreignColumns: [patternDefinitions.code, patternDefinitions.version],
      name: 'pattern_instances_definition_fk',
    }).onDelete('restrict'),
    check(
      'pattern_instances_adjustment_mode_check',
      sql`${table.adjustmentMode} in ('raw', 'split_adjusted', 'total_return_adjusted')`,
    ),
    check(
      'pattern_instances_state_check',
      sql`${table.state} in ('candidate', 'confirmed', 'invalidated')`,
    ),
    check(
      'pattern_instances_direction_check',
      sql`${table.direction} in ('bullish', 'bearish', 'neutral')`,
    ),
    check(
      'pattern_instances_time_check',
      sql`${table.endTime} >= ${table.startTime} and ${table.detectedAt} >= ${table.endTime} and ${table.dataCutoffAt} >= ${table.endTime}`,
    ),
    check(
      'pattern_instances_transition_check',
      sql`(${table.state} = 'candidate' and ${table.confirmedAt} is null and ${table.invalidatedAt} is null) or (${table.state} = 'confirmed' and ${table.confirmedAt} is not null and ${table.invalidatedAt} is null) or (${table.state} = 'invalidated' and ${table.invalidatedAt} is not null and ${table.confirmedAt} is null)`,
    ),
    check(
      'pattern_instances_confidence_check',
      sql`${table.confidence} is null or (${table.confidence} <> 'NaN'::numeric and ${table.confidence} >= 0 and ${table.confidence} <= 100)`,
    ),
    check(
      'pattern_instances_evidence_version_check',
      sql`${table.evidenceVersion} >= 1`,
    ),
    check(
      'pattern_instances_evidence_shape_check',
      sql`jsonb_typeof(${table.evidence}) = 'object' and ${table.evidence} ? 'schemaVersion'`,
    ),
  ],
);
