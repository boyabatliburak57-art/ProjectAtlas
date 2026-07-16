import type {
  PortfolioProjection,
  PortfolioTransaction,
  PositionProjection,
} from './contracts.js';
import { Decimal, parseLedgerDecimal } from './decimal.js';
import { PortfolioError } from './errors.js';

export interface ValuationPrice {
  readonly instrumentId: string;
  readonly timeframe: string;
  readonly close: string;
  readonly closeTime: Date;
  readonly isClosed: boolean;
}

export interface PositionValuationSnapshot {
  readonly instrumentId: string;
  readonly status: 'valued' | 'missing_price' | 'stale_price';
  readonly quantity: string;
  readonly averageCost: string;
  readonly costBasis: string;
  readonly marketPrice: string | null;
  readonly marketValue: string | null;
  readonly unrealizedPnl: string | null;
  readonly priceAt: Date | null;
  readonly warningCode: 'MISSING_PRICE' | 'STALE_PRICE' | null;
}

export interface PortfolioValuationSnapshot {
  readonly portfolioId: string;
  readonly ledgerVersion: number;
  readonly valuationAt: Date;
  readonly dataCutoffAt: Date;
  readonly pricePolicyVersion: string;
  readonly mode: 'official' | 'intradayPreview';
  readonly persistable: boolean;
  readonly status: 'complete' | 'partial' | 'notEvaluable';
  readonly cashBalance: string;
  readonly positionsMarketValue: string;
  readonly totalValue: string;
  readonly realizedPnl: string;
  readonly unrealizedPnl: string | null;
  readonly netContributions: string;
  readonly missingPriceCount: number;
  readonly warnings: readonly {
    readonly code: 'MISSING_PRICE' | 'STALE_PRICE';
    readonly instrumentId: string;
  }[];
  readonly positions: readonly PositionValuationSnapshot[];
  readonly cacheKey: string;
}

export interface PortfolioPricePort {
  loadPrices(input: {
    readonly instrumentIds: readonly string[];
    readonly dataCutoffAt: Date;
    readonly mode: 'official' | 'intradayPreview';
  }): Promise<readonly ValuationPrice[]>;
}

export interface ValuationSnapshotRepository {
  findByIdentity(identity: {
    readonly portfolioId: string;
    readonly ledgerVersion: number;
    readonly valuationAt: Date;
    readonly dataCutoffAt: Date;
    readonly pricePolicyVersion: string;
    readonly cacheKey: string;
  }): Promise<PortfolioValuationSnapshot | null>;
  save(
    snapshot: PortfolioValuationSnapshot,
  ): Promise<PortfolioValuationSnapshot>;
  invalidatePortfolio(
    portfolioId: string,
    currentLedgerVersion: number,
  ): Promise<number>;
}

export const DEFAULT_PRICE_POLICY = {
  version: 'closed-daily-v1',
  staleAfterMilliseconds: 4 * 24 * 60 * 60 * 1000,
} as const;

export class PortfolioValuationService {
  constructor(
    private readonly prices: PortfolioPricePort,
    private readonly snapshots?: ValuationSnapshotRepository,
  ) {}

  async value(input: {
    readonly portfolioId: string;
    readonly projection: PortfolioProjection;
    readonly transactions: readonly PortfolioTransaction[];
    readonly valuationAt: Date;
    readonly dataCutoffAt: Date;
    readonly mode?: 'official' | 'intradayPreview';
    readonly pricePolicy?: {
      readonly version: string;
      readonly staleAfterMilliseconds: number;
    };
  }): Promise<PortfolioValuationSnapshot> {
    const mode = input.mode ?? 'official';
    const policy = input.pricePolicy ?? DEFAULT_PRICE_POLICY;
    validateValuationInput(input, policy.staleAfterMilliseconds);
    const cacheKey = valuationCacheKey({
      portfolioId: input.portfolioId,
      ledgerVersion: input.projection.ledgerVersion,
      valuationAt: input.valuationAt,
      dataCutoffAt: input.dataCutoffAt,
      pricePolicyVersion: policy.version,
      mode,
    });
    if (mode === 'official' && this.snapshots) {
      const cached = await this.snapshots.findByIdentity({
        portfolioId: input.portfolioId,
        ledgerVersion: input.projection.ledgerVersion,
        valuationAt: input.valuationAt,
        dataCutoffAt: input.dataCutoffAt,
        pricePolicyVersion: policy.version,
        cacheKey,
      });
      if (cached) return cached;
    }
    const activePositions = input.projection.positions.filter(
      (position) => !parseLedgerDecimal(position.quantity, 'quantity').isZero(),
    );
    const observations = await this.prices.loadPrices({
      instrumentIds: activePositions.map((position) => position.instrumentId),
      dataCutoffAt: input.dataCutoffAt,
      mode,
    });
    const snapshot = buildValuationSnapshot({
      ...input,
      mode,
      policy,
      positions: activePositions,
      observations,
      cacheKey,
    });
    return mode === 'official' && this.snapshots
      ? this.snapshots.save(snapshot)
      : snapshot;
  }

  async invalidate(portfolioId: string, currentLedgerVersion: number) {
    return (
      this.snapshots?.invalidatePortfolio(portfolioId, currentLedgerVersion) ??
      Promise.resolve(0)
    );
  }
}

export function valuationCacheKey(input: {
  readonly portfolioId: string;
  readonly ledgerVersion: number;
  readonly valuationAt: Date;
  readonly dataCutoffAt: Date;
  readonly pricePolicyVersion: string;
  readonly mode: string;
}): string {
  return [
    input.portfolioId,
    input.ledgerVersion,
    input.valuationAt.toISOString(),
    input.dataCutoffAt.toISOString(),
    input.pricePolicyVersion,
    input.mode,
  ].join(':');
}

function buildValuationSnapshot(input: {
  readonly portfolioId: string;
  readonly projection: PortfolioProjection;
  readonly transactions: readonly PortfolioTransaction[];
  readonly valuationAt: Date;
  readonly dataCutoffAt: Date;
  readonly mode: 'official' | 'intradayPreview';
  readonly policy: {
    readonly version: string;
    readonly staleAfterMilliseconds: number;
  };
  readonly positions: readonly PositionProjection[];
  readonly observations: readonly ValuationPrice[];
  readonly cacheKey: string;
}): PortfolioValuationSnapshot {
  const selected = selectPrices(
    input.observations,
    input.dataCutoffAt,
    input.mode,
  );
  let positionsValue = Decimal.ZERO;
  let unrealized = Decimal.ZERO;
  let realized = Decimal.ZERO;
  const warnings: PortfolioValuationSnapshot['warnings'][number][] = [];
  const positions = input.positions.map((position) => {
    realized = realized.plus(
      parseLedgerDecimal(position.realizedPnl, 'realizedPnl'),
    );
    const price = selected.get(position.instrumentId);
    if (!price) {
      warnings.push({
        code: 'MISSING_PRICE',
        instrumentId: position.instrumentId,
      });
      return missingPosition(position);
    }
    const quantity = parseLedgerDecimal(position.quantity, 'quantity');
    const marketPrice = parseLedgerDecimal(price.close, 'marketPrice', {
      nonNegative: true,
    });
    const marketValue = quantity.times(marketPrice);
    const positionUnrealized = marketValue.minus(
      parseLedgerDecimal(position.costBasis, 'costBasis'),
    );
    positionsValue = positionsValue.plus(marketValue);
    unrealized = unrealized.plus(positionUnrealized);
    const stale =
      input.dataCutoffAt.getTime() - price.closeTime.getTime() >
      input.policy.staleAfterMilliseconds;
    if (stale)
      warnings.push({
        code: 'STALE_PRICE',
        instrumentId: position.instrumentId,
      });
    return {
      instrumentId: position.instrumentId,
      status: stale ? ('stale_price' as const) : ('valued' as const),
      quantity: position.quantity,
      averageCost: position.averageCost,
      costBasis: position.costBasis,
      marketPrice: marketPrice.toDatabaseString('marketPrice'),
      marketValue: marketValue.toDatabaseString('marketValue'),
      unrealizedPnl: positionUnrealized.toDatabaseString('unrealizedPnl'),
      priceAt: price.closeTime,
      warningCode: stale ? ('STALE_PRICE' as const) : null,
    };
  });
  const cash = parseLedgerDecimal(
    input.projection.cashBalances[0]?.balance ?? '0',
    'cashBalance',
  );
  const missingPriceCount = positions.filter(
    (position) => position.status === 'missing_price',
  ).length;
  const staleCount = positions.filter(
    (position) => position.status === 'stale_price',
  ).length;
  const valuedCount = positions.length - missingPriceCount;
  const status =
    missingPriceCount === 0 && staleCount === 0
      ? 'complete'
      : positions.length > 0 && valuedCount === 0
        ? 'notEvaluable'
        : 'partial';
  return {
    portfolioId: input.portfolioId,
    ledgerVersion: input.projection.ledgerVersion,
    valuationAt: input.valuationAt,
    dataCutoffAt: input.dataCutoffAt,
    pricePolicyVersion: input.policy.version,
    mode: input.mode,
    persistable: input.mode === 'official',
    status,
    cashBalance: cash.toDatabaseString('cashBalance'),
    positionsMarketValue: positionsValue.toDatabaseString(
      'positionsMarketValue',
    ),
    totalValue: cash.plus(positionsValue).toDatabaseString('totalValue'),
    realizedPnl: realized.toDatabaseString('realizedPnl'),
    unrealizedPnl:
      missingPriceCount === 0
        ? unrealized.toDatabaseString('unrealizedPnl')
        : null,
    netContributions: calculateNetContributions(input.transactions),
    missingPriceCount,
    warnings,
    positions,
    cacheKey: input.cacheKey,
  };
}

function selectPrices(
  prices: readonly ValuationPrice[],
  cutoff: Date,
  mode: 'official' | 'intradayPreview',
): Map<string, ValuationPrice> {
  const selected = new Map<string, ValuationPrice>();
  for (const price of prices) {
    if (price.closeTime > cutoff) continue;
    if (mode === 'official' && (price.timeframe !== '1d' || !price.isClosed))
      continue;
    const current = selected.get(price.instrumentId);
    if (!current || current.closeTime < price.closeTime)
      selected.set(price.instrumentId, price);
  }
  return selected;
}

function calculateNetContributions(
  transactions: readonly PortfolioTransaction[],
): string {
  let total = Decimal.ZERO;
  for (const transaction of transactions) {
    if (transaction.status !== 'posted' || transaction.cashAmount === null)
      continue;
    const amount = parseLedgerDecimal(transaction.cashAmount, 'cashAmount');
    if (transaction.type === 'cashDeposit') total = total.plus(amount);
    if (transaction.type === 'cashWithdrawal') total = total.minus(amount);
  }
  return total.toDatabaseString('netContributions');
}

function missingPosition(
  position: PositionProjection,
): PositionValuationSnapshot {
  return {
    instrumentId: position.instrumentId,
    status: 'missing_price',
    quantity: position.quantity,
    averageCost: position.averageCost,
    costBasis: position.costBasis,
    marketPrice: null,
    marketValue: null,
    unrealizedPnl: null,
    priceAt: null,
    warningCode: 'MISSING_PRICE',
  };
}

function validateValuationInput(
  input: { readonly valuationAt: Date; readonly dataCutoffAt: Date },
  staleAfterMilliseconds: number,
) {
  if (
    Number.isNaN(input.valuationAt.getTime()) ||
    Number.isNaN(input.dataCutoffAt.getTime()) ||
    input.dataCutoffAt > input.valuationAt ||
    !Number.isSafeInteger(staleAfterMilliseconds) ||
    staleAfterMilliseconds < 0
  )
    throw new PortfolioError('PORTFOLIO_VALUATION_INVALID');
}
