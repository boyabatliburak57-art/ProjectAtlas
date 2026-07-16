import type {
  CashBalanceProjection,
  PortfolioProjection,
  PortfolioTransaction,
  PositionProjection,
} from './contracts.js';
import { Decimal, parseLedgerDecimal } from './decimal.js';
import { PortfolioError } from './errors.js';

interface MutablePosition {
  quantity: Decimal;
  averageCost: Decimal;
  costBasis: Decimal;
  realizedPnl: Decimal;
  dividendIncome: Decimal;
}

export function projectPortfolioLedger(input: {
  readonly portfolioId: string;
  readonly ledgerVersion: number;
  readonly transactions: readonly PortfolioTransaction[];
  readonly calculatedAt: Date;
}): PortfolioProjection {
  const positions = new Map<string, MutablePosition>();
  let cash = Decimal.ZERO;
  const ordered = [...input.transactions]
    .filter(
      (transaction) =>
        transaction.status === 'posted' &&
        transaction.reversalOfTransactionId === null,
    )
    .sort(
      (left, right) =>
        left.tradeAt.getTime() - right.tradeAt.getTime() ||
        left.sequence - right.sequence ||
        left.id.localeCompare(right.id),
    );

  for (const transaction of ordered) {
    const fee = parseLedgerDecimal(transaction.fee, 'fee', {
      nonNegative: true,
    });
    const tax = parseLedgerDecimal(transaction.tax, 'tax', {
      nonNegative: true,
    });
    const amount =
      transaction.cashAmount === null
        ? null
        : parseLedgerDecimal(transaction.cashAmount, 'cashAmount');
    if (transaction.type === 'cashDeposit')
      cash = cash.plus(requiredPositive(amount, 'cashAmount'));
    else if (
      transaction.type === 'cashWithdrawal' ||
      transaction.type === 'fee' ||
      transaction.type === 'tax'
    )
      cash = cash.minus(requiredPositive(amount, 'cashAmount'));
    else if (transaction.type === 'adjustment')
      cash = cash.plus(required(amount, 'cashAmount'));
    else if (transaction.type === 'dividend') {
      const position = getPosition(positions, requiredInstrument(transaction));
      const dividend = requiredPositive(amount, 'cashAmount');
      position.dividendIncome = position.dividendIncome.plus(dividend);
      cash = cash.plus(dividend);
    } else if (
      transaction.type === 'split' ||
      transaction.type === 'bonusShare'
    ) {
      const position = getPosition(positions, requiredInstrument(transaction));
      if (position.quantity.isZero())
        throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', {
          transactionId: transaction.id,
          reason: 'corporate_action_without_position',
        });
      const actionQuantity = requiredPositive(
        transaction.quantity === null
          ? null
          : parseLedgerDecimal(transaction.quantity, 'quantity'),
        'quantity',
      );
      const newQuantity =
        transaction.type === 'split'
          ? position.quantity.times(actionQuantity)
          : position.quantity.plus(actionQuantity);
      position.quantity = newQuantity;
      position.averageCost = position.costBasis.dividedBy(newQuantity);
    } else {
      const position = getPosition(positions, requiredInstrument(transaction));
      const quantity = requiredPositive(
        transaction.quantity === null
          ? null
          : parseLedgerDecimal(transaction.quantity, 'quantity'),
        'quantity',
      );
      const unitPrice = required(
        transaction.unitPrice === null
          ? null
          : parseLedgerDecimal(transaction.unitPrice, 'unitPrice', {
              nonNegative: true,
            }),
        'unitPrice',
      );
      const gross = quantity.times(unitPrice);
      if (transaction.type === 'buy' || transaction.type === 'rightsIssue') {
        const newQuantity = position.quantity.plus(quantity);
        const newCostBasis = position.quantity
          .times(position.averageCost)
          .plus(gross)
          .plus(fee);
        position.quantity = newQuantity;
        position.costBasis = newCostBasis;
        position.averageCost = newCostBasis.dividedBy(newQuantity);
        cash = cash.minus(gross.plus(fee).plus(tax));
      } else if (transaction.type === 'sell') {
        if (quantity.compare(position.quantity) > 0) {
          throw new PortfolioError('PORTFOLIO_INSUFFICIENT_POSITION', {
            transactionId: transaction.id,
          });
        }
        const soldCost = quantity.times(position.averageCost);
        const netProceeds = gross.minus(fee).minus(tax);
        position.quantity = position.quantity.minus(quantity);
        position.costBasis = position.quantity.isZero()
          ? Decimal.ZERO
          : position.quantity.times(position.averageCost);
        if (position.quantity.isZero()) position.averageCost = Decimal.ZERO;
        position.realizedPnl = position.realizedPnl.plus(
          netProceeds.minus(soldCost),
        );
        cash = cash.plus(netProceeds);
      }
    }
  }

  const projectedPositions: PositionProjection[] = [...positions.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([instrumentId, position]) => ({
      portfolioId: input.portfolioId,
      instrumentId,
      quantity: position.quantity.toDatabaseString('quantity'),
      averageCost: position.averageCost.toDatabaseString('averageCost'),
      costBasis: position.costBasis.toDatabaseString('costBasis'),
      realizedPnl: position.realizedPnl.toDatabaseString('realizedPnl'),
      dividendIncome:
        position.dividendIncome.toDatabaseString('dividendIncome'),
      ledgerVersion: input.ledgerVersion,
      calculatedAt: input.calculatedAt,
    }));
  const cashBalances: CashBalanceProjection[] = [
    {
      portfolioId: input.portfolioId,
      currencyCode: 'TRY',
      balance: cash.toDatabaseString('balance'),
      ledgerVersion: input.ledgerVersion,
      calculatedAt: input.calculatedAt,
    },
  ];
  return {
    ledgerVersion: input.ledgerVersion,
    positions: projectedPositions,
    cashBalances,
  };
}

function getPosition(
  map: Map<string, MutablePosition>,
  instrumentId: string,
): MutablePosition {
  const found = map.get(instrumentId);
  if (found) return found;
  const created = {
    quantity: Decimal.ZERO,
    averageCost: Decimal.ZERO,
    costBasis: Decimal.ZERO,
    realizedPnl: Decimal.ZERO,
    dividendIncome: Decimal.ZERO,
  };
  map.set(instrumentId, created);
  return created;
}
function required<T>(value: T | null, field: string): T {
  if (value === null)
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', { field });
  return value;
}
function requiredPositive(value: Decimal | null, field: string): Decimal {
  const result = required(value, field);
  if (result.isNegative() || result.isZero())
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', { field });
  return result;
}
function requiredInstrument(transaction: PortfolioTransaction): string {
  return required(transaction.instrumentId, 'instrumentId');
}
