import type {
  DraftTransactionInput,
  LedgerMutationResult,
  Portfolio,
  PortfolioProjection,
  PortfolioRepository,
  PortfolioTransaction,
} from '@atlas/domain';
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Database } from '../client';
import {
  portfolioCashBalances,
  portfolioPositions,
  portfolios,
  portfolioTransactions,
} from '../schema';

type PortfolioRow = typeof portfolios.$inferSelect;
type TransactionRow = typeof portfolioTransactions.$inferSelect;

export class PostgresPortfolioRepository implements PortfolioRepository {
  constructor(private readonly database: Database) {}
  async listOwned(userId: string, includeDeleted: boolean) {
    const rows = await this.database
      .select()
      .from(portfolios)
      .where(
        includeDeleted
          ? eq(portfolios.userId, userId)
          : and(
              eq(portfolios.userId, userId),
              ne(portfolios.status, 'deleted'),
            ),
      )
      .orderBy(asc(portfolios.createdAt), asc(portfolios.id));
    return rows.map(mapPortfolio);
  }
  async findById(id: string) {
    const row = (
      await this.database
        .select()
        .from(portfolios)
        .where(eq(portfolios.id, id))
        .limit(1)
    )[0];
    return row ? mapPortfolio(row) : null;
  }
  async create(input: Parameters<PortfolioRepository['create']>[0]) {
    const row = (
      await this.database
        .insert(portfolios)
        .values({
          userId: input.userId,
          name: input.name,
          description: input.description,
          defaultBenchmarkCode: input.defaultBenchmarkCode,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning()
    )[0];
    if (!row) throw new Error('Portfolio insert invariant failed');
    return mapPortfolio(row);
  }
  async updateMetadata(
    input: Parameters<PortfolioRepository['updateMetadata']>[0],
  ) {
    const row = (
      await this.database
        .update(portfolios)
        .set({
          name: input.name,
          description: input.description,
          defaultBenchmarkCode: input.defaultBenchmarkCode,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(portfolios.id, input.id),
            eq(portfolios.userId, input.userId),
            ne(portfolios.status, 'deleted'),
          ),
        )
        .returning()
    )[0];
    return row ? mapPortfolio(row) : null;
  }
  async softDelete(id: string, userId: string, now: Date) {
    const row = (
      await this.database
        .update(portfolios)
        .set({ status: 'deleted', deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(portfolios.id, id),
            eq(portfolios.userId, userId),
            ne(portfolios.status, 'deleted'),
          ),
        )
        .returning()
    )[0];
    return row ? mapPortfolio(row) : null;
  }
  async restore(id: string, userId: string, now: Date) {
    const row = (
      await this.database
        .update(portfolios)
        .set({ status: 'active', deletedAt: null, updatedAt: now })
        .where(
          and(
            eq(portfolios.id, id),
            eq(portfolios.userId, userId),
            eq(portfolios.status, 'deleted'),
          ),
        )
        .returning()
    )[0];
    return row ? mapPortfolio(row) : null;
  }
  async listTransactions(portfolioId: string) {
    return (
      await this.database
        .select()
        .from(portfolioTransactions)
        .where(eq(portfolioTransactions.portfolioId, portfolioId))
        .orderBy(
          asc(portfolioTransactions.tradeAt),
          asc(portfolioTransactions.transactionSequence),
          asc(portfolioTransactions.id),
        )
    ).map(mapTransaction);
  }
  async findTransaction(id: string) {
    const row = (
      await this.database
        .select()
        .from(portfolioTransactions)
        .where(eq(portfolioTransactions.id, id))
        .limit(1)
    )[0];
    return row ? mapTransaction(row) : null;
  }
  async findByIdempotency(
    portfolioId: string,
    source: PortfolioTransaction['source'],
    key: string,
  ) {
    const row = (
      await this.database
        .select()
        .from(portfolioTransactions)
        .where(
          and(
            eq(portfolioTransactions.portfolioId, portfolioId),
            eq(portfolioTransactions.source, source),
            eq(portfolioTransactions.idempotencyKeyHash, key),
          ),
        )
        .limit(1)
    )[0];
    return row ? mapTransaction(row) : null;
  }
  async findByCorporateActionIdentity(
    portfolioId: string,
    identityHash: string,
  ) {
    const row = (
      await this.database
        .select()
        .from(portfolioTransactions)
        .where(
          and(
            eq(portfolioTransactions.portfolioId, portfolioId),
            eq(portfolioTransactions.corporateActionIdentityHash, identityHash),
          ),
        )
        .limit(1)
    )[0];
    return row ? mapTransaction(row) : null;
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
    try {
      const row = (
        await this.database
          .insert(portfolioTransactions)
          .values(draftValues(input))
          .returning()
      )[0];
      if (!row) throw new Error('Transaction insert invariant failed');
      return { outcome: 'created' as const, transaction: mapTransaction(row) };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.findByIdempotency(
        input.portfolioId,
        input.source,
        input.idempotencyKeyHash,
      );
      if (!raced && input.corporateActionIdentityHash !== null) {
        const corporateAction = await this.findByCorporateActionIdentity(
          input.portfolioId,
          input.corporateActionIdentityHash,
        );
        if (
          corporateAction?.normalizedTransactionHash ===
          input.normalizedTransactionHash
        )
          return {
            outcome: 'existing' as const,
            transaction: corporateAction,
          };
      }
      if (
        !raced ||
        raced.normalizedTransactionHash !== input.normalizedTransactionHash
      )
        return { outcome: 'conflict' as const };
      return { outcome: 'existing' as const, transaction: raced };
    }
  }
  async updateDraft(input: DraftTransactionInput & { id: string }) {
    const row = (
      await this.database
        .update(portfolioTransactions)
        .set({ ...draftMutableValues(input), updatedAt: input.now })
        .where(
          and(
            eq(portfolioTransactions.id, input.id),
            eq(portfolioTransactions.status, 'draft'),
          ),
        )
        .returning()
    )[0];
    return row ? mapTransaction(row) : null;
  }
  commitPosting(
    input: Parameters<PortfolioRepository['commitPosting']>[0],
  ): Promise<LedgerMutationResult> {
    return this.database
      .transaction(async (tx) => {
        const portfolioRow = (
          await tx
            .update(portfolios)
            .set({
              ledgerVersion: input.projection.ledgerVersion,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(portfolios.id, input.portfolioId),
                eq(portfolios.userId, input.userId),
                eq(portfolios.ledgerVersion, input.expectedLedgerVersion),
                ne(portfolios.status, 'deleted'),
              ),
            )
            .returning()
        )[0];
        if (!portfolioRow) return { outcome: 'conflict' as const };
        const transactionRow = (
          await tx
            .update(portfolioTransactions)
            .set({
              status: 'posted',
              postedAt: input.now,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(portfolioTransactions.id, input.transactionId),
                eq(portfolioTransactions.portfolioId, input.portfolioId),
                eq(portfolioTransactions.status, 'draft'),
              ),
            )
            .returning()
        )[0];
        if (!transactionRow) throw new Error('PORTFOLIO_ATOMIC_CONFLICT');
        await replaceProjection(tx, input.projection, input.now);
        return {
          outcome: 'committed' as const,
          portfolio: mapPortfolio(portfolioRow),
          transaction: mapTransaction(transactionRow),
          projection: input.projection,
        };
      })
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          error.message === 'PORTFOLIO_ATOMIC_CONFLICT'
        )
          return { outcome: 'conflict' as const };
        throw error;
      });
  }
  commitReversal(
    input: Parameters<PortfolioRepository['commitReversal']>[0],
  ): Promise<LedgerMutationResult> {
    return this.database
      .transaction(async (tx) => {
        const portfolioRow = (
          await tx
            .update(portfolios)
            .set({
              ledgerVersion: input.projection.ledgerVersion,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(portfolios.id, input.portfolioId),
                eq(portfolios.userId, input.userId),
                eq(portfolios.ledgerVersion, input.expectedLedgerVersion),
                ne(portfolios.status, 'deleted'),
              ),
            )
            .returning()
        )[0];
        if (!portfolioRow) return { outcome: 'conflict' as const };
        const original = (
          await tx
            .update(portfolioTransactions)
            .set({
              status: 'reversed',
              reversedAt: input.now,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(portfolioTransactions.id, input.originalTransactionId),
                eq(portfolioTransactions.portfolioId, input.portfolioId),
                eq(portfolioTransactions.status, 'posted'),
              ),
            )
            .returning()
        )[0];
        if (!original) throw new Error('PORTFOLIO_ATOMIC_CONFLICT');
        const reversal = (
          await tx
            .insert(portfolioTransactions)
            .values({
              ...draftValues(input.reversal),
              status: 'posted',
              postedAt: input.now,
            })
            .returning()
        )[0];
        if (!reversal) throw new Error('PORTFOLIO_ATOMIC_CONFLICT');
        await replaceProjection(tx, input.projection, input.now);
        return {
          outcome: 'committed' as const,
          portfolio: mapPortfolio(portfolioRow),
          transaction: mapTransaction(reversal),
          projection: input.projection,
        };
      })
      .catch((error: unknown) => {
        if (
          error instanceof Error &&
          (error.message === 'PORTFOLIO_ATOMIC_CONFLICT' ||
            isUniqueViolation(error))
        )
          return { outcome: 'conflict' as const };
        throw error;
      });
  }
  async rebuildProjection(
    input: Parameters<PortfolioRepository['rebuildProjection']>[0],
  ) {
    return this.database.transaction(async (tx) => {
      const owned = (
        await tx
          .select({ id: portfolios.id })
          .from(portfolios)
          .where(
            and(
              eq(portfolios.id, input.portfolioId),
              eq(portfolios.userId, input.userId),
              eq(portfolios.ledgerVersion, input.expectedLedgerVersion),
              ne(portfolios.status, 'deleted'),
            ),
          )
          .limit(1)
      )[0];
      if (!owned) return null;
      await replaceProjection(tx, input.projection, input.now);
      return input.projection;
    });
  }
}

function draftValues(input: DraftTransactionInput) {
  return {
    ...draftMutableValues(input),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function draftMutableValues(input: DraftTransactionInput) {
  return {
    portfolioId: input.portfolioId,
    instrumentId: input.instrumentId,
    reversalOfTransactionId: input.reversalOfTransactionId,
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
  };
}
type TransactionClient = Parameters<Parameters<Database['transaction']>[0]>[0];
async function replaceProjection(
  tx: TransactionClient,
  projection: PortfolioProjection,
  now: Date,
) {
  const portfolioId =
    projection.positions[0]?.portfolioId ??
    projection.cashBalances[0]?.portfolioId;
  if (!portfolioId) throw new Error('Projection portfolio invariant failed');
  await tx
    .delete(portfolioPositions)
    .where(eq(portfolioPositions.portfolioId, portfolioId));
  await tx
    .delete(portfolioCashBalances)
    .where(eq(portfolioCashBalances.portfolioId, portfolioId));
  if (projection.positions.length)
    await tx.insert(portfolioPositions).values(
      projection.positions.map((item) => ({
        portfolioId: item.portfolioId,
        instrumentId: item.instrumentId,
        quantity: item.quantity,
        averageCost: item.averageCost,
        costBasis: item.costBasis,
        realizedPnl: item.realizedPnl,
        dividendIncome: item.dividendIncome,
        projectionLedgerVersion: item.ledgerVersion,
        calculatedAt: item.calculatedAt,
        createdAt: now,
        updatedAt: now,
      })),
    );
  if (projection.cashBalances.length)
    await tx.insert(portfolioCashBalances).values(
      projection.cashBalances.map((item) => ({
        portfolioId: item.portfolioId,
        currencyCode: item.currencyCode,
        balance: item.balance,
        projectionLedgerVersion: item.ledgerVersion,
        calculatedAt: item.calculatedAt,
        createdAt: now,
        updatedAt: now,
      })),
    );
}
function mapPortfolio(row: PortfolioRow): Portfolio {
  return {
    ...row,
    reportingCurrency: 'TRY',
    status: row.status as Portfolio['status'],
  };
}
function mapTransaction(row: TransactionRow): PortfolioTransaction {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    instrumentId: row.instrumentId,
    reversalOfTransactionId: row.reversalOfTransactionId,
    sequence: row.transactionSequence,
    type: row.type as PortfolioTransaction['type'],
    status: row.status as PortfolioTransaction['status'],
    tradeAt: row.tradeAt,
    settlementAt: row.settlementAt,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    fee: row.fee,
    tax: row.tax,
    cashAmount: row.cashAmount,
    source: row.source as PortfolioTransaction['source'],
    externalReference: row.externalReference,
    idempotencyKeyHash: row.idempotencyKeyHash,
    normalizedTransactionHash: row.normalizedTransactionHash,
    corporateActionIdentityHash: row.corporateActionIdentityHash,
    adjustmentReason: row.adjustmentReason,
    note: row.note,
    createdBy: row.createdBy,
    postedAt: row.postedAt,
    reversedAt: row.reversedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === 'object') {
    if ('code' in current && current.code === '23505') return true;
    current = 'cause' in current ? current.cause : null;
  }
  return false;
}
