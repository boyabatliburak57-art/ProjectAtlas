import {
  PortfolioRiskApplicationService,
  type DailyPortfolioValue,
} from '@atlas/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../client';
import { runMigrations } from '../migration';
import { PostgresPortfolioRiskRepository } from './postgres-portfolio-risk-repository';

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}

const portfolioId = '00000000-0000-4000-8000-000000000951';
const userId = '00000000-0000-4000-8000-000000000952';

describe('Postgres portfolio risk snapshots', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  const repository = new PostgresPortfolioRiskRepository(db);
  const logs: string[] = [];
  const service = new PortfolioRiskApplicationService({
    repository,
    logger: { info: (event) => logs.push(event) },
  });

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await db.execute(sql`
      insert into portfolios (id, user_id, name, reporting_currency, status, ledger_version)
      values (${portfolioId}::uuid, ${userId}::uuid, 'Risk fixture', 'TRY', 'active', 1)
    `);
  });

  afterAll(async () => pool.end());

  it('persists metric methodology and normalized exposures idempotently', async () => {
    const input = riskInput(1);
    const first = await service.calculate(input);
    const replay = await service.calculate(input);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      status: 'complete',
      observationCount: 101,
      riskPolicyVersion: 'historical-risk-v1',
      volatility: { status: 'complete' },
      beta: { status: 'complete' },
      historicalVar95: { status: 'complete' },
      concentration: { status: 'complete' },
    });
    expect(logs).toContain('portfolio.risk.calculated');
    expect(logs).toContain('portfolio.risk.cache_hit');
    const persisted = await db.execute<{
      snapshots: string;
      exposures: string;
      finite_metrics: boolean;
    }>(sql`
      select
        (select count(*) from portfolio_risk_snapshots where portfolio_id = ${portfolioId}::uuid)::text snapshots,
        (select count(*) from portfolio_risk_exposures where portfolio_id = ${portfolioId}::uuid)::text exposures,
        not exists (
          select 1 from portfolio_risk_snapshots
          where portfolio_id = ${portfolioId}::uuid
            and (volatility = 'NaN'::numeric or beta = 'NaN'::numeric or historical_var_95 = 'NaN'::numeric)
        ) finite_metrics
    `);
    expect(persisted.rows[0]).toEqual({
      snapshots: '1',
      exposures: '5',
      finite_metrics: true,
    });
  });

  it('invalidates an older ledger-version snapshot through cascade', async () => {
    expect(await service.invalidate(portfolioId, 2)).toBe(1);
    const remaining = await db.execute<{
      snapshots: string;
      exposures: string;
    }>(sql`
      select
        (select count(*) from portfolio_risk_snapshots where portfolio_id = ${portfolioId}::uuid)::text snapshots,
        (select count(*) from portfolio_risk_exposures where portfolio_id = ${portfolioId}::uuid)::text exposures
    `);
    expect(remaining.rows[0]).toEqual({ snapshots: '0', exposures: '0' });
  });
});

function riskInput(ledgerVersion: number) {
  const portfolioValues = series(102, 11);
  const benchmarkValues = series(102, 7);
  return {
    portfolioId,
    ledgerVersion,
    valuationSeriesVersion: 4,
    rangeStartAt: new Date('2026-01-01T00:00:00Z'),
    rangeEndAt: new Date('2026-04-12T00:00:00Z'),
    dataCutoffAt: new Date('2026-04-12T18:00:00Z'),
    benchmarkCode: 'XU100',
    portfolioValues,
    benchmarkValues,
    positions: [
      { instrumentId: 'A', marketValue: '60', sectorId: 'BANK' },
      { instrumentId: 'B', marketValue: '30', sectorId: null },
    ],
    cashValue: '10',
  };
}

function series(size: number, cycle: number): DailyPortfolioValue[] {
  let value = 100;
  return Array.from({ length: size }, (_, index) => {
    if (index > 0) value *= 1 + ((index % cycle) - (cycle - 1) / 2) / 1000;
    return {
      date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
      value: value.toFixed(10),
      externalFlow: '0',
    };
  });
}
