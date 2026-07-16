import type {
  Portfolio,
  PortfolioApplicationDependencies,
  PortfolioTransaction,
} from './contracts.js';
import { PortfolioError } from './errors.js';
import { projectPortfolioLedger } from './ledger-projector.js';
import {
  normalizeDraft,
  reversalDraft,
  type DraftTransactionRequest,
} from './transaction-normalization.js';

export class PortfolioApplicationService {
  private readonly now: () => Date;
  constructor(private readonly dependencies: PortfolioApplicationDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }
  list(userId: string, includeDeleted = false) {
    return this.dependencies.repository.listOwned(userId, includeDeleted);
  }
  async get(userId: string, portfolioId: string): Promise<Portfolio> {
    return this.requireOwned(userId, portfolioId, true);
  }
  async create(request: {
    userId: string;
    name: string;
    description?: string | null;
    defaultBenchmarkCode?: string | null;
  }): Promise<Portfolio> {
    const now = this.now();
    const portfolio = await this.dependencies.repository.create({
      userId: request.userId,
      name: requiredName(request.name),
      description: optionalText(request.description ?? null, 4000),
      defaultBenchmarkCode: optionalText(
        request.defaultBenchmarkCode ?? null,
        100,
      ),
      now,
    });
    await this.audit(
      'portfolio.created',
      request.userId,
      portfolio,
      undefined,
      now,
    );
    return portfolio;
  }
  async update(request: {
    userId: string;
    portfolioId: string;
    name: string;
    description?: string | null;
    defaultBenchmarkCode?: string | null;
  }): Promise<Portfolio> {
    await this.requireOwned(request.userId, request.portfolioId, false);
    const now = this.now();
    const updated = await this.dependencies.repository.updateMetadata({
      id: request.portfolioId,
      userId: request.userId,
      name: requiredName(request.name),
      description: optionalText(request.description ?? null, 4000),
      defaultBenchmarkCode: optionalText(
        request.defaultBenchmarkCode ?? null,
        100,
      ),
      now,
    });
    if (!updated) throw new PortfolioError('PORTFOLIO_CONFLICT');
    await this.audit(
      'portfolio.updated',
      request.userId,
      updated,
      undefined,
      now,
    );
    return updated;
  }
  async delete(userId: string, portfolioId: string): Promise<Portfolio> {
    await this.requireOwned(userId, portfolioId, false);
    const now = this.now();
    const result = await this.dependencies.repository.softDelete(
      portfolioId,
      userId,
      now,
    );
    if (!result) throw new PortfolioError('PORTFOLIO_CONFLICT');
    await this.audit('portfolio.deleted', userId, result, undefined, now);
    return result;
  }
  async restore(userId: string, portfolioId: string): Promise<Portfolio> {
    await this.requireOwned(userId, portfolioId, true);
    const now = this.now();
    const result = await this.dependencies.repository.restore(
      portfolioId,
      userId,
      now,
    );
    if (!result) throw new PortfolioError('PORTFOLIO_CONFLICT');
    await this.audit('portfolio.restored', userId, result, undefined, now);
    return result;
  }
  async listTransactions(userId: string, portfolioId: string) {
    await this.requireOwned(userId, portfolioId, true);
    return this.dependencies.repository.listTransactions(portfolioId);
  }
  async createDraft(
    request: DraftTransactionRequest,
  ): Promise<{ transaction: PortfolioTransaction; replayed: boolean }> {
    await this.requireOwned(request.userId, request.portfolioId, false);
    const normalized = normalizeDraft(request, this.now());
    if (normalized.corporateActionIdentityHash !== null) {
      const duplicate =
        await this.dependencies.repository.findByCorporateActionIdentity(
          request.portfolioId,
          normalized.corporateActionIdentityHash,
        );
      if (duplicate !== null) {
        if (
          duplicate.idempotencyKeyHash === normalized.idempotencyKeyHash &&
          duplicate.normalizedTransactionHash ===
            normalized.normalizedTransactionHash
        )
          return { transaction: duplicate, replayed: true };
        throw new PortfolioError('PORTFOLIO_CORPORATE_ACTION_DUPLICATE');
      }
    }
    const result =
      await this.dependencies.repository.createDraftIdempotently(normalized);
    if (result.outcome === 'conflict')
      throw new PortfolioError('PORTFOLIO_IDEMPOTENCY_CONFLICT');
    return {
      transaction: result.transaction,
      replayed: result.outcome === 'existing',
    };
  }
  async applyCorporateAction(request: {
    readonly userId: string;
    readonly portfolioId: string;
    readonly eventKey: string;
    readonly source: 'manual' | 'corporate_action';
    readonly type: 'split' | 'bonusShare' | 'rightsIssue' | 'dividend';
    readonly instrumentId: string;
    readonly effectiveAt: Date;
    readonly quantity?: string | undefined;
    readonly unitPrice?: string | undefined;
    readonly cashAmount?: string | undefined;
    readonly note?: string | null | undefined;
  }) {
    const draft = await this.createDraft({
      userId: request.userId,
      portfolioId: request.portfolioId,
      idempotencyKey: `corporate-action:${request.eventKey}`,
      source: request.source,
      type: request.type,
      instrumentId: request.instrumentId,
      tradeAt: request.effectiveAt,
      quantity: request.quantity ?? null,
      unitPrice: request.unitPrice ?? null,
      cashAmount: request.cashAmount ?? null,
      externalReference: request.eventKey,
      corporateActionKey: request.eventKey,
      note: request.note ?? null,
    });
    if (draft.transaction.status === 'posted') {
      return {
        transaction: draft.transaction,
        replayed: true,
        projection: await this.rebuildProjection(
          request.userId,
          request.portfolioId,
        ),
      };
    }
    const posted = await this.post(
      request.userId,
      request.portfolioId,
      draft.transaction.id,
    );
    return { ...posted, replayed: draft.replayed };
  }
  async updateDraft(
    transactionId: string,
    request: DraftTransactionRequest,
  ): Promise<PortfolioTransaction> {
    await this.requireOwned(request.userId, request.portfolioId, false);
    const transaction = await this.requireTransaction(
      request.userId,
      request.portfolioId,
      transactionId,
    );
    if (transaction.status !== 'draft')
      throw new PortfolioError('PORTFOLIO_TRANSACTION_IMMUTABLE');
    const updated = await this.dependencies.repository.updateDraft({
      ...normalizeDraft(request, this.now()),
      id: transactionId,
    });
    if (!updated) throw new PortfolioError('PORTFOLIO_CONFLICT');
    return updated;
  }
  async post(userId: string, portfolioId: string, transactionId: string) {
    const portfolio = await this.requireOwned(userId, portfolioId, false);
    const transaction = await this.requireTransaction(
      userId,
      portfolioId,
      transactionId,
    );
    if (transaction.status !== 'draft')
      throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID_STATE');
    const now = this.now();
    const nextVersion = portfolio.ledgerVersion + 1;
    const transactions = (
      await this.dependencies.repository.listTransactions(portfolioId)
    ).map((item) =>
      item.id === transactionId
        ? { ...item, status: 'posted' as const, postedAt: now, updatedAt: now }
        : item,
    );
    const projection = projectPortfolioLedger({
      portfolioId,
      ledgerVersion: nextVersion,
      transactions,
      calculatedAt: now,
    });
    const result = await this.dependencies.repository.commitPosting({
      portfolioId,
      userId,
      transactionId,
      expectedLedgerVersion: portfolio.ledgerVersion,
      projection,
      now,
    });
    if (result.outcome === 'conflict')
      throw new PortfolioError('PORTFOLIO_CONFLICT');
    await this.audit(
      'portfolio.transaction.posted',
      userId,
      result.portfolio,
      result.transaction,
      now,
    );
    return result;
  }
  async reverse(
    userId: string,
    portfolioId: string,
    transactionId: string,
    idempotencyKey: string,
  ) {
    const portfolio = await this.requireOwned(userId, portfolioId, false);
    const original = await this.requireTransaction(
      userId,
      portfolioId,
      transactionId,
    );
    if (original.status === 'reversed')
      throw new PortfolioError('PORTFOLIO_ALREADY_REVERSED');
    if (
      original.status !== 'posted' ||
      original.reversalOfTransactionId !== null
    )
      throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID_STATE');
    const existing = (
      await this.dependencies.repository.listTransactions(portfolioId)
    ).find((item) => item.reversalOfTransactionId === original.id);
    if (existing) throw new PortfolioError('PORTFOLIO_ALREADY_REVERSED');
    const now = this.now();
    const nextVersion = portfolio.ledgerVersion + 1;
    const reversal = reversalDraft(original, userId, idempotencyKey, now);
    const transactions = (
      await this.dependencies.repository.listTransactions(portfolioId)
    ).map((item) =>
      item.id === original.id
        ? {
            ...item,
            status: 'reversed' as const,
            reversedAt: now,
            updatedAt: now,
          }
        : item,
    );
    const projection = projectPortfolioLedger({
      portfolioId,
      ledgerVersion: nextVersion,
      transactions,
      calculatedAt: now,
    });
    const result = await this.dependencies.repository.commitReversal({
      portfolioId,
      userId,
      originalTransactionId: original.id,
      expectedLedgerVersion: portfolio.ledgerVersion,
      reversal,
      projection,
      now,
    });
    if (result.outcome === 'conflict')
      throw new PortfolioError('PORTFOLIO_CONFLICT');
    await this.audit(
      'portfolio.transaction.reversed',
      userId,
      result.portfolio,
      result.transaction,
      now,
    );
    return result;
  }
  async rebuildProjection(userId: string, portfolioId: string) {
    const portfolio = await this.requireOwned(userId, portfolioId, false);
    const now = this.now();
    const projection = projectPortfolioLedger({
      portfolioId,
      ledgerVersion: portfolio.ledgerVersion,
      transactions:
        await this.dependencies.repository.listTransactions(portfolioId),
      calculatedAt: now,
    });
    const result = await this.dependencies.repository.rebuildProjection({
      portfolioId,
      userId,
      expectedLedgerVersion: portfolio.ledgerVersion,
      projection,
      now,
    });
    if (!result) throw new PortfolioError('PORTFOLIO_CONFLICT');
    await this.audit(
      'portfolio.projection.rebuilt',
      userId,
      portfolio,
      undefined,
      now,
    );
    return result;
  }
  private async requireOwned(
    userId: string,
    portfolioId: string,
    allowDeleted: boolean,
  ): Promise<Portfolio> {
    const portfolio = await this.dependencies.repository.findById(portfolioId);
    if (!portfolio) throw new PortfolioError('PORTFOLIO_NOT_FOUND');
    if (portfolio.userId !== userId)
      throw new PortfolioError('PORTFOLIO_ACCESS_DENIED');
    if (!allowDeleted && portfolio.status === 'deleted')
      throw new PortfolioError('PORTFOLIO_DELETED');
    return portfolio;
  }
  private async requireTransaction(
    userId: string,
    portfolioId: string,
    transactionId: string,
  ): Promise<PortfolioTransaction> {
    const transaction =
      await this.dependencies.repository.findTransaction(transactionId);
    if (!transaction)
      throw new PortfolioError('PORTFOLIO_TRANSACTION_NOT_FOUND');
    if (transaction.portfolioId !== portfolioId)
      throw new PortfolioError('PORTFOLIO_TRANSACTION_ACCESS_DENIED');
    await this.requireOwned(userId, portfolioId, true);
    return transaction;
  }
  private async audit(
    action: string,
    userId: string,
    portfolio: Portfolio,
    transaction: PortfolioTransaction | undefined,
    occurredAt: Date,
  ) {
    await this.dependencies.audit.record({
      action,
      userId,
      portfolioId: portfolio.id,
      transactionId: transaction?.id,
      ledgerVersion: portfolio.ledgerVersion,
      occurredAt,
    });
    this.dependencies.logger.info(action, {
      userId,
      portfolioId: portfolio.id,
      transactionId: transaction?.id,
      ledgerVersion: portfolio.ledgerVersion,
    });
  }
}
function requiredName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200)
    throw new PortfolioError('PORTFOLIO_INVALID', { field: 'name' });
  return normalized;
}
function optionalText(value: string | null, max: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (
    normalized.length > max ||
    /<(?:script|iframe|object)\b|\bon\w+\s*=/iu.test(normalized)
  )
    throw new PortfolioError('PORTFOLIO_INVALID');
  return normalized;
}
