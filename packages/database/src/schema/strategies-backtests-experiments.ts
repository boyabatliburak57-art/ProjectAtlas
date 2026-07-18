import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { instruments } from './instrument-master';

const emptyObject = sql`'{}'::jsonb`;
const emptyArray = sql`'[]'::jsonb`;
const money = (name: string) => numeric(name, { precision: 28, scale: 10 });
const ratio = (name: string) => numeric(name, { precision: 20, scale: 12 });

const auditTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const strategies = pgTable(
  'strategies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id').notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    visibility: varchar('visibility', { length: 24 })
      .default('private')
      .notNull(),
    status: varchar('status', { length: 24 }).default('draft').notNull(),
    currentRevision: integer('current_revision').default(0).notNull(),
    ...auditTimestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('strategies_id_owner_unique').on(table.id, table.ownerUserId),
    index('strategies_owner_status_updated_idx').on(
      table.ownerUserId,
      table.status,
      table.updatedAt.desc(),
    ),
    check('strategies_name_not_blank', sql`length(trim(${table.name})) > 0`),
    check('strategies_visibility_check', sql`${table.visibility} = 'private'`),
    check(
      'strategies_status_check',
      sql`${table.status} in ('draft', 'validated', 'archived', 'deleted')`,
    ),
    check(
      'strategies_current_revision_check',
      sql`${table.currentRevision} >= 0`,
    ),
    check(
      'strategies_deleted_state_check',
      sql`(${table.status} = 'deleted') = (${table.deletedAt} is not null)`,
    ),
  ],
);

export const strategyRevisions = pgTable(
  'strategy_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    strategyId: uuid('strategy_id').notNull(),
    revision: integer('revision').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    parameterSchema: jsonb('parameter_schema')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    validationStatus: varchar('validation_status', { length: 24 })
      .default('draft')
      .notNull(),
    complexityScore: integer('complexity_score').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('strategy_revisions_strategy_revision_unique').on(
      table.strategyId,
      table.revision,
    ),
    unique('strategy_revisions_id_strategy_unique').on(
      table.id,
      table.strategyId,
    ),
    index('strategy_revisions_strategy_created_idx').on(
      table.strategyId,
      table.createdAt.desc(),
    ),
    foreignKey({
      columns: [table.strategyId, table.createdBy],
      foreignColumns: [strategies.id, strategies.ownerUserId],
      name: 'strategy_revisions_strategy_owner_fk',
    }).onDelete('restrict'),
    check('strategy_revisions_revision_check', sql`${table.revision} >= 1`),
    check(
      'strategy_revisions_schema_version_check',
      sql`${table.schemaVersion} >= 1`,
    ),
    check(
      'strategy_revisions_complexity_check',
      sql`${table.complexityScore} >= 0`,
    ),
    check(
      'strategy_revisions_validation_status_check',
      sql`${table.validationStatus} in ('draft', 'valid', 'invalid')`,
    ),
  ],
);

export const backtestDataSnapshots = pgTable(
  'backtest_data_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    snapshotHash: varchar('snapshot_hash', { length: 128 }).notNull(),
    schemaVersion: integer('schema_version').notNull(),
    marketRevisionHash: varchar('market_revision_hash', {
      length: 128,
    }).notNull(),
    universeRevisionHash: varchar('universe_revision_hash', {
      length: 128,
    }).notNull(),
    fundamentalRevisionHash: varchar('fundamental_revision_hash', {
      length: 128,
    }).notNull(),
    corporateActionRevisionHash: varchar('corporate_action_revision_hash', {
      length: 128,
    }).notNull(),
    dataCutoffAt: timestamp('data_cutoff_at', { withTimezone: true }).notNull(),
    coverageStatus: varchar('coverage_status', { length: 24 }).notNull(),
    revisionManifest: jsonb('revision_manifest')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    qualityMetadata: jsonb('quality_metadata')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('backtest_data_snapshots_hash_unique').on(table.snapshotHash),
    index('backtest_data_snapshots_cutoff_idx').on(table.dataCutoffAt.desc()),
    check(
      'backtest_data_snapshots_hashes_not_blank',
      sql`
        length(trim(${table.snapshotHash})) > 0
        and length(trim(${table.marketRevisionHash})) > 0
        and length(trim(${table.universeRevisionHash})) > 0
        and length(trim(${table.fundamentalRevisionHash})) > 0
        and length(trim(${table.corporateActionRevisionHash})) > 0
      `,
    ),
    check(
      'backtest_data_snapshots_schema_version_check',
      sql`${table.schemaVersion} >= 1`,
    ),
    check(
      'backtest_data_snapshots_coverage_status_check',
      sql`${table.coverageStatus} in ('complete', 'partial', 'not_evaluable')`,
    ),
  ],
);

export const backtestRuns = pgTable(
  'backtest_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    strategyId: uuid('strategy_id').notNull(),
    strategyRevision: integer('strategy_revision').notNull(),
    requestedBy: uuid('requested_by').notNull(),
    status: varchar('status', { length: 32 }).default('queued').notNull(),
    requestHash: varchar('request_hash', { length: 128 }).notNull(),
    idempotencyKeyHash: varchar('idempotency_key_hash', {
      length: 128,
    }).notNull(),
    engineVersion: varchar('engine_version', { length: 64 }).notNull(),
    executionPolicyVersion: varchar('execution_policy_version', {
      length: 64,
    }).notNull(),
    costPolicyVersion: varchar('cost_policy_version', {
      length: 64,
    }).notNull(),
    metricPolicyVersion: varchar('metric_policy_version', {
      length: 64,
    }).notNull(),
    eventOrderingPolicyVersion: varchar('event_ordering_policy_version', {
      length: 64,
    }).notNull(),
    roundingPolicyVersion: varchar('rounding_policy_version', {
      length: 64,
    }).notNull(),
    dataSnapshotId: uuid('data_snapshot_id')
      .notNull()
      .references(() => backtestDataSnapshots.id, { onDelete: 'restrict' }),
    parameters: jsonb('parameters')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    universeSnapshot: jsonb('universe_snapshot')
      .$type<Record<string, unknown>>()
      .notNull(),
    timeframe: varchar('timeframe', { length: 16 }).notNull(),
    adjustmentMode: varchar('adjustment_mode', { length: 32 }).notNull(),
    rangeFrom: timestamp('range_from', { withTimezone: true }).notNull(),
    rangeTo: timestamp('range_to', { withTimezone: true }).notNull(),
    initialCapital: money('initial_capital').notNull(),
    progress: ratio('progress').default('0').notNull(),
    warnings: jsonb('warnings')
      .$type<readonly Record<string, unknown>[]>()
      .default(emptyArray)
      .notNull(),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: text('error_message'),
    queuedAt: timestamp('queued_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelRequestedAt: timestamp('cancel_requested_at', {
      withTimezone: true,
    }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    ...auditTimestamps,
  },
  (table) => [
    unique('backtest_runs_id_requester_unique').on(table.id, table.requestedBy),
    uniqueIndex('backtest_runs_requester_idempotency_unique').on(
      table.requestedBy,
      table.idempotencyKeyHash,
    ),
    index('backtest_runs_requester_status_updated_idx').on(
      table.requestedBy,
      table.status,
      table.updatedAt.desc(),
    ),
    index('backtest_runs_strategy_revision_idx').on(
      table.strategyId,
      table.strategyRevision,
    ),
    index('backtest_runs_snapshot_idx').on(table.dataSnapshotId),
    foreignKey({
      columns: [table.strategyId, table.strategyRevision],
      foreignColumns: [
        strategyRevisions.strategyId,
        strategyRevisions.revision,
      ],
      name: 'backtest_runs_strategy_revision_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.strategyId, table.requestedBy],
      foreignColumns: [strategies.id, strategies.ownerUserId],
      name: 'backtest_runs_strategy_owner_fk',
    }).onDelete('restrict'),
    check(
      'backtest_runs_status_check',
      sql`${table.status} in ('queued', 'resolving_data', 'running', 'calculating_metrics', 'completed', 'failed', 'cancel_requested', 'cancelled', 'expired')`,
    ),
    check(
      'backtest_runs_hashes_not_blank',
      sql`length(trim(${table.requestHash})) > 0 and length(trim(${table.idempotencyKeyHash})) > 0`,
    ),
    check(
      'backtest_runs_versions_not_blank',
      sql`
        length(trim(${table.engineVersion})) > 0
        and length(trim(${table.executionPolicyVersion})) > 0
        and length(trim(${table.costPolicyVersion})) > 0
        and length(trim(${table.metricPolicyVersion})) > 0
        and length(trim(${table.eventOrderingPolicyVersion})) > 0
        and length(trim(${table.roundingPolicyVersion})) > 0
      `,
    ),
    check(
      'backtest_runs_range_check',
      sql`${table.rangeTo} >= ${table.rangeFrom}`,
    ),
    check(
      'backtest_runs_adjustment_mode_check',
      sql`${table.adjustmentMode} in ('raw', 'split_adjusted', 'total_return_adjusted')`,
    ),
    check(
      'backtest_runs_financial_check',
      sql`
        ${table.initialCapital} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.initialCapital} > 0
        and ${table.progress} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.progress} >= 0 and ${table.progress} <= 100
      `,
    ),
  ],
);

export const backtestSummaries = pgTable(
  'backtest_summaries',
  {
    runId: uuid('run_id').primaryKey(),
    ownerUserId: uuid('owner_user_id').notNull(),
    endingEquity: money('ending_equity').notNull(),
    totalReturn: ratio('total_return').notNull(),
    annualizedReturn: ratio('annualized_return'),
    maximumDrawdown: ratio('maximum_drawdown').notNull(),
    volatility: ratio('volatility'),
    sharpeRatio: ratio('sharpe_ratio'),
    sortinoRatio: ratio('sortino_ratio'),
    calmarRatio: ratio('calmar_ratio'),
    winRate: ratio('win_rate'),
    profitFactor: ratio('profit_factor'),
    expectancy: money('expectancy'),
    turnover: ratio('turnover').notNull(),
    exposure: ratio('exposure').notNull(),
    totalFees: money('total_fees').notNull(),
    totalSlippage: money('total_slippage').notNull(),
    benchmarkReturn: ratio('benchmark_return'),
    tradeCount: integer('trade_count').notNull(),
    methodology: jsonb('methodology')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    warnings: jsonb('warnings')
      .$type<readonly Record<string, unknown>[]>()
      .default(emptyArray)
      .notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('backtest_summaries_owner_calculated_idx').on(
      table.ownerUserId,
      table.calculatedAt.desc(),
    ),
    foreignKey({
      columns: [table.runId, table.ownerUserId],
      foreignColumns: [backtestRuns.id, backtestRuns.requestedBy],
      name: 'backtest_summaries_run_owner_fk',
    }).onDelete('cascade'),
    check('backtest_summaries_counts_check', sql`${table.tradeCount} >= 0`),
    check(
      'backtest_summaries_required_numeric_check',
      sql`
        ${table.endingEquity} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.totalReturn} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.maximumDrawdown} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.turnover} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.exposure} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.totalFees} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.totalSlippage} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      `,
    ),
  ],
);

export const backtestOrders = pgTable(
  'backtest_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    orderSequence: integer('order_sequence').notNull(),
    eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
    side: varchar('side', { length: 8 }).notNull(),
    orderType: varchar('order_type', { length: 24 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    requestedQuantity: money('requested_quantity').notNull(),
    signalPrice: money('signal_price'),
    limitPrice: money('limit_price'),
    stopPrice: money('stop_price'),
    reasonCode: varchar('reason_code', { length: 64 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('backtest_orders_id_run_unique').on(table.id, table.runId),
    unique('backtest_orders_run_sequence_unique').on(
      table.runId,
      table.orderSequence,
    ),
    index('backtest_orders_run_event_idx').on(
      table.runId,
      table.eventAt,
      table.orderSequence,
    ),
    index('backtest_orders_owner_run_idx').on(table.ownerUserId, table.runId),
    index('backtest_orders_instrument_event_idx').on(
      table.instrumentId,
      table.eventAt,
    ),
    foreignKey({
      columns: [table.runId, table.ownerUserId],
      foreignColumns: [backtestRuns.id, backtestRuns.requestedBy],
      name: 'backtest_orders_run_owner_fk',
    }).onDelete('cascade'),
    check('backtest_orders_sequence_check', sql`${table.orderSequence} >= 0`),
    check('backtest_orders_side_check', sql`${table.side} in ('buy', 'sell')`),
    check(
      'backtest_orders_type_check',
      sql`${table.orderType} in ('market', 'limit', 'stop', 'stop_limit')`,
    ),
    check(
      'backtest_orders_status_check',
      sql`${table.status} in ('created', 'accepted', 'partially_filled', 'filled', 'cancelled', 'rejected')`,
    ),
    check(
      'backtest_orders_quantity_check',
      sql`${table.requestedQuantity} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.requestedQuantity} > 0`,
    ),
  ],
);

export const backtestFills = pgTable(
  'backtest_fills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    orderId: uuid('order_id').notNull(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    fillSequence: integer('fill_sequence').notNull(),
    filledAt: timestamp('filled_at', { withTimezone: true }).notNull(),
    quantity: money('quantity').notNull(),
    rawPrice: money('raw_price').notNull(),
    fillPrice: money('fill_price').notNull(),
    commission: money('commission').default('0').notNull(),
    slippageCost: money('slippage_cost').default('0').notNull(),
    fee: money('fee').default('0').notNull(),
    tax: money('tax').default('0').notNull(),
    deduplicationKey: varchar('deduplication_key', { length: 160 }).notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('backtest_fills_id_run_unique').on(table.id, table.runId),
    uniqueIndex('backtest_fills_deduplication_key_unique').on(
      table.deduplicationKey,
    ),
    unique('backtest_fills_run_sequence_unique').on(
      table.runId,
      table.fillSequence,
    ),
    index('backtest_fills_run_filled_idx').on(
      table.runId,
      table.filledAt,
      table.fillSequence,
    ),
    index('backtest_fills_owner_run_idx').on(table.ownerUserId, table.runId),
    foreignKey({
      columns: [table.runId, table.ownerUserId],
      foreignColumns: [backtestRuns.id, backtestRuns.requestedBy],
      name: 'backtest_fills_run_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.orderId, table.runId],
      foreignColumns: [backtestOrders.id, backtestOrders.runId],
      name: 'backtest_fills_order_run_fk',
    }).onDelete('restrict'),
    check('backtest_fills_sequence_check', sql`${table.fillSequence} >= 0`),
    check(
      'backtest_fills_numeric_check',
      sql`
        ${table.quantity} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.quantity} > 0
        and ${table.rawPrice} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.rawPrice} >= 0
        and ${table.fillPrice} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.fillPrice} >= 0
        and ${table.commission} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.commission} >= 0
        and ${table.slippageCost} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.slippageCost} >= 0
        and ${table.fee} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.fee} >= 0
        and ${table.tax} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.tax} >= 0
      `,
    ),
  ],
);

export const backtestTrades = pgTable(
  'backtest_trades',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    tradeSequence: integer('trade_sequence').notNull(),
    entryFillId: uuid('entry_fill_id').notNull(),
    exitFillId: uuid('exit_fill_id').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    quantity: money('quantity').notNull(),
    entryPrice: money('entry_price').notNull(),
    exitPrice: money('exit_price').notNull(),
    grossPnl: money('gross_pnl').notNull(),
    netPnl: money('net_pnl').notNull(),
    totalCost: money('total_cost').notNull(),
    returnRate: ratio('return_rate').notNull(),
    holdingBars: integer('holding_bars').notNull(),
    closeReason: varchar('close_reason', { length: 64 }).notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('backtest_trades_run_sequence_unique').on(
      table.runId,
      table.tradeSequence,
    ),
    index('backtest_trades_run_closed_idx').on(
      table.runId,
      table.closedAt,
      table.tradeSequence,
    ),
    index('backtest_trades_owner_run_idx').on(table.ownerUserId, table.runId),
    index('backtest_trades_instrument_closed_idx').on(
      table.instrumentId,
      table.closedAt,
    ),
    foreignKey({
      columns: [table.runId, table.ownerUserId],
      foreignColumns: [backtestRuns.id, backtestRuns.requestedBy],
      name: 'backtest_trades_run_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.entryFillId, table.runId],
      foreignColumns: [backtestFills.id, backtestFills.runId],
      name: 'backtest_trades_entry_fill_run_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.exitFillId, table.runId],
      foreignColumns: [backtestFills.id, backtestFills.runId],
      name: 'backtest_trades_exit_fill_run_fk',
    }).onDelete('restrict'),
    check('backtest_trades_sequence_check', sql`${table.tradeSequence} >= 0`),
    check(
      'backtest_trades_time_check',
      sql`${table.closedAt} >= ${table.openedAt}`,
    ),
    check(
      'backtest_trades_numeric_check',
      sql`
        ${table.quantity} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.quantity} > 0
        and ${table.entryPrice} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.entryPrice} >= 0
        and ${table.exitPrice} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.exitPrice} >= 0
        and ${table.grossPnl} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.netPnl} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.totalCost} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) and ${table.totalCost} >= 0
        and ${table.returnRate} not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
        and ${table.holdingBars} >= 0
      `,
    ),
  ],
);

export const backtestSeriesChunks = pgTable(
  'backtest_series_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    seriesType: varchar('series_type', { length: 32 }).notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    rangeStart: timestamp('range_start', { withTimezone: true }).notNull(),
    rangeEnd: timestamp('range_end', { withTimezone: true }).notNull(),
    pointCount: integer('point_count').notNull(),
    encoding: varchar('encoding', { length: 32 }).default('json_v1').notNull(),
    payload: jsonb('payload').$type<readonly unknown[]>().notNull(),
    checksum: varchar('checksum', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('backtest_series_chunks_run_type_chunk_unique').on(
      table.runId,
      table.seriesType,
      table.chunkIndex,
    ),
    index('backtest_series_chunks_owner_run_type_idx').on(
      table.ownerUserId,
      table.runId,
      table.seriesType,
    ),
    foreignKey({
      columns: [table.runId, table.ownerUserId],
      foreignColumns: [backtestRuns.id, backtestRuns.requestedBy],
      name: 'backtest_series_chunks_run_owner_fk',
    }).onDelete('cascade'),
    check(
      'backtest_series_chunks_type_check',
      sql`${table.seriesType} in ('equity', 'drawdown', 'cash', 'exposure', 'benchmark')`,
    ),
    check(
      'backtest_series_chunks_range_check',
      sql`${table.rangeEnd} >= ${table.rangeStart}`,
    ),
    check(
      'backtest_series_chunks_counts_check',
      sql`${table.chunkIndex} >= 0 and ${table.pointCount} >= 0`,
    ),
    check(
      'backtest_series_chunks_payload_check',
      sql`jsonb_typeof(${table.payload}) = 'array'`,
    ),
  ],
);

export const researchExperiments = pgTable(
  'research_experiments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerUserId: uuid('owner_user_id').notNull(),
    strategyId: uuid('strategy_id').notNull(),
    strategyRevision: integer('strategy_revision').notNull(),
    dataSnapshotId: uuid('data_snapshot_id')
      .notNull()
      .references(() => backtestDataSnapshots.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 160 }).notNull(),
    status: varchar('status', { length: 24 }).default('draft').notNull(),
    experimentHash: varchar('experiment_hash', { length: 128 }).notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    combinationCount: integer('combination_count').notNull(),
    completedRunCount: integer('completed_run_count').default(0).notNull(),
    failedRunCount: integer('failed_run_count').default(0).notNull(),
    warnings: jsonb('warnings')
      .$type<readonly Record<string, unknown>[]>()
      .default(emptyArray)
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...auditTimestamps,
  },
  (table) => [
    unique('research_experiments_id_owner_unique').on(
      table.id,
      table.ownerUserId,
    ),
    unique('research_experiments_owner_hash_unique').on(
      table.ownerUserId,
      table.experimentHash,
    ),
    index('research_experiments_owner_status_updated_idx').on(
      table.ownerUserId,
      table.status,
      table.updatedAt.desc(),
    ),
    index('research_experiments_strategy_revision_idx').on(
      table.strategyId,
      table.strategyRevision,
    ),
    foreignKey({
      columns: [table.strategyId, table.strategyRevision],
      foreignColumns: [
        strategyRevisions.strategyId,
        strategyRevisions.revision,
      ],
      name: 'research_experiments_strategy_revision_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.strategyId, table.ownerUserId],
      foreignColumns: [strategies.id, strategies.ownerUserId],
      name: 'research_experiments_strategy_owner_fk',
    }).onDelete('restrict'),
    check(
      'research_experiments_status_check',
      sql`${table.status} in ('draft', 'queued', 'running', 'completed', 'partial', 'failed', 'cancel_requested', 'cancelled')`,
    ),
    check(
      'research_experiments_counts_check',
      sql`
        ${table.combinationCount} >= 1
        and ${table.completedRunCount} >= 0
        and ${table.failedRunCount} >= 0
        and ${table.completedRunCount} + ${table.failedRunCount} <= ${table.combinationCount}
      `,
    ),
    check(
      'research_experiments_hash_not_blank',
      sql`length(trim(${table.experimentHash})) > 0`,
    ),
  ],
);

export const researchExperimentRuns = pgTable(
  'research_experiment_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    experimentId: uuid('experiment_id').notNull(),
    ownerUserId: uuid('owner_user_id').notNull(),
    backtestRunId: uuid('backtest_run_id').notNull(),
    bindingHash: varchar('binding_hash', { length: 128 }).notNull(),
    parameterBinding: jsonb('parameter_binding')
      .$type<Record<string, unknown>>()
      .notNull(),
    combinationIndex: integer('combination_index').notNull(),
    sampleRole: varchar('sample_role', { length: 24 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    rank: integer('rank'),
    selectedMetrics: jsonb('selected_metrics')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    warnings: jsonb('warnings')
      .$type<readonly Record<string, unknown>[]>()
      .default(emptyArray)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('research_experiment_runs_experiment_binding_unique').on(
      table.experimentId,
      table.bindingHash,
    ),
    unique('research_experiment_runs_experiment_index_unique').on(
      table.experimentId,
      table.combinationIndex,
    ),
    index('research_experiment_runs_owner_experiment_idx').on(
      table.ownerUserId,
      table.experimentId,
      table.combinationIndex,
    ),
    index('research_experiment_runs_backtest_run_idx').on(table.backtestRunId),
    foreignKey({
      columns: [table.experimentId, table.ownerUserId],
      foreignColumns: [researchExperiments.id, researchExperiments.ownerUserId],
      name: 'research_experiment_runs_experiment_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.backtestRunId, table.ownerUserId],
      foreignColumns: [backtestRuns.id, backtestRuns.requestedBy],
      name: 'research_experiment_runs_backtest_owner_fk',
    }).onDelete('restrict'),
    check(
      'research_experiment_runs_index_check',
      sql`${table.combinationIndex} >= 0`,
    ),
    check(
      'research_experiment_runs_sample_role_check',
      sql`${table.sampleRole} in ('train', 'validation', 'test', 'holdout')`,
    ),
    check(
      'research_experiment_runs_status_check',
      sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'cancelled', 'reused')`,
    ),
    check(
      'research_experiment_runs_rank_check',
      sql`${table.rank} is null or ${table.rank} >= 1`,
    ),
  ],
);

export const strategyBacktestTables = {
  strategies,
  strategyRevisions,
  backtestRuns,
  backtestDataSnapshots,
  backtestSummaries,
  backtestOrders,
  backtestFills,
  backtestTrades,
  backtestSeriesChunks,
  researchExperiments,
  researchExperimentRuns,
};
