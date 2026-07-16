import {
  PortfolioApplicationService,
  PortfolioValuationService,
} from '@atlas/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../client';
import { runMigrations } from '../migration';
import { seedDatabase } from '../seed';
import { PostgresPortfolioRepository } from './postgres-portfolio-repository';
import { PostgresPortfolioValuationRepository } from './postgres-portfolio-valuation-repository';

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}
const userId = '00000000-0000-4000-8000-000000000901';
const otherUserId = '00000000-0000-4000-8000-000000000902';
const now = new Date('2026-07-16T12:00:00.000Z');

describe('Postgres portfolio ledger integration', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  const repository = new PostgresPortfolioRepository(db);
  const service = new PortfolioApplicationService({
    repository,
    audit: { record: () => Promise.resolve() },
    logger: { info: () => undefined },
    now: () => now,
  });
  let instrumentId: string;
  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await seedDatabase(db);
    await db.execute(sql`
      insert into instruments
        (id, symbol, normalized_symbol, name, market_code, currency_code, status)
      values
        ('00000000-0000-4000-8000-000000000903', 'TST', 'TST',
         'Portfolio fixture instrument', 'BIST', 'TRY', 'active')
      on conflict do nothing
    `);
    await db.execute(sql`
      insert into data_providers (id, code, name, status)
      values ('00000000-0000-4000-8000-000000000904', 'PORTFOLIO_FIXTURE',
              'Portfolio fixture provider', 'active')
      on conflict do nothing
    `);
    const result = await db.execute<{ id: string }>(
      sql`select id::text as id from instruments order by id limit 1`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('Seeded instrument required');
    instrumentId = row.id;
  });
  afterAll(async () => pool.end());

  it('atomically posts, persists projections, rebuilds, and reverses', async () => {
    const portfolio = await service.create({
      userId,
      name: 'Integration Portfolio',
    });
    const draft = await service.createDraft({
      userId,
      portfolioId: portfolio.id,
      idempotencyKey: 'buy-1',
      source: 'manual',
      type: 'buy',
      instrumentId,
      tradeAt: now,
      quantity: '10',
      unitPrice: '100',
      fee: '10',
    });
    const posted = await service.post(
      userId,
      portfolio.id,
      draft.transaction.id,
    );
    expect(posted).toMatchObject({
      portfolio: { ledgerVersion: 1 },
      projection: {
        positions: [{ quantity: '10', averageCost: '101', costBasis: '1010' }],
      },
    });
    const persisted = await db.execute<{
      quantity: string;
      average_cost: string;
      projection_ledger_version: string;
    }>(
      sql`select quantity::text, average_cost::text, projection_ledger_version::text from portfolio_positions where portfolio_id = ${portfolio.id}::uuid`,
    );
    expect(persisted.rows[0]).toEqual({
      quantity: '10.0000000000',
      average_cost: '101.0000000000',
      projection_ledger_version: '1',
    });
    const rebuilt = await service.rebuildProjection(userId, portfolio.id);
    expect(rebuilt.ledgerVersion).toBe(1);
    const reversed = await service.reverse(
      userId,
      portfolio.id,
      draft.transaction.id,
      'reverse-1',
    );
    expect(reversed.portfolio.ledgerVersion).toBe(2);
    expect(reversed.projection.positions).toHaveLength(0);
    const counts = await db.execute<{ positions: string; reversals: string }>(
      sql`select (select count(*) from portfolio_positions where portfolio_id = ${portfolio.id}::uuid)::text as positions, (select count(*) from portfolio_transactions where portfolio_id = ${portfolio.id}::uuid and reversal_of_transaction_id is not null)::text as reversals`,
    );
    expect(counts.rows[0]).toEqual({ positions: '0', reversals: '1' });
  });

  it('enforces database idempotency and application ownership', async () => {
    const portfolio = await service.create({
      userId,
      name: 'Idempotency Portfolio',
    });
    const request = {
      userId,
      portfolioId: portfolio.id,
      idempotencyKey: 'deposit-1',
      source: 'manual' as const,
      type: 'cashDeposit' as const,
      instrumentId: null,
      tradeAt: now,
      cashAmount: '100',
    };
    const first = await service.createDraft(request);
    const replay = await service.createDraft(request);
    expect(replay).toEqual({ transaction: first.transaction, replayed: true });
    await expect(
      service.createDraft({ ...request, cashAmount: '101' }),
    ).rejects.toMatchObject({ code: 'PORTFOLIO_IDEMPOTENCY_CONFLICT' });
    await expect(service.get(otherUserId, portfolio.id)).rejects.toMatchObject({
      code: 'PORTFOLIO_ACCESS_DENIED',
    });
  });

  it('deduplicates corporate actions and persists a single-cutoff valuation snapshot', async () => {
    const portfolio = await service.create({
      userId,
      name: 'Valuation Portfolio',
    });
    const deposit = await service.createDraft({
      userId,
      portfolioId: portfolio.id,
      idempotencyKey: 'cash',
      source: 'manual',
      type: 'cashDeposit',
      instrumentId: null,
      tradeAt: now,
      cashAmount: '1000',
    });
    await service.post(userId, portfolio.id, deposit.transaction.id);
    const buy = await service.createDraft({
      userId,
      portfolioId: portfolio.id,
      idempotencyKey: 'buy',
      source: 'manual',
      type: 'buy',
      instrumentId,
      tradeAt: now,
      quantity: '10',
      unitPrice: '100',
    });
    await service.post(userId, portfolio.id, buy.transaction.id);
    const split = await service.applyCorporateAction({
      userId,
      portfolioId: portfolio.id,
      eventKey: 'TST:2026-07-16:SPLIT-2',
      source: 'corporate_action',
      type: 'split',
      instrumentId,
      effectiveAt: now,
      quantity: '2',
    });
    expect(split.projection.positions[0]).toMatchObject({
      quantity: '20',
      averageCost: '50',
      costBasis: '1000',
    });
    await expect(
      service.applyCorporateAction({
        userId,
        portfolioId: portfolio.id,
        eventKey: 'TST:2026-07-16:SPLIT-2',
        source: 'manual',
        type: 'split',
        instrumentId,
        effectiveAt: now,
        quantity: '2',
      }),
    ).rejects.toMatchObject({ code: 'PORTFOLIO_CORPORATE_ACTION_DUPLICATE' });
    const cutoffAt = new Date('2026-07-16T18:00:00.000Z');
    const valuationAt = new Date('2026-07-16T20:00:00.000Z');
    await db.execute(
      sql`insert into price_bars (instrument_id, provider_id, timeframe, open_time, close_time, open, high, low, close, volume, is_closed, revision, quality_status) values (${instrumentId}::uuid, '00000000-0000-4000-8000-000000000904', '1d', '2026-07-15T15:00:00Z', '2026-07-16T17:00:00Z', 50, 50, 50, 50, 100, true, 1, 'accepted')`,
    );
    const adapter = new PostgresPortfolioValuationRepository(db);
    const valuation = new PortfolioValuationService(adapter, adapter);
    const transactions = await repository.listTransactions(portfolio.id);
    const snapshot = await valuation.value({
      portfolioId: portfolio.id,
      projection: split.projection,
      transactions,
      valuationAt,
      dataCutoffAt: cutoffAt,
    });
    expect(snapshot).toMatchObject({
      status: 'complete',
      ledgerVersion: 3,
      positionsMarketValue: '1000',
      totalValue: '1000',
      unrealizedPnl: '0',
      netContributions: '1000',
    });
    const replay = await valuation.value({
      portfolioId: portfolio.id,
      projection: split.projection,
      transactions,
      valuationAt,
      dataCutoffAt: cutoffAt,
    });
    expect(replay).toMatchObject({
      status: snapshot.status,
      ledgerVersion: snapshot.ledgerVersion,
      totalValue: '1000.0000000000',
      unrealizedPnl: '0.0000000000',
      netContributions: '1000.0000000000',
    });
    const persisted = await db.execute<{
      snapshots: string;
      positions: string;
      actions: string;
    }>(
      sql`select (select count(*) from portfolio_valuation_snapshots where portfolio_id = ${portfolio.id}::uuid)::text snapshots, (select count(*) from portfolio_position_snapshots where portfolio_id = ${portfolio.id}::uuid and data_cutoff_at = ${cutoffAt})::text positions, (select count(*) from portfolio_transactions where portfolio_id = ${portfolio.id}::uuid and corporate_action_identity_hash is not null)::text actions`,
    );
    expect(persisted.rows[0]).toEqual({
      snapshots: '1',
      positions: '1',
      actions: '1',
    });
  });
});
