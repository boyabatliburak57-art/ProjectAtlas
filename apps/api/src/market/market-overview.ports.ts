export const MARKET_OVERVIEW_READER = Symbol('MARKET_OVERVIEW_READER');
export const MARKET_RATE_LIMITER = Symbol('MARKET_RATE_LIMITER');

export type MarketReadStatus =
  | 'complete'
  | 'partial'
  | 'stale'
  | 'not_evaluable';

export interface MarketSnapshotView {
  readonly generationId: string;
  readonly marketCode: string;
  readonly timeframe: string;
  readonly universeVersion: string;
  readonly policyVersion: string;
  readonly dataCutoffAt: Date;
  readonly sourceTimestamp: Date | null;
  readonly status: MarketReadStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evaluatedCount: number;
  readonly excludedCount: number;
  readonly qualityMetadata: Readonly<Record<string, unknown>>;
}

export interface MarketSectorView {
  readonly sectorId: string;
  readonly sectorCode: string;
  readonly sectorName: string;
  readonly status: MarketReadStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evaluatedCount: number;
  readonly excludedCount: number;
  readonly qualityMetadata: Readonly<Record<string, unknown>>;
}

export interface MarketRankingCursorPosition {
  readonly rank: number;
  readonly instrumentId: string;
}

export interface MarketRankingItemView {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly company: string;
  readonly rank: number;
  readonly sortValue: string;
  readonly status: MarketReadStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly qualityMetadata: Readonly<Record<string, unknown>>;
}

export interface MarketRankingPageView {
  readonly items: readonly MarketRankingItemView[];
  readonly nextPosition: MarketRankingCursorPosition | null;
}

export interface MarketOverviewReader {
  latestOverview(input: {
    readonly marketCode: string;
    readonly timeframe: string;
  }): Promise<MarketSnapshotView | null>;
  sectors(generationId: string): Promise<readonly MarketSectorView[]>;
  rankingPage(input: {
    readonly generationId: string;
    readonly rankingType: string;
    readonly limit: number;
    readonly cursor: MarketRankingCursorPosition | null;
  }): Promise<MarketRankingPageView>;
}

export interface MarketRateLimiter {
  consume(input: {
    readonly clientKey: string;
    readonly operation: string;
    readonly now: Date;
  }): void;
}
