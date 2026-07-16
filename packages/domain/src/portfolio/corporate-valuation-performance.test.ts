import { describe, expect, it } from 'vitest';
import type {
  PortfolioProjection,
  PortfolioTransaction,
  ValuationSnapshotRepository,
} from './index.js';
import { projectPortfolioLedger } from './ledger-projector.js';
import {
  alignBenchmark,
  calculatePeriodReturns,
  calculateTwr,
  calculateXirr,
  PERFORMANCE_POLICY,
  totalReturnSeries,
} from './performance.js';
import {
  PortfolioValuationService,
  type PortfolioValuationSnapshot,
  type ValuationPrice,
} from './valuation.js';

const portfolioId = 'portfolio-fixture';
const instrumentId = 'instrument-fixture';
const valuationAt = new Date('2026-07-16T23:00:00.000Z');
const cutoff = new Date('2026-07-16T18:00:00.000Z');

describe('corporate action fixtures', () => {
  it('1. applies a 2:1 split', () => {
    expectPosition(project([buy(), action('split', '2')]), {
      quantity: '20',
      averageCost: '50',
      costBasis: '1000',
    });
  });
  it('2. applies bonus shares without changing total cost', () => {
    expectPosition(project([buy(), action('bonusShare', '5')]), {
      quantity: '15',
      averageCost: '66.6666666667',
      costBasis: '1000',
      realizedPnl: '0',
    });
  });
  it('3. applies a rights issue as new paid quantity', () => {
    const result = project([
      buy(),
      action('rightsIssue', '5', { unitPrice: '50' }),
    ]);
    expectPosition(result, {
      quantity: '15',
      averageCost: '83.3333333333',
      costBasis: '1250',
    });
    expect(result.cashBalances[0]?.balance).toBe('-1250');
  });
  it('4. applies dividend to cash and income', () => {
    const result = project([
      buy(),
      action('dividend', null, { cashAmount: '40' }),
    ]);
    expectPosition(result, { dividendIncome: '40' });
    expect(result.cashBalances[0]?.balance).toBe('-960');
  });
  it('6. leaves total cost unchanged after split', () => {
    const before = project([buy()]);
    const after = project([buy(), action('split', '2')]);
    expect(after.positions[0]?.costBasis).toBe(before.positions[0]?.costBasis);
  });
  it('supports an explicit fractional quantity policy at numeric(28,10)', () => {
    expectPosition(project([buy(), action('split', '1.5')]), {
      quantity: '15',
      averageCost: '66.6666666667',
    });
  });
  it('22. replays corporate actions deterministically', () => {
    const transactions = [
      action('split', '2', { sequence: 2, tradeAt: new Date('2026-02-01') }),
      buy({ sequence: 1, tradeAt: new Date('2026-01-01') }),
      action('rightsIssue', '2.5', {
        sequence: 3,
        unitPrice: '40',
        tradeAt: new Date('2026-03-01'),
      }),
    ];
    expect(project(transactions)).toEqual(project([...transactions].reverse()));
  });
});

describe('valuation fixtures', () => {
  it('7. produces no artificial P&L after a split and adjusted price', async () => {
    const snapshot = await value(project([buy(), action('split', '2')]), [
      price('50'),
    ]);
    expect(snapshot).toMatchObject({ totalValue: '0', unrealizedPnl: '0' });
  });
  it('8. values every priced position, cash, and P&L', async () => {
    const transactions = [cash('cashDeposit', '1200'), buy()];
    const snapshot = await value(
      project(transactions),
      [price('120')],
      transactions,
    );
    expect(snapshot).toMatchObject({
      status: 'complete',
      cashBalance: '200',
      positionsMarketValue: '1200',
      totalValue: '1400',
      unrealizedPnl: '200',
      netContributions: '1200',
    });
  });
  it('9. never treats a missing price as zero', async () => {
    const snapshot = await value(project([buy()]), []);
    expect(snapshot).toMatchObject({
      status: 'notEvaluable',
      positionsMarketValue: '0',
      totalValue: '-1000',
      unrealizedPnl: null,
      missingPriceCount: 1,
    });
    expect(snapshot.positions[0]?.marketValue).toBeNull();
  });
  it('10. marks a selected old price stale while retaining its value', async () => {
    const snapshot = await value(project([buy()]), [
      price('110', new Date('2026-07-01T18:00:00Z')),
    ]);
    expect(snapshot).toMatchObject({
      status: 'partial',
      positionsMarketValue: '1100',
      warnings: [{ code: 'STALE_PRICE' }],
    });
  });
  it('11. supports a cash-only portfolio without a price lookup', async () => {
    let requested = -1;
    const service = new PortfolioValuationService({
      loadPrices: ({ instrumentIds }) => {
        requested = instrumentIds.length;
        return Promise.resolve([]);
      },
    });
    const snapshot = await service.value(
      input(project([cash('cashDeposit', '500')])),
    );
    expect(snapshot).toMatchObject({
      status: 'complete',
      totalValue: '500',
      positions: [],
    });
    expect(requested).toBe(0);
  });
  it('12. uses one logical cutoff and rejects future observations', async () => {
    let received: Date | undefined;
    const service = new PortfolioValuationService({
      loadPrices: (request) => {
        received = request.dataCutoffAt;
        return Promise.resolve([
          price('999', new Date('2026-07-16T19:00:00Z')),
          price('110'),
        ]);
      },
    });
    const snapshot = await service.value(input(project([buy()])));
    expect(received).toEqual(cutoff);
    expect(snapshot.positions[0]?.marketPrice).toBe('110');
    expect(snapshot.positions[0]?.priceAt).toEqual(price('110').closeTime);
  });
  it('13. includes ledger version in cache identity and invalidates older versions', async () => {
    const cache = new MemoryValuationRepository();
    const service = new PortfolioValuationService(
      { loadPrices: () => Promise.resolve([price('100')]) },
      cache,
    );
    const first = await service.value(input(project([buy()], 1)));
    const second = await service.value(input(project([buy()], 2)));
    expect(first.cacheKey).not.toBe(second.cacheKey);
    expect(await service.invalidate(portfolioId, 2)).toBe(1);
  });
  it('separates intraday preview from persistable official snapshots', async () => {
    const service = new PortfolioValuationService({
      loadPrices: () =>
        Promise.resolve([
          { ...price('105'), timeframe: '1m', isClosed: false },
        ]),
    });
    const snapshot = await service.value({
      ...input(project([buy()])),
      mode: 'intradayPreview',
    });
    expect(snapshot).toMatchObject({
      mode: 'intradayPreview',
      persistable: false,
      positionsMarketValue: '1050',
    });
  });
});

describe('performance fixtures', () => {
  it('14. calculates TWR without cash flow', () =>
    expect(
      calculateTwr([point('2026-01-01', '100'), point('2026-01-02', '110')]),
    ).toEqual({ status: 'complete', value: '0.1' }));
  it('15. geometrically links multiple cash-flow subperiods', () =>
    expect(
      calculateTwr([
        point('2026-01-01', '100'),
        point('2026-01-02', '121', '10'),
        point('2026-01-03', '133.1'),
      ]),
    ).toEqual({ status: 'complete', value: '0.21' }));
  it('16. applies same-day external cash flow at beginning of day', () => {
    expect(PERFORMANCE_POLICY.sameDayCashFlow).toBe('beginningOfDay');
    expect(
      calculateTwr([
        point('2026-01-01', '100'),
        point('2026-01-02', '110', '10'),
      ]),
    ).toEqual({ status: 'complete', value: '0' });
  });
  it('17. converges XIRR for irregular dated cash flows', () => {
    const result = calculateXirr([
      { at: new Date('2025-01-01'), amount: '-1000' },
      { at: new Date('2026-01-01'), amount: '1100' },
    ]);
    expect(result.status).toBe('complete');
    expect(
      Number(result.status === 'complete' ? result.value : '0'),
    ).toBeCloseTo(0.1, 8);
  });
  it('18. returns notEvaluable when XIRR has no solution', () =>
    expect(
      calculateXirr([
        { at: new Date('2025-01-01'), amount: '100' },
        { at: new Date('2026-01-01'), amount: '110' },
      ]),
    ).toEqual({ status: 'notEvaluable', reason: 'CASH_FLOW_SIGNS_REQUIRED' }));
  it('rejects ambiguous multiple-sign-change XIRR', () =>
    expect(
      calculateXirr([
        { at: new Date('2025-01-01'), amount: '-100' },
        { at: new Date('2025-06-01'), amount: '300' },
        { at: new Date('2026-01-01'), amount: '-250' },
      ]),
    ).toEqual({
      status: 'notEvaluable',
      reason: 'AMBIGUOUS_MULTIPLE_SIGN_CHANGES',
    }));
  it('19. returns a finite failure for extreme XIRR values', () =>
    expect(
      calculateXirr([
        { at: new Date('2025-01-01'), amount: '-10000000000000000000' },
        { at: new Date('2026-01-01'), amount: '1' },
      ]),
    ).toEqual({ status: 'notEvaluable', reason: 'VALUE_OUT_OF_RANGE' }));
  it('20. aligns benchmark observations by trading date', () => {
    const result = alignBenchmark(
      [
        point('2026-01-01', '100'),
        point('2026-01-02', '105'),
        point('2026-01-03', '110'),
      ],
      [
        { date: '2026-01-01', priceIndex: '100', totalReturnIndex: '100' },
        { date: '2026-01-03', priceIndex: '108', totalReturnIndex: '110' },
      ],
    );
    expect(result).toMatchObject({
      status: 'partial',
      priceReturn: '0.08',
      totalReturn: '0.1',
      alignedDates: ['2026-01-01', '2026-01-03'],
      warnings: ['MISSING_BENCHMARK_DATA'],
    });
  });
  it('21. separates price return from dividend-inclusive total return', () => {
    const series = [
      point('2026-01-01', '100'),
      { ...point('2026-01-02', '100'), dividendIncome: '10' },
    ];
    expect(calculateTwr(series)).toEqual({ status: 'complete', value: '0' });
    expect(calculateTwr(totalReturnSeries(series))).toEqual({
      status: 'complete',
      value: '0.1',
    });
  });
  it('calculates named period returns without NaN or Infinity', () =>
    expect(
      calculatePeriodReturns(
        [point('2026-01-01', '100'), point('2026-01-31', '120')],
        { month: '2026-01-01' },
      ),
    ).toEqual({ month: { status: 'complete', value: '0.2' } }));
});

function project(
  transactions: readonly PortfolioTransaction[],
  ledgerVersion = 1,
): PortfolioProjection {
  return projectPortfolioLedger({
    portfolioId,
    ledgerVersion,
    transactions,
    calculatedAt: valuationAt,
  });
}
function expectPosition(
  projection: PortfolioProjection,
  expected: Record<string, string>,
) {
  expect(projection.positions[0]).toMatchObject(expected);
}
function buy(overrides: Partial<PortfolioTransaction> = {}) {
  return transaction('buy', { quantity: '10', unitPrice: '100', ...overrides });
}
function cash(type: 'cashDeposit' | 'cashWithdrawal', amount: string) {
  return transaction(type, { instrumentId: null, cashAmount: amount });
}
function action(
  type: 'split' | 'bonusShare' | 'rightsIssue' | 'dividend',
  quantity: string | null,
  overrides: Partial<PortfolioTransaction> = {},
) {
  return transaction(type, { quantity, sequence: 2, ...overrides });
}
function transaction(
  type: PortfolioTransaction['type'],
  overrides: Partial<PortfolioTransaction> = {},
): PortfolioTransaction {
  return {
    id: `${type}-${overrides.sequence ?? 1}`,
    portfolioId,
    instrumentId,
    reversalOfTransactionId: null,
    sequence: 1,
    type,
    status: 'posted',
    tradeAt: new Date('2026-01-01T12:00:00Z'),
    settlementAt: null,
    quantity: null,
    unitPrice: null,
    fee: '0',
    tax: '0',
    cashAmount: null,
    source: 'manual',
    externalReference: null,
    idempotencyKeyHash: type,
    normalizedTransactionHash: type,
    corporateActionIdentityHash: null,
    adjustmentReason: null,
    note: null,
    createdBy: 'user',
    postedAt: valuationAt,
    reversedAt: null,
    deletedAt: null,
    createdAt: valuationAt,
    updatedAt: valuationAt,
    ...overrides,
  };
}
function price(
  close: string,
  closeTime = new Date('2026-07-16T17:00:00Z'),
): ValuationPrice {
  return { instrumentId, timeframe: '1d', close, closeTime, isClosed: true };
}
function input(projection: PortfolioProjection) {
  return {
    portfolioId,
    projection,
    transactions: [] as PortfolioTransaction[],
    valuationAt,
    dataCutoffAt: cutoff,
  };
}
async function value(
  projection: PortfolioProjection,
  prices: readonly ValuationPrice[],
  transactions: readonly PortfolioTransaction[] = [],
) {
  return new PortfolioValuationService({
    loadPrices: () => Promise.resolve(prices),
  }).value({ ...input(projection), transactions });
}
function point(date: string, value: string, externalFlow = '0') {
  return { date, value, externalFlow };
}

class MemoryValuationRepository implements ValuationSnapshotRepository {
  private values: PortfolioValuationSnapshot[] = [];
  findByIdentity(
    identity: Parameters<ValuationSnapshotRepository['findByIdentity']>[0],
  ) {
    return Promise.resolve(
      this.values.find((value) => value.cacheKey === identity.cacheKey) ?? null,
    );
  }
  save(snapshot: PortfolioValuationSnapshot) {
    this.values.push(snapshot);
    return Promise.resolve(snapshot);
  }
  invalidatePortfolio(id: string, version: number) {
    const before = this.values.length;
    this.values = this.values.filter(
      (value) => value.portfolioId !== id || value.ledgerVersion === version,
    );
    return Promise.resolve(before - this.values.length);
  }
}
