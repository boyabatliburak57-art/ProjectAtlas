export type PortfolioStatus = 'active' | 'archived' | 'deleted';
export type PortfolioTransactionStatus =
  | 'draft'
  | 'posted'
  | 'reversed'
  | 'deleted';
export type PortfolioTransactionSource =
  | 'manual'
  | 'csv_import'
  | 'corporate_action'
  | 'system';
export type PortfolioTransactionType =
  | 'buy'
  | 'sell'
  | 'cashDeposit'
  | 'cashWithdrawal'
  | 'dividend'
  | 'fee'
  | 'tax'
  | 'split'
  | 'bonusShare'
  | 'rightsIssue'
  | 'adjustment';

export interface Portfolio {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string | null;
  readonly reportingCurrency: 'TRY';
  readonly defaultBenchmarkCode: string | null;
  readonly status: PortfolioStatus;
  readonly ledgerVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

export interface PortfolioTransaction {
  readonly id: string;
  readonly portfolioId: string;
  readonly instrumentId: string | null;
  readonly reversalOfTransactionId: string | null;
  readonly sequence: number;
  readonly type: PortfolioTransactionType;
  readonly status: PortfolioTransactionStatus;
  readonly tradeAt: Date;
  readonly settlementAt: Date | null;
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly fee: string;
  readonly tax: string;
  readonly cashAmount: string | null;
  readonly source: PortfolioTransactionSource;
  readonly externalReference: string | null;
  readonly idempotencyKeyHash: string;
  readonly normalizedTransactionHash: string;
  readonly corporateActionIdentityHash: string | null;
  readonly adjustmentReason: string | null;
  readonly note: string | null;
  readonly createdBy: string;
  readonly postedAt: Date | null;
  readonly reversedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PositionProjection {
  readonly portfolioId: string;
  readonly instrumentId: string;
  readonly quantity: string;
  readonly averageCost: string;
  readonly costBasis: string;
  readonly realizedPnl: string;
  readonly dividendIncome: string;
  readonly ledgerVersion: number;
  readonly calculatedAt: Date;
}

export interface CashBalanceProjection {
  readonly portfolioId: string;
  readonly currencyCode: 'TRY';
  readonly balance: string;
  readonly ledgerVersion: number;
  readonly calculatedAt: Date;
}

export interface PortfolioProjection {
  readonly ledgerVersion: number;
  readonly positions: readonly PositionProjection[];
  readonly cashBalances: readonly CashBalanceProjection[];
}

export interface DraftTransactionInput {
  readonly portfolioId: string;
  readonly reversalOfTransactionId: string | null;
  readonly instrumentId: string | null;
  readonly type: PortfolioTransactionType;
  readonly tradeAt: Date;
  readonly settlementAt: Date | null;
  readonly quantity: string | null;
  readonly unitPrice: string | null;
  readonly fee: string;
  readonly tax: string;
  readonly cashAmount: string | null;
  readonly source: PortfolioTransactionSource;
  readonly externalReference: string | null;
  readonly idempotencyKeyHash: string;
  readonly normalizedTransactionHash: string;
  readonly corporateActionIdentityHash: string | null;
  readonly adjustmentReason: string | null;
  readonly note: string | null;
  readonly createdBy: string;
  readonly now: Date;
}

export type IdempotentDraftResult =
  | { readonly outcome: 'created'; readonly transaction: PortfolioTransaction }
  | { readonly outcome: 'existing'; readonly transaction: PortfolioTransaction }
  | { readonly outcome: 'conflict' };

export type LedgerMutationResult =
  | {
      readonly outcome: 'committed';
      readonly portfolio: Portfolio;
      readonly transaction: PortfolioTransaction;
      readonly projection: PortfolioProjection;
    }
  | { readonly outcome: 'conflict' };

export interface PortfolioRepository {
  listOwned(
    userId: string,
    includeDeleted: boolean,
  ): Promise<readonly Portfolio[]>;
  findById(id: string): Promise<Portfolio | null>;
  create(input: {
    readonly userId: string;
    readonly name: string;
    readonly description: string | null;
    readonly defaultBenchmarkCode: string | null;
    readonly now: Date;
  }): Promise<Portfolio>;
  updateMetadata(input: {
    readonly id: string;
    readonly userId: string;
    readonly name: string;
    readonly description: string | null;
    readonly defaultBenchmarkCode: string | null;
    readonly now: Date;
  }): Promise<Portfolio | null>;
  softDelete(id: string, userId: string, now: Date): Promise<Portfolio | null>;
  restore(id: string, userId: string, now: Date): Promise<Portfolio | null>;
  listTransactions(
    portfolioId: string,
  ): Promise<readonly PortfolioTransaction[]>;
  findTransaction(id: string): Promise<PortfolioTransaction | null>;
  findByIdempotency(
    portfolioId: string,
    source: PortfolioTransactionSource,
    idempotencyKeyHash: string,
  ): Promise<PortfolioTransaction | null>;
  findByCorporateActionIdentity(
    portfolioId: string,
    identityHash: string,
  ): Promise<PortfolioTransaction | null>;
  createDraftIdempotently(
    input: DraftTransactionInput,
  ): Promise<IdempotentDraftResult>;
  updateDraft(
    input: DraftTransactionInput & { readonly id: string },
  ): Promise<PortfolioTransaction | null>;
  commitPosting(input: {
    readonly portfolioId: string;
    readonly userId: string;
    readonly transactionId: string;
    readonly expectedLedgerVersion: number;
    readonly projection: PortfolioProjection;
    readonly now: Date;
  }): Promise<LedgerMutationResult>;
  commitReversal(input: {
    readonly portfolioId: string;
    readonly userId: string;
    readonly originalTransactionId: string;
    readonly expectedLedgerVersion: number;
    readonly reversal: DraftTransactionInput;
    readonly projection: PortfolioProjection;
    readonly now: Date;
  }): Promise<LedgerMutationResult>;
  rebuildProjection(input: {
    readonly portfolioId: string;
    readonly userId: string;
    readonly expectedLedgerVersion: number;
    readonly projection: PortfolioProjection;
    readonly now: Date;
  }): Promise<PortfolioProjection | null>;
}

export interface PortfolioAuditPort {
  record(event: {
    readonly action: string;
    readonly userId: string;
    readonly portfolioId: string;
    readonly transactionId?: string | undefined;
    readonly ledgerVersion: number;
    readonly occurredAt: Date;
  }): Promise<void>;
}

export interface PortfolioLoggerPort {
  info(event: string, fields: Readonly<Record<string, unknown>>): void;
}

export interface PortfolioApplicationDependencies {
  readonly repository: PortfolioRepository;
  readonly audit: PortfolioAuditPort;
  readonly logger: PortfolioLoggerPort;
  readonly now?: (() => Date) | undefined;
}
