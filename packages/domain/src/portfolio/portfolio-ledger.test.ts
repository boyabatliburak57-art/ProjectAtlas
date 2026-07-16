/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from 'vitest';
import type {
  DraftTransactionInput,
  LedgerMutationResult,
  Portfolio,
  PortfolioProjection,
  PortfolioRepository,
  PortfolioTransaction,
} from './contracts.js';
import { projectPortfolioLedger } from './ledger-projector.js';
import { PortfolioApplicationService } from './portfolio-application-service.js';
import type { DraftTransactionRequest } from './transaction-normalization.js';

const at = new Date('2025-01-01T10:00:00.000Z');
const portfolioId = 'portfolio-1';
const userId = 'user-1';
const instrumentId = 'instrument-1';

describe('portfolio ledger financial fixtures', () => {
  it('1. projects a single buy', () =>
    expectPosition(project([tx('buy', { quantity: '10', unitPrice: '100' })]), {
      quantity: '10',
      averageCost: '100',
      costBasis: '1000',
    }));
  it('2. calculates moving weighted average across two prices', () =>
    expectPosition(
      project([
        tx('buy', { quantity: '10', unitPrice: '100' }),
        tx('buy', { quantity: '10', unitPrice: '200', sequence: 2 }),
      ]),
      { quantity: '20', averageCost: '150', costBasis: '3000' },
    ));
  it('3. allocates buy commission into cost basis', () =>
    expectPosition(
      project([tx('buy', { quantity: '10', unitPrice: '100', fee: '10' })]),
      { averageCost: '101', costBasis: '1010' },
    ));
  it('4. keeps average cost on partial sell', () =>
    expectPosition(
      project([
        tx('buy', { quantity: '10', unitPrice: '100' }),
        tx('sell', { quantity: '4', unitPrice: '150', sequence: 2 }),
      ]),
      {
        quantity: '6',
        averageCost: '100',
        costBasis: '600',
        realizedPnl: '200',
      },
    ));
  it('5. clears cost fields after full sell', () =>
    expectPosition(
      project([
        tx('buy', { quantity: '2', unitPrice: '10' }),
        tx('sell', { quantity: '2', unitPrice: '12', sequence: 2 }),
      ]),
      { quantity: '0', averageCost: '0', costBasis: '0', realizedPnl: '4' },
    ));
  it('6. rejects selling more than the position (no short selling)', () =>
    expect(() =>
      project([
        tx('buy', { quantity: '1', unitPrice: '10' }),
        tx('sell', { quantity: '2', unitPrice: '10', sequence: 2 }),
      ]),
    ).toThrowError(
      expect.objectContaining({ code: 'PORTFOLIO_INSUFFICIENT_POSITION' }),
    ));
  it('7. subtracts sell commission and tax from realized P&L', () =>
    expectPosition(
      project([
        tx('buy', { quantity: '10', unitPrice: '100' }),
        tx('sell', {
          quantity: '4',
          unitPrice: '150',
          fee: '10',
          tax: '5',
          sequence: 2,
        }),
      ]),
      { realizedPnl: '185' },
    ));
  it('8. records dividend income and cash', () => {
    const result = project([tx('dividend', { cashAmount: '25' })]);
    expectPosition(result, { dividendIncome: '25' });
    expect(result.cashBalances[0]?.balance).toBe('25');
  });
  it('9. projects cash deposits and withdrawals', () =>
    expect(
      project([
        tx('cashDeposit', { instrumentId: null, cashAmount: '1000' }),
        tx('cashWithdrawal', {
          instrumentId: null,
          cashAmount: '250',
          sequence: 2,
        }),
      ]).cashBalances[0]?.balance,
    ).toBe('750'));
  it('10. projects standalone fee and tax', () =>
    expect(
      project([
        tx('cashDeposit', { instrumentId: null, cashAmount: '100' }),
        tx('fee', { instrumentId: null, cashAmount: '10', sequence: 2 }),
        tx('tax', { instrumentId: null, cashAmount: '5', sequence: 3 }),
      ]).cashBalances[0]?.balance,
    ).toBe('85'));
  it('16. deterministically replays a backdated transaction', () => {
    const late = tx('sell', {
      quantity: '5',
      unitPrice: '15',
      sequence: 1,
      tradeAt: new Date('2025-01-02'),
    });
    const backdated = tx('buy', {
      quantity: '10',
      unitPrice: '10',
      sequence: 2,
      tradeAt: new Date('2025-01-01'),
    });
    expect(project([late, backdated])).toEqual(project([backdated, late]));
  });
  it('17. retains a zero position projection for auditability', () =>
    expect(
      project([
        tx('buy', { quantity: '1', unitPrice: '1' }),
        tx('sell', { quantity: '1', unitPrice: '1', sequence: 2 }),
      ]).positions,
    ).toHaveLength(1));
  it('18. preserves very small supported decimal quantities', () =>
    expectPosition(
      project([
        tx('buy', { quantity: '0.0000000001', unitPrice: '0.0000000001' }),
      ]),
      { quantity: '0.0000000001' },
    ));
  it('19. supports large values within numeric(28,10)', () =>
    expectPosition(
      project([tx('buy', { quantity: '100000000', unitPrice: '100000000' })]),
      { costBasis: '10000000000000000' },
    ));
});

describe('portfolio application and immutable ledger', () => {
  it('supports portfolio CRUD, soft delete, and restore', async () => {
    const { service } = setup();
    const created = await service.create({ userId, name: ' Core ' });
    expect(created.name).toBe('Core');
    await service.update({ userId, portfolioId: created.id, name: 'Updated' });
    expect((await service.delete(userId, created.id)).status).toBe('deleted');
    expect((await service.restore(userId, created.id)).status).toBe('active');
  });
  it('11. replays the same idempotency key and payload', async () => {
    const { service, portfolio } = setup();
    const first = await service.createDraft(request(portfolio.id, 'same'));
    const second = await service.createDraft(request(portfolio.id, 'same'));
    expect(second).toEqual({ transaction: first.transaction, replayed: true });
  });
  it('12. rejects the same key with a different payload', async () => {
    const { service, portfolio } = setup();
    await service.createDraft(request(portfolio.id, 'same'));
    await expect(
      service.createDraft({ ...request(portfolio.id, 'same'), quantity: '2' }),
    ).rejects.toMatchObject({ code: 'PORTFOLIO_IDEMPOTENCY_CONFLICT' });
  });
  it('13. prevents direct changes to a posted transaction', async () => {
    const { service, portfolio } = setup();
    const draft = await service.createDraft(request(portfolio.id, 'post'));
    await service.post(userId, portfolio.id, draft.transaction.id);
    await expect(
      service.updateDraft(
        draft.transaction.id,
        request(portfolio.id, 'updated'),
      ),
    ).rejects.toMatchObject({ code: 'PORTFOLIO_TRANSACTION_IMMUTABLE' });
  });
  it('14. reverses a posted transaction and increments ledger version', async () => {
    const { service, portfolio } = setup();
    const draft = await service.createDraft(request(portfolio.id, 'post'));
    await service.post(userId, portfolio.id, draft.transaction.id);
    const reversed = await service.reverse(
      userId,
      portfolio.id,
      draft.transaction.id,
      'reverse',
    );
    expect(reversed.portfolio.ledgerVersion).toBe(2);
    expect(reversed.projection.positions).toHaveLength(0);
    expect(reversed.transaction.reversalOfTransactionId).toBe(
      draft.transaction.id,
    );
  });
  it('15. rejects a second reversal', async () => {
    const { service, portfolio } = setup();
    const draft = await service.createDraft(request(portfolio.id, 'post'));
    await service.post(userId, portfolio.id, draft.transaction.id);
    await service.reverse(
      userId,
      portfolio.id,
      draft.transaction.id,
      'reverse',
    );
    await expect(
      service.reverse(userId, portfolio.id, draft.transaction.id, 'reverse-2'),
    ).rejects.toMatchObject({ code: 'PORTFOLIO_ALREADY_REVERSED' });
  });
  it('rebuilds projections deterministically without changing ledger version', async () => {
    const { service, portfolio, repository } = setup();
    const draft = await service.createDraft(request(portfolio.id, 'post'));
    const posted = await service.post(
      userId,
      portfolio.id,
      draft.transaction.id,
    );
    const rebuilt = await service.rebuildProjection(userId, portfolio.id);
    expect(stripTimes(rebuilt)).toEqual(stripTimes(posted.projection));
    expect(repository.portfolios[0]?.ledgerVersion).toBe(1);
  });
  it('20. enforces ownership and returns an IDOR-safe access error', async () => {
    const { service, portfolio } = setup();
    await expect(service.get('attacker', portfolio.id)).rejects.toMatchObject({
      code: 'PORTFOLIO_ACCESS_DENIED',
    });
    await expect(
      service.createDraft({
        ...request(portfolio.id, 'x'),
        userId: 'attacker',
      }),
    ).rejects.toMatchObject({ code: 'PORTFOLIO_ACCESS_DENIED' });
  });
  it('keeps manual and import idempotency namespaces separate', async () => {
    const { service, portfolio } = setup();
    const manual = await service.createDraft(request(portfolio.id, 'same'));
    const imported = await service.createDraft({
      ...request(portfolio.id, 'same'),
      source: 'csv_import',
    });
    expect(imported.transaction.id).not.toBe(manual.transaction.id);
  });
  it('5. prevents provider and manual application of the same corporate action', async () => {
    const { service, portfolio } = setup();
    const initial = await service.createDraft(request(portfolio.id, 'initial'));
    await service.post(userId, portfolio.id, initial.transaction.id);
    await service.applyCorporateAction({
      userId,
      portfolioId: portfolio.id,
      eventKey: 'TST:2026-02-01:SPLIT',
      source: 'corporate_action',
      type: 'split',
      instrumentId,
      effectiveAt: new Date('2026-02-01'),
      quantity: '2',
    });
    await expect(
      service.applyCorporateAction({
        userId,
        portfolioId: portfolio.id,
        eventKey: 'TST:2026-02-01:SPLIT',
        source: 'manual',
        type: 'split',
        instrumentId,
        effectiveAt: new Date('2026-02-01'),
        quantity: '2',
      }),
    ).rejects.toMatchObject({ code: 'PORTFOLIO_CORPORATE_ACTION_DUPLICATE' });
  });
  it('requires a reason for adjustment transactions', async () => {
    const { service, portfolio } = setup();
    await expect(
      service.createDraft({
        ...request(portfolio.id, 'adjust'),
        type: 'adjustment',
        instrumentId: null,
        quantity: null,
        unitPrice: null,
        cashAmount: '1',
      }),
    ).rejects.toMatchObject({ code: 'PORTFOLIO_TRANSACTION_INVALID' });
  });
});

function project(transactions: PortfolioTransaction[]): PortfolioProjection {
  return projectPortfolioLedger({
    portfolioId,
    ledgerVersion: 1,
    transactions,
    calculatedAt: at,
  });
}
function expectPosition(
  projection: PortfolioProjection,
  expected: Record<string, string>,
) {
  expect(projection.positions[0]).toMatchObject(expected);
}
function tx(
  type: PortfolioTransaction['type'],
  overrides: Partial<PortfolioTransaction> = {},
): PortfolioTransaction {
  return {
    id: `tx-${overrides.sequence ?? 1}-${type}`,
    portfolioId,
    instrumentId,
    reversalOfTransactionId: null,
    sequence: 1,
    type,
    status: 'posted',
    tradeAt: at,
    settlementAt: null,
    quantity: null,
    unitPrice: null,
    fee: '0',
    tax: '0',
    cashAmount: null,
    source: 'manual',
    externalReference: null,
    idempotencyKeyHash: 'key',
    normalizedTransactionHash: 'payload',
    corporateActionIdentityHash: null,
    adjustmentReason: null,
    note: null,
    createdBy: userId,
    postedAt: at,
    reversedAt: null,
    deletedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}
function request(id: string, key: string): DraftTransactionRequest {
  return {
    userId,
    portfolioId: id,
    idempotencyKey: key,
    source: 'manual',
    type: 'buy',
    instrumentId,
    tradeAt: at,
    quantity: '1',
    unitPrice: '10',
  };
}
function stripTimes(value: PortfolioProjection) {
  return {
    ledgerVersion: value.ledgerVersion,
    positions: value.positions.map((item) => ({
      portfolioId: item.portfolioId,
      instrumentId: item.instrumentId,
      quantity: item.quantity,
      averageCost: item.averageCost,
      costBasis: item.costBasis,
      realizedPnl: item.realizedPnl,
      dividendIncome: item.dividendIncome,
      ledgerVersion: item.ledgerVersion,
    })),
    cashBalances: value.cashBalances.map((item) => ({
      portfolioId: item.portfolioId,
      currencyCode: item.currencyCode,
      balance: item.balance,
      ledgerVersion: item.ledgerVersion,
    })),
  };
}

class MemoryRepository implements PortfolioRepository {
  portfolios: Portfolio[];
  transactions: PortfolioTransaction[] = [];
  projection: PortfolioProjection | null = null;
  private nextId = 2;
  constructor(portfolio: Portfolio) {
    this.portfolios = [portfolio];
  }
  async listOwned(owner: string, includeDeleted: boolean) {
    return this.portfolios.filter(
      (item) =>
        item.userId === owner && (includeDeleted || item.status !== 'deleted'),
    );
  }
  async findById(id: string) {
    return this.portfolios.find((item) => item.id === id) ?? null;
  }
  async create(input: Parameters<PortfolioRepository['create']>[0]) {
    const result: Portfolio = {
      id: `portfolio-${this.nextId++}`,
      userId: input.userId,
      name: input.name,
      description: input.description,
      reportingCurrency: 'TRY',
      defaultBenchmarkCode: input.defaultBenchmarkCode,
      status: 'active',
      ledgerVersion: 0,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    };
    this.portfolios.push(result);
    return result;
  }
  async updateMetadata(
    input: Parameters<PortfolioRepository['updateMetadata']>[0],
  ) {
    const found = this.portfolios.find(
      (item) =>
        item.id === input.id &&
        item.userId === input.userId &&
        item.status !== 'deleted',
    );
    if (!found) return null;
    const result = {
      ...found,
      name: input.name,
      description: input.description,
      defaultBenchmarkCode: input.defaultBenchmarkCode,
      updatedAt: input.now,
    };
    this.replacePortfolio(result);
    return result;
  }
  async softDelete(id: string, owner: string, now: Date) {
    const found = this.portfolios.find(
      (item) =>
        item.id === id && item.userId === owner && item.status !== 'deleted',
    );
    if (!found) return null;
    const result: Portfolio = {
      ...found,
      status: 'deleted',
      deletedAt: now,
      updatedAt: now,
    };
    this.replacePortfolio(result);
    return result;
  }
  async restore(id: string, owner: string, now: Date) {
    const found = this.portfolios.find(
      (item) =>
        item.id === id && item.userId === owner && item.status === 'deleted',
    );
    if (!found) return null;
    const result: Portfolio = {
      ...found,
      status: 'active',
      deletedAt: null,
      updatedAt: now,
    };
    this.replacePortfolio(result);
    return result;
  }
  async listTransactions(id: string) {
    return this.transactions.filter((item) => item.portfolioId === id);
  }
  async findTransaction(id: string) {
    return this.transactions.find((item) => item.id === id) ?? null;
  }
  async findByIdempotency(
    id: string,
    source: PortfolioTransaction['source'],
    key: string,
  ) {
    return (
      this.transactions.find(
        (item) =>
          item.portfolioId === id &&
          item.source === source &&
          item.idempotencyKeyHash === key,
      ) ?? null
    );
  }
  async findByCorporateActionIdentity(id: string, identityHash: string) {
    return (
      this.transactions.find(
        (item) =>
          item.portfolioId === id &&
          item.corporateActionIdentityHash === identityHash,
      ) ?? null
    );
  }
  async createDraftIdempotently(input: DraftTransactionInput) {
    const existing = await this.findByIdempotency(
      input.portfolioId,
      input.source,
      input.idempotencyKeyHash,
    );
    if (existing)
      return existing.normalizedTransactionHash ===
        input.normalizedTransactionHash
        ? { outcome: 'existing' as const, transaction: existing }
        : { outcome: 'conflict' as const };
    const transaction = makeDraft(
      input,
      `transaction-${this.nextId++}`,
      this.transactions.length + 1,
    );
    this.transactions.push(transaction);
    return { outcome: 'created' as const, transaction };
  }
  async updateDraft(input: DraftTransactionInput & { id: string }) {
    const index = this.transactions.findIndex(
      (item) => item.id === input.id && item.status === 'draft',
    );
    if (index < 0) return null;
    const transaction = makeDraft(
      input,
      input.id,
      this.transactions[index]?.sequence ?? 0,
    );
    this.transactions[index] = transaction;
    return transaction;
  }
  async commitPosting(
    input: Parameters<PortfolioRepository['commitPosting']>[0],
  ): Promise<LedgerMutationResult> {
    const portfolio = this.portfolios.find(
      (item) =>
        item.id === input.portfolioId &&
        item.userId === input.userId &&
        item.ledgerVersion === input.expectedLedgerVersion,
    );
    const index = this.transactions.findIndex(
      (item) => item.id === input.transactionId && item.status === 'draft',
    );
    if (!portfolio || index < 0) return { outcome: 'conflict' };
    const transaction: PortfolioTransaction = {
      ...this.transactions[index]!,
      status: 'posted',
      postedAt: input.now,
      updatedAt: input.now,
    };
    this.transactions[index] = transaction;
    const updated = {
      ...portfolio,
      ledgerVersion: input.projection.ledgerVersion,
      updatedAt: input.now,
    };
    this.replacePortfolio(updated);
    this.projection = input.projection;
    return {
      outcome: 'committed',
      portfolio: updated,
      transaction,
      projection: input.projection,
    };
  }
  async commitReversal(
    input: Parameters<PortfolioRepository['commitReversal']>[0],
  ): Promise<LedgerMutationResult> {
    const portfolio = this.portfolios.find(
      (item) =>
        item.id === input.portfolioId &&
        item.userId === input.userId &&
        item.ledgerVersion === input.expectedLedgerVersion,
    );
    const index = this.transactions.findIndex(
      (item) =>
        item.id === input.originalTransactionId && item.status === 'posted',
    );
    if (
      !portfolio ||
      index < 0 ||
      this.transactions.some(
        (item) => item.reversalOfTransactionId === input.originalTransactionId,
      )
    )
      return { outcome: 'conflict' };
    this.transactions[index] = {
      ...this.transactions[index]!,
      status: 'reversed',
      reversedAt: input.now,
      updatedAt: input.now,
    };
    const transaction: PortfolioTransaction = {
      ...makeDraft(
        input.reversal,
        `transaction-${this.nextId++}`,
        this.transactions.length + 1,
      ),
      status: 'posted',
      postedAt: input.now,
    };
    this.transactions.push(transaction);
    const updated = {
      ...portfolio,
      ledgerVersion: input.projection.ledgerVersion,
      updatedAt: input.now,
    };
    this.replacePortfolio(updated);
    this.projection = input.projection;
    return {
      outcome: 'committed',
      portfolio: updated,
      transaction,
      projection: input.projection,
    };
  }
  async rebuildProjection(
    input: Parameters<PortfolioRepository['rebuildProjection']>[0],
  ) {
    const portfolio = this.portfolios.find(
      (item) =>
        item.id === input.portfolioId &&
        item.userId === input.userId &&
        item.ledgerVersion === input.expectedLedgerVersion,
    );
    if (!portfolio) return null;
    this.projection = input.projection;
    return input.projection;
  }
  private replacePortfolio(value: Portfolio) {
    this.portfolios = this.portfolios.map((item) =>
      item.id === value.id ? value : item,
    );
  }
}
function makeDraft(
  input: DraftTransactionInput,
  id: string,
  sequence: number,
): PortfolioTransaction {
  return {
    id,
    portfolioId: input.portfolioId,
    instrumentId: input.instrumentId,
    reversalOfTransactionId: input.reversalOfTransactionId,
    sequence,
    type: input.type,
    status: 'draft',
    tradeAt: input.tradeAt,
    settlementAt: input.settlementAt,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    fee: input.fee,
    tax: input.tax,
    cashAmount: input.cashAmount,
    source: input.source,
    externalReference: input.externalReference,
    idempotencyKeyHash: input.idempotencyKeyHash,
    normalizedTransactionHash: input.normalizedTransactionHash,
    corporateActionIdentityHash: input.corporateActionIdentityHash,
    adjustmentReason: input.adjustmentReason,
    note: input.note,
    createdBy: input.createdBy,
    postedAt: null,
    reversedAt: null,
    deletedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
function setup() {
  const portfolio: Portfolio = {
    id: portfolioId,
    userId,
    name: 'Portfolio',
    description: null,
    reportingCurrency: 'TRY',
    defaultBenchmarkCode: null,
    status: 'active',
    ledgerVersion: 0,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
  };
  const repository = new MemoryRepository(portfolio);
  const service = new PortfolioApplicationService({
    repository,
    audit: { record: () => Promise.resolve() },
    logger: { info: () => undefined },
    now: () => at,
  });
  return { service, repository, portfolio };
}
