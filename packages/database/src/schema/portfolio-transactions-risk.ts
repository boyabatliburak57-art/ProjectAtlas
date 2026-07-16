import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
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

const money = (name: string) => numeric(name, { precision: 28, scale: 10 });
const ratio = (name: string) => numeric(name, { precision: 20, scale: 12 });

export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    description: text('description'),
    reportingCurrency: char('reporting_currency', { length: 3 })
      .default('TRY')
      .notNull(),
    defaultBenchmarkCode: varchar('default_benchmark_code', { length: 64 }),
    status: varchar('status', { length: 24 }).default('active').notNull(),
    ledgerVersion: bigint('ledger_version', { mode: 'number' })
      .default(0)
      .notNull(),
    ...auditTimestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('portfolios_id_user_unique').on(table.id, table.userId),
    index('portfolios_user_status_updated_idx').on(
      table.userId,
      table.status,
      table.updatedAt.desc(),
    ),
    check('portfolios_name_not_blank', sql`length(trim(${table.name})) > 0`),
    check('portfolios_currency_check', sql`${table.reportingCurrency} = 'TRY'`),
    check(
      'portfolios_status_check',
      sql`${table.status} in ('active', 'archived', 'deleted')`,
    ),
    check('portfolios_ledger_version_check', sql`${table.ledgerVersion} >= 0`),
    check(
      'portfolios_deleted_state_check',
      sql`(${table.status} = 'deleted') = (${table.deletedAt} is not null)`,
    ),
  ],
);

export const portfolioTransactions = pgTable(
  'portfolio_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'restrict' }),
    instrumentId: uuid('instrument_id').references(() => instruments.id, {
      onDelete: 'restrict',
    }),
    reversalOfTransactionId: uuid('reversal_of_transaction_id'),
    transactionSequence: bigint('transaction_sequence', { mode: 'number' })
      .generatedAlwaysAsIdentity()
      .notNull(),
    type: varchar('type', { length: 32 }).notNull(),
    status: varchar('status', { length: 24 }).default('draft').notNull(),
    tradeAt: timestamp('trade_at', { withTimezone: true }).notNull(),
    settlementAt: timestamp('settlement_at', { withTimezone: true }),
    quantity: money('quantity'),
    unitPrice: money('unit_price'),
    fee: money('fee').default('0').notNull(),
    tax: money('tax').default('0').notNull(),
    cashAmount: money('cash_amount'),
    source: varchar('source', { length: 32 }).notNull(),
    externalReference: varchar('external_reference', { length: 255 }),
    idempotencyKeyHash: varchar('idempotency_key_hash', {
      length: 128,
    }).notNull(),
    normalizedTransactionHash: varchar('normalized_transaction_hash', {
      length: 128,
    }).notNull(),
    corporateActionIdentityHash: varchar('corporate_action_identity_hash', {
      length: 128,
    }),
    adjustmentReason: text('adjustment_reason'),
    note: text('note'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    createdBy: uuid('created_by').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...auditTimestamps,
  },
  (table) => [
    unique('portfolio_transactions_id_portfolio_unique').on(
      table.id,
      table.portfolioId,
    ),
    uniqueIndex(
      'portfolio_transactions_portfolio_source_idempotency_unique',
    ).on(table.portfolioId, table.source, table.idempotencyKeyHash),
    uniqueIndex('portfolio_transactions_external_normalized_unique')
      .on(
        table.portfolioId,
        table.source,
        table.externalReference,
        table.normalizedTransactionHash,
      )
      .where(sql`${table.externalReference} is not null`),
    uniqueIndex('portfolio_transactions_reversal_unique')
      .on(table.reversalOfTransactionId)
      .where(sql`${table.reversalOfTransactionId} is not null`),
    uniqueIndex('portfolio_transactions_corporate_action_identity_unique')
      .on(table.portfolioId, table.corporateActionIdentityHash)
      .where(sql`${table.corporateActionIdentityHash} is not null`),
    index('portfolio_transactions_portfolio_trade_sequence_idx').on(
      table.portfolioId,
      table.tradeAt,
      table.transactionSequence,
    ),
    index('portfolio_transactions_portfolio_status_trade_idx').on(
      table.portfolioId,
      table.status,
      table.tradeAt.desc(),
    ),
    index('portfolio_transactions_instrument_trade_idx').on(
      table.instrumentId,
      table.tradeAt.desc(),
    ),
    foreignKey({
      columns: [table.reversalOfTransactionId, table.portfolioId],
      foreignColumns: [table.id, table.portfolioId],
      name: 'portfolio_transactions_reversal_same_portfolio_fk',
    }).onDelete('restrict'),
    check(
      'portfolio_transactions_type_check',
      sql`${table.type} in ('buy', 'sell', 'cashDeposit', 'cashWithdrawal', 'dividend', 'fee', 'tax', 'split', 'bonusShare', 'rightsIssue', 'adjustment')`,
    ),
    check(
      'portfolio_transactions_status_check',
      sql`${table.status} in ('draft', 'posted', 'reversed', 'deleted')`,
    ),
    check(
      'portfolio_transactions_source_check',
      sql`${table.source} in ('manual', 'csv_import', 'corporate_action', 'system')`,
    ),
    check(
      'portfolio_transactions_hashes_not_blank',
      sql`length(trim(${table.idempotencyKeyHash})) > 0 and length(trim(${table.normalizedTransactionHash})) > 0`,
    ),
    check(
      'portfolio_transactions_settlement_check',
      sql`${table.settlementAt} is null or ${table.settlementAt} >= ${table.tradeAt}`,
    ),
    check(
      'portfolio_transactions_numeric_check',
      sql`
        (${table.quantity} is null or (${table.quantity} <> 'NaN'::numeric and ${table.quantity} >= 0))
        and (${table.unitPrice} is null or (${table.unitPrice} <> 'NaN'::numeric and ${table.unitPrice} >= 0))
        and ${table.fee} <> 'NaN'::numeric and ${table.fee} >= 0
        and ${table.tax} <> 'NaN'::numeric and ${table.tax} >= 0
        and (${table.cashAmount} is null or ${table.cashAmount} <> 'NaN'::numeric)
      `,
    ),
    check(
      'portfolio_transactions_adjustment_reason_check',
      sql`${table.type} <> 'adjustment' or length(trim(coalesce(${table.adjustmentReason}, ''))) > 0`,
    ),
    check(
      'portfolio_transactions_lifecycle_timestamps_check',
      sql`
        (${table.status} = 'draft' and ${table.postedAt} is null and ${table.reversedAt} is null and ${table.deletedAt} is null)
        or (${table.status} = 'posted' and ${table.postedAt} is not null and ${table.reversedAt} is null and ${table.deletedAt} is null)
        or (${table.status} = 'reversed' and ${table.postedAt} is not null and ${table.reversedAt} is not null and ${table.deletedAt} is null)
        or (${table.status} = 'deleted' and ${table.postedAt} is null and ${table.reversedAt} is null and ${table.deletedAt} is not null)
      `,
    ),
    check(
      'portfolio_transactions_no_self_reversal',
      sql`${table.reversalOfTransactionId} is null or ${table.reversalOfTransactionId} <> ${table.id}`,
    ),
  ],
);

export const portfolioPositions = pgTable(
  'portfolio_positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'restrict' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    quantity: money('quantity').notNull(),
    averageCost: money('average_cost').notNull(),
    costBasis: money('cost_basis').notNull(),
    realizedPnl: money('realized_pnl').default('0').notNull(),
    dividendIncome: money('dividend_income').default('0').notNull(),
    projectionLedgerVersion: bigint('projection_ledger_version', {
      mode: 'number',
    }).notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull(),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('portfolio_positions_portfolio_instrument_unique').on(
      table.portfolioId,
      table.instrumentId,
    ),
    index('portfolio_positions_portfolio_value_idx').on(
      table.portfolioId,
      table.costBasis.desc(),
      table.id,
    ),
    index('portfolio_positions_instrument_idx').on(table.instrumentId),
    check(
      'portfolio_positions_numeric_check',
      sql`
        ${table.quantity} <> 'NaN'::numeric and ${table.quantity} >= 0
        and ${table.averageCost} <> 'NaN'::numeric and ${table.averageCost} >= 0
        and ${table.costBasis} <> 'NaN'::numeric and ${table.costBasis} >= 0
        and ${table.realizedPnl} <> 'NaN'::numeric
        and ${table.dividendIncome} <> 'NaN'::numeric
        and ${table.projectionLedgerVersion} >= 0
      `,
    ),
  ],
);

export const portfolioCashBalances = pgTable(
  'portfolio_cash_balances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'restrict' }),
    currencyCode: char('currency_code', { length: 3 }).notNull(),
    balance: money('balance').notNull(),
    projectionLedgerVersion: bigint('projection_ledger_version', {
      mode: 'number',
    }).notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull(),
    ...auditTimestamps,
  },
  (table) => [
    uniqueIndex('portfolio_cash_balances_portfolio_currency_unique').on(
      table.portfolioId,
      table.currencyCode,
    ),
    index('portfolio_cash_balances_portfolio_idx').on(table.portfolioId),
    check(
      'portfolio_cash_balances_numeric_check',
      sql`${table.balance} <> 'NaN'::numeric and ${table.projectionLedgerVersion} >= 0`,
    ),
    check(
      'portfolio_cash_balances_currency_check',
      sql`${table.currencyCode} = 'TRY'`,
    ),
  ],
);

export const portfolioValuationSnapshots = pgTable(
  'portfolio_valuation_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'restrict' }),
    ledgerVersion: bigint('ledger_version', { mode: 'number' }).notNull(),
    valuationAt: timestamp('valuation_at', { withTimezone: true }).notNull(),
    dataCutoffAt: timestamp('data_cutoff_at', {
      withTimezone: true,
    }).notNull(),
    pricePolicyVersion: varchar('price_policy_version', {
      length: 64,
    }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    cashBalance: money('cash_balance').notNull(),
    positionsMarketValue: money('positions_market_value').notNull(),
    totalValue: money('total_value').notNull(),
    realizedPnl: money('realized_pnl').notNull(),
    unrealizedPnl: money('unrealized_pnl'),
    netContributions: money('net_contributions').default('0').notNull(),
    missingPriceCount: integer('missing_price_count').default(0).notNull(),
    warnings: jsonb('warnings')
      .$type<readonly Record<string, unknown>[]>()
      .default(emptyArray)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('portfolio_valuation_snapshots_identity_unique').on(
      table.portfolioId,
      table.ledgerVersion,
      table.valuationAt,
      table.dataCutoffAt,
      table.pricePolicyVersion,
    ),
    unique('portfolio_valuation_snapshots_child_identity_unique').on(
      table.id,
      table.portfolioId,
      table.ledgerVersion,
      table.dataCutoffAt,
      table.pricePolicyVersion,
    ),
    index('portfolio_valuation_snapshots_portfolio_valuation_idx').on(
      table.portfolioId,
      table.valuationAt.desc(),
    ),
    check(
      'portfolio_valuation_snapshots_status_check',
      sql`${table.status} in ('complete', 'partial', 'not_evaluable')`,
    ),
    check(
      'portfolio_valuation_snapshots_values_check',
      sql`
        ${table.ledgerVersion} >= 0 and ${table.missingPriceCount} >= 0
        and ${table.cashBalance} <> 'NaN'::numeric
        and ${table.positionsMarketValue} <> 'NaN'::numeric
        and ${table.totalValue} <> 'NaN'::numeric
        and ${table.realizedPnl} <> 'NaN'::numeric
        and (${table.unrealizedPnl} is null or ${table.unrealizedPnl} <> 'NaN'::numeric)
        and ${table.netContributions} <> 'NaN'::numeric
      `,
    ),
    check(
      'portfolio_valuation_snapshots_cutoff_check',
      sql`${table.dataCutoffAt} <= ${table.valuationAt}`,
    ),
    check(
      'portfolio_valuation_snapshots_partial_check',
      sql`(${table.status} = 'complete' and ${table.missingPriceCount} = 0) or ${table.status} <> 'complete'`,
    ),
  ],
);

export const portfolioPositionSnapshots = pgTable(
  'portfolio_position_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    valuationSnapshotId: uuid('valuation_snapshot_id').notNull(),
    portfolioId: uuid('portfolio_id').notNull(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    ledgerVersion: bigint('ledger_version', { mode: 'number' }).notNull(),
    dataCutoffAt: timestamp('data_cutoff_at', {
      withTimezone: true,
    }).notNull(),
    pricePolicyVersion: varchar('price_policy_version', {
      length: 64,
    }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    quantity: money('quantity').notNull(),
    averageCost: money('average_cost').notNull(),
    costBasis: money('cost_basis').notNull(),
    marketPrice: money('market_price'),
    marketValue: money('market_value'),
    unrealizedPnl: money('unrealized_pnl'),
    priceAt: timestamp('price_at', { withTimezone: true }),
    warningCode: varchar('warning_code', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('portfolio_position_snapshots_valuation_instrument_unique').on(
      table.valuationSnapshotId,
      table.instrumentId,
    ),
    index('portfolio_position_snapshots_portfolio_value_idx').on(
      table.portfolioId,
      table.marketValue.desc(),
      table.id,
    ),
    foreignKey({
      columns: [
        table.valuationSnapshotId,
        table.portfolioId,
        table.ledgerVersion,
        table.dataCutoffAt,
        table.pricePolicyVersion,
      ],
      foreignColumns: [
        portfolioValuationSnapshots.id,
        portfolioValuationSnapshots.portfolioId,
        portfolioValuationSnapshots.ledgerVersion,
        portfolioValuationSnapshots.dataCutoffAt,
        portfolioValuationSnapshots.pricePolicyVersion,
      ],
      name: 'portfolio_position_snapshots_valuation_identity_fk',
    }).onDelete('cascade'),
    check(
      'portfolio_position_snapshots_status_check',
      sql`${table.status} in ('valued', 'missing_price', 'stale_price')`,
    ),
    check(
      'portfolio_position_snapshots_values_check',
      sql`
        ${table.ledgerVersion} >= 0
        and ${table.quantity} <> 'NaN'::numeric and ${table.quantity} >= 0
        and ${table.averageCost} <> 'NaN'::numeric and ${table.averageCost} >= 0
        and ${table.costBasis} <> 'NaN'::numeric and ${table.costBasis} >= 0
        and (${table.marketPrice} is null or (${table.marketPrice} <> 'NaN'::numeric and ${table.marketPrice} >= 0))
        and (${table.marketValue} is null or ${table.marketValue} <> 'NaN'::numeric)
        and (${table.unrealizedPnl} is null or ${table.unrealizedPnl} <> 'NaN'::numeric)
      `,
    ),
    check(
      'portfolio_position_snapshots_price_state_check',
      sql`
        (${table.status} = 'missing_price' and ${table.marketPrice} is null and ${table.marketValue} is null and ${table.priceAt} is null)
        or (${table.status} in ('valued', 'stale_price') and ${table.marketPrice} is not null and ${table.marketValue} is not null and ${table.priceAt} is not null)
      `,
    ),
    check(
      'portfolio_position_snapshots_price_cutoff_check',
      sql`${table.priceAt} is null or ${table.priceAt} <= ${table.dataCutoffAt}`,
    ),
  ],
);

export const portfolioPerformanceSnapshots = pgTable(
  'portfolio_performance_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'restrict' }),
    ledgerVersion: bigint('ledger_version', { mode: 'number' }).notNull(),
    rangeStartAt: timestamp('range_start_at', { withTimezone: true }).notNull(),
    rangeEndAt: timestamp('range_end_at', { withTimezone: true }).notNull(),
    dataCutoffAt: timestamp('data_cutoff_at', {
      withTimezone: true,
    }).notNull(),
    performancePolicyVersion: varchar('performance_policy_version', {
      length: 64,
    }).notNull(),
    benchmarkCode: varchar('benchmark_code', { length: 64 })
      .default('none')
      .notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    twr: ratio('twr'),
    xirr: ratio('xirr'),
    benchmarkReturn: ratio('benchmark_return'),
    netContribution: money('net_contribution').notNull(),
    startValue: money('start_value').notNull(),
    endValue: money('end_value').notNull(),
    observationCount: integer('observation_count').default(0).notNull(),
    warnings: jsonb('warnings')
      .$type<readonly Record<string, unknown>[]>()
      .default(emptyArray)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('portfolio_performance_snapshots_identity_unique').on(
      table.portfolioId,
      table.ledgerVersion,
      table.rangeStartAt,
      table.rangeEndAt,
      table.dataCutoffAt,
      table.performancePolicyVersion,
      table.benchmarkCode,
    ),
    index('portfolio_performance_snapshots_portfolio_range_idx').on(
      table.portfolioId,
      table.rangeEndAt.desc(),
      table.rangeStartAt,
    ),
    check(
      'portfolio_performance_snapshots_status_check',
      sql`${table.status} in ('complete', 'partial', 'not_evaluable')`,
    ),
    check(
      'portfolio_performance_snapshots_range_check',
      sql`${table.rangeEndAt} >= ${table.rangeStartAt} and ${table.dataCutoffAt} >= ${table.rangeEndAt}`,
    ),
    check(
      'portfolio_performance_snapshots_values_check',
      sql`
        ${table.ledgerVersion} >= 0 and ${table.observationCount} >= 0
        and (${table.twr} is null or ${table.twr} <> 'NaN'::numeric)
        and (${table.xirr} is null or ${table.xirr} <> 'NaN'::numeric)
        and (${table.benchmarkReturn} is null or ${table.benchmarkReturn} <> 'NaN'::numeric)
        and ${table.netContribution} <> 'NaN'::numeric
        and ${table.startValue} <> 'NaN'::numeric
        and ${table.endValue} <> 'NaN'::numeric
      `,
    ),
  ],
);

export const portfolioRiskSnapshots = pgTable(
  'portfolio_risk_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'restrict' }),
    ledgerVersion: bigint('ledger_version', { mode: 'number' }).notNull(),
    valuationSeriesVersion: bigint('valuation_series_version', {
      mode: 'number',
    }).notNull(),
    rangeStartAt: timestamp('range_start_at', { withTimezone: true }).notNull(),
    rangeEndAt: timestamp('range_end_at', { withTimezone: true }).notNull(),
    dataCutoffAt: timestamp('data_cutoff_at', {
      withTimezone: true,
    }).notNull(),
    benchmarkCode: varchar('benchmark_code', { length: 64 })
      .default('none')
      .notNull(),
    riskPolicyVersion: varchar('risk_policy_version', {
      length: 64,
    }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    observationCount: integer('observation_count').default(0).notNull(),
    volatility: ratio('volatility'),
    beta: ratio('beta'),
    maximumDrawdown: ratio('maximum_drawdown'),
    historicalVar95: ratio('historical_var_95'),
    historicalVar99: ratio('historical_var_99'),
    expectedShortfall: ratio('expected_shortfall'),
    hhi: ratio('hhi'),
    methodology: jsonb('methodology')
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
  },
  (table) => [
    unique('portfolio_risk_snapshots_identity_unique').on(
      table.portfolioId,
      table.ledgerVersion,
      table.valuationSeriesVersion,
      table.rangeStartAt,
      table.rangeEndAt,
      table.dataCutoffAt,
      table.benchmarkCode,
      table.riskPolicyVersion,
    ),
    unique('portfolio_risk_snapshots_child_identity_unique').on(
      table.id,
      table.portfolioId,
      table.riskPolicyVersion,
    ),
    index('portfolio_risk_snapshots_portfolio_range_idx').on(
      table.portfolioId,
      table.rangeEndAt.desc(),
      table.rangeStartAt,
    ),
    check(
      'portfolio_risk_snapshots_status_check',
      sql`${table.status} in ('complete', 'partial', 'not_evaluable')`,
    ),
    check(
      'portfolio_risk_snapshots_range_check',
      sql`${table.rangeEndAt} >= ${table.rangeStartAt} and ${table.dataCutoffAt} >= ${table.rangeEndAt}`,
    ),
    check(
      'portfolio_risk_snapshots_values_check',
      sql`
        ${table.ledgerVersion} >= 0 and ${table.valuationSeriesVersion} >= 0 and ${table.observationCount} >= 0
        and (${table.volatility} is null or ${table.volatility} <> 'NaN'::numeric)
        and (${table.beta} is null or ${table.beta} <> 'NaN'::numeric)
        and (${table.maximumDrawdown} is null or ${table.maximumDrawdown} <> 'NaN'::numeric)
        and (${table.historicalVar95} is null or ${table.historicalVar95} <> 'NaN'::numeric)
        and (${table.historicalVar99} is null or ${table.historicalVar99} <> 'NaN'::numeric)
        and (${table.expectedShortfall} is null or ${table.expectedShortfall} <> 'NaN'::numeric)
        and (${table.hhi} is null or ${table.hhi} <> 'NaN'::numeric)
      `,
    ),
  ],
);

export const portfolioRiskExposures = pgTable(
  'portfolio_risk_exposures',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    riskSnapshotId: uuid('risk_snapshot_id').notNull(),
    portfolioId: uuid('portfolio_id').notNull(),
    riskPolicyVersion: varchar('risk_policy_version', {
      length: 64,
    }).notNull(),
    exposureType: varchar('exposure_type', { length: 24 }).notNull(),
    exposureKey: varchar('exposure_key', { length: 160 }).notNull(),
    weight: ratio('weight').notNull(),
    marketValue: money('market_value').notNull(),
    rank: integer('rank'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('portfolio_risk_exposures_snapshot_type_key_unique').on(
      table.riskSnapshotId,
      table.exposureType,
      table.exposureKey,
    ),
    index('portfolio_risk_exposures_portfolio_weight_idx').on(
      table.portfolioId,
      table.weight.desc(),
    ),
    foreignKey({
      columns: [
        table.riskSnapshotId,
        table.portfolioId,
        table.riskPolicyVersion,
      ],
      foreignColumns: [
        portfolioRiskSnapshots.id,
        portfolioRiskSnapshots.portfolioId,
        portfolioRiskSnapshots.riskPolicyVersion,
      ],
      name: 'portfolio_risk_exposures_snapshot_identity_fk',
    }).onDelete('cascade'),
    check(
      'portfolio_risk_exposures_type_check',
      sql`${table.exposureType} in ('instrument', 'sector', 'cash')`,
    ),
    check(
      'portfolio_risk_exposures_values_check',
      sql`
        ${table.weight} <> 'NaN'::numeric and ${table.weight} >= 0
        and ${table.marketValue} <> 'NaN'::numeric
        and (${table.rank} is null or ${table.rank} >= 1)
      `,
    ),
  ],
);

export const portfolioImportJobs = pgTable(
  'portfolio_import_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    portfolioId: uuid('portfolio_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: varchar('status', { length: 24 }).default('uploaded').notNull(),
    commitMode: varchar('commit_mode', { length: 16 })
      .default('atomic')
      .notNull(),
    sourceFilename: varchar('source_filename', { length: 255 }).notNull(),
    fileHash: varchar('file_hash', { length: 128 }).notNull(),
    idempotencyKeyHash: varchar('idempotency_key_hash', {
      length: 128,
    }).notNull(),
    totalRowCount: integer('total_row_count').default(0).notNull(),
    validRowCount: integer('valid_row_count').default(0).notNull(),
    invalidRowCount: integer('invalid_row_count').default(0).notNull(),
    duplicateRowCount: integer('duplicate_row_count').default(0).notNull(),
    committedRowCount: integer('committed_row_count').default(0).notNull(),
    previewExpiresAt: timestamp('preview_expires_at', { withTimezone: true }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    errorCode: varchar('error_code', { length: 64 }),
    ...auditTimestamps,
  },
  (table) => [
    unique('portfolio_import_jobs_owner_identity_unique').on(
      table.id,
      table.portfolioId,
      table.userId,
    ),
    uniqueIndex('portfolio_import_jobs_owner_idempotency_unique').on(
      table.portfolioId,
      table.userId,
      table.idempotencyKeyHash,
    ),
    index('portfolio_import_jobs_owner_status_created_idx').on(
      table.userId,
      table.portfolioId,
      table.status,
      table.createdAt.desc(),
    ),
    foreignKey({
      columns: [table.portfolioId, table.userId],
      foreignColumns: [portfolios.id, portfolios.userId],
      name: 'portfolio_import_jobs_portfolio_owner_fk',
    }).onDelete('restrict'),
    check(
      'portfolio_import_jobs_status_check',
      sql`${table.status} in ('uploaded', 'validating', 'preview_ready', 'committing', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      'portfolio_import_jobs_commit_mode_check',
      sql`${table.commitMode} in ('atomic', 'partial')`,
    ),
    check(
      'portfolio_import_jobs_hashes_not_blank',
      sql`length(trim(${table.fileHash})) > 0 and length(trim(${table.idempotencyKeyHash})) > 0`,
    ),
    check(
      'portfolio_import_jobs_counts_check',
      sql`
        ${table.totalRowCount} >= 0 and ${table.validRowCount} >= 0
        and ${table.invalidRowCount} >= 0 and ${table.duplicateRowCount} >= 0
        and ${table.committedRowCount} >= 0
        and ${table.validRowCount} + ${table.invalidRowCount} + ${table.duplicateRowCount} <= ${table.totalRowCount}
        and ${table.committedRowCount} <= ${table.validRowCount}
      `,
    ),
    check(
      'portfolio_import_jobs_terminal_timestamp_check',
      sql`
        (${table.status} = 'completed') = (${table.committedAt} is not null)
        and (${table.status} = 'cancelled') = (${table.cancelledAt} is not null)
      `,
    ),
  ],
);

export const portfolioImportRows = pgTable(
  'portfolio_import_rows',
  {
    id: bigint('id', { mode: 'number' })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    importJobId: uuid('import_job_id').notNull(),
    portfolioId: uuid('portfolio_id').notNull(),
    userId: uuid('user_id').notNull(),
    rowNumber: integer('row_number').notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    duplicateOfTransactionId: uuid('duplicate_of_transaction_id'),
    normalizedTransactionHash: varchar('normalized_transaction_hash', {
      length: 128,
    }),
    rawData: jsonb('raw_data')
      .$type<Record<string, unknown>>()
      .default(emptyObject)
      .notNull(),
    normalizedData: jsonb('normalized_data').$type<Record<string, unknown>>(),
    validationErrors: jsonb('validation_errors')
      .$type<readonly Record<string, unknown>[]>()
      .default(emptyArray)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('portfolio_import_rows_job_row_unique').on(
      table.importJobId,
      table.rowNumber,
    ),
    index('portfolio_import_rows_owner_status_row_idx').on(
      table.userId,
      table.portfolioId,
      table.status,
      table.rowNumber,
    ),
    index('portfolio_import_rows_normalized_hash_idx').on(
      table.portfolioId,
      table.normalizedTransactionHash,
    ),
    foreignKey({
      columns: [table.importJobId, table.portfolioId, table.userId],
      foreignColumns: [
        portfolioImportJobs.id,
        portfolioImportJobs.portfolioId,
        portfolioImportJobs.userId,
      ],
      name: 'portfolio_import_rows_job_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.duplicateOfTransactionId, table.portfolioId],
      foreignColumns: [
        portfolioTransactions.id,
        portfolioTransactions.portfolioId,
      ],
      name: 'portfolio_import_rows_duplicate_transaction_fk',
    }).onDelete('restrict'),
    check(
      'portfolio_import_rows_status_check',
      sql`${table.status} in ('valid', 'invalid', 'duplicate', 'committed', 'skipped')`,
    ),
    check(
      'portfolio_import_rows_row_number_check',
      sql`${table.rowNumber} >= 1`,
    ),
    check(
      'portfolio_import_rows_duplicate_state_check',
      sql`(${table.status} = 'duplicate') = (${table.duplicateOfTransactionId} is not null)`,
    ),
  ],
);
