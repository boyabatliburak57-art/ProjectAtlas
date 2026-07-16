import { createHash } from 'node:crypto';
import type {
  DraftTransactionInput,
  PortfolioTransaction,
  PortfolioTransactionSource,
  PortfolioTransactionType,
} from './contracts.js';
import { parseLedgerDecimal } from './decimal.js';
import { PortfolioError } from './errors.js';

export interface DraftTransactionRequest {
  readonly userId: string;
  readonly portfolioId: string;
  readonly idempotencyKey: string;
  readonly source: PortfolioTransactionSource;
  readonly type: PortfolioTransactionType;
  readonly instrumentId?: string | null;
  readonly tradeAt: Date;
  readonly settlementAt?: Date | null;
  readonly quantity?: string | null;
  readonly unitPrice?: string | null;
  readonly fee?: string;
  readonly tax?: string;
  readonly cashAmount?: string | null;
  readonly externalReference?: string | null;
  readonly corporateActionKey?: string | null;
  readonly adjustmentReason?: string | null;
  readonly note?: string | null;
}

export function normalizeDraft(
  request: DraftTransactionRequest,
  now: Date,
): DraftTransactionInput {
  const key = normalizeRequiredText(
    request.idempotencyKey,
    'idempotencyKey',
    200,
  );
  const instrumentId = normalizeOptionalText(
    request.instrumentId ?? null,
    'instrumentId',
    100,
  );
  const quantity = normalizeDecimal(
    request.quantity ?? null,
    'quantity',
    'positive',
  );
  const unitPrice = normalizeDecimal(
    request.unitPrice ?? null,
    'unitPrice',
    'nonNegative',
  );
  const fee = normalizeDecimal(request.fee ?? '0', 'fee', 'nonNegative') ?? '0';
  const tax = normalizeDecimal(request.tax ?? '0', 'tax', 'nonNegative') ?? '0';
  const cashAmount = normalizeDecimal(
    request.cashAmount ?? null,
    'cashAmount',
    request.type === 'adjustment' ? 'signed' : 'positive',
  );
  const adjustmentReason = normalizeOptionalText(
    request.adjustmentReason ?? null,
    'adjustmentReason',
    1000,
  );
  const note = normalizeOptionalText(request.note ?? null, 'note', 4000);
  const corporateActionKey = normalizeOptionalText(
    request.corporateActionKey ?? null,
    'corporateActionKey',
    500,
  );
  if (
    Number.isNaN(request.tradeAt.getTime()) ||
    (request.settlementAt && Number.isNaN(request.settlementAt.getTime()))
  )
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
      field: 'tradeAt',
    });
  if (
    request.settlementAt !== null &&
    request.settlementAt !== undefined &&
    request.settlementAt < request.tradeAt
  )
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
      field: 'settlementAt',
    });
  if (
    (request.type === 'buy' || request.type === 'sell') &&
    (instrumentId === null || quantity === null || unitPrice === null)
  )
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
      type: request.type,
    });
  if (
    request.type === 'dividend' &&
    (instrumentId === null || cashAmount === null)
  )
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
      type: request.type,
    });
  if (
    (request.type === 'split' || request.type === 'bonusShare') &&
    (instrumentId === null || quantity === null)
  )
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
      type: request.type,
    });
  if (
    request.type === 'rightsIssue' &&
    (instrumentId === null || quantity === null || unitPrice === null)
  )
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
      type: request.type,
    });
  if (request.source === 'corporate_action' && corporateActionKey === null)
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
      field: 'corporateActionKey',
    });
  if (
    ['cashDeposit', 'cashWithdrawal', 'fee', 'tax'].includes(request.type) &&
    cashAmount === null
  )
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
      type: request.type,
    });
  if (
    request.type === 'adjustment' &&
    (cashAmount === null || cashAmount === '0' || adjustmentReason === null)
  )
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
      type: request.type,
    });
  const normalized = {
    portfolioId: request.portfolioId,
    instrumentId,
    type: request.type,
    tradeAt: request.tradeAt.toISOString(),
    settlementAt: request.settlementAt?.toISOString() ?? null,
    quantity,
    unitPrice,
    fee,
    tax,
    cashAmount,
    source: request.source,
    externalReference: normalizeOptionalText(
      request.externalReference ?? null,
      'externalReference',
      500,
    ),
    adjustmentReason,
    note,
    corporateActionKey,
  };
  return {
    ...normalized,
    reversalOfTransactionId: null,
    tradeAt: request.tradeAt,
    settlementAt: request.settlementAt ?? null,
    idempotencyKeyHash: hash(`${request.portfolioId}:${request.source}:${key}`),
    normalizedTransactionHash: hash(JSON.stringify(normalized)),
    corporateActionIdentityHash:
      corporateActionKey === null
        ? null
        : hash(`${request.portfolioId}:${corporateActionKey}`),
    createdBy: request.userId,
    now,
  };
}

export function reversalDraft(
  original: PortfolioTransaction,
  userId: string,
  idempotencyKey: string,
  now: Date,
): DraftTransactionInput {
  const idempotencyKeyHash = hash(
    `${original.portfolioId}:${original.source}:${normalizeRequiredText(idempotencyKey, 'idempotencyKey', 200)}`,
  );
  return {
    portfolioId: original.portfolioId,
    reversalOfTransactionId: original.id,
    instrumentId: original.instrumentId,
    type: original.type,
    tradeAt: now,
    settlementAt: null,
    quantity: original.quantity,
    unitPrice: original.unitPrice,
    fee: original.fee,
    tax: original.tax,
    cashAmount: original.cashAmount,
    source: original.source,
    externalReference: original.externalReference,
    idempotencyKeyHash,
    normalizedTransactionHash: hash(
      JSON.stringify({ reversalOf: original.id }),
    ),
    corporateActionIdentityHash: null,
    adjustmentReason: `Reversal of ${original.id}`,
    note: null,
    createdBy: userId,
    now,
  };
}

function normalizeDecimal(
  value: string | null,
  field: string,
  mode: 'positive' | 'nonNegative' | 'signed',
): string | null {
  if (value === null) return null;
  const options =
    mode === 'positive'
      ? { positive: true }
      : mode === 'nonNegative'
        ? { nonNegative: true }
        : {};
  return parseLedgerDecimal(value, field, options).toDatabaseString(field);
}
function normalizeRequiredText(
  value: string,
  field: string,
  max: number,
): string {
  const result = value.trim();
  if (!result || result.length > max)
    throw new PortfolioError(
      field === 'idempotencyKey'
        ? 'PORTFOLIO_IDEMPOTENCY_KEY_REQUIRED'
        : 'PORTFOLIO_TRANSACTION_INVALID',
      { field },
    );
  return result;
}
function normalizeOptionalText(
  value: string | null,
  field: string,
  max: number,
): string | null {
  if (value === null) return null;
  const result = value.trim();
  if (!result) return null;
  if (
    result.length > max ||
    /<(?:script|iframe|object)\b|\bon\w+\s*=/iu.test(result)
  )
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', { field });
  return result;
}
function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
