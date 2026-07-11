export const MARKET_DATA_TIMEFRAMES = [
  '1m',
  '5m',
  '15m',
  '30m',
  '1h',
  '4h',
  '1d',
  '1w',
] as const;

export type MarketDataTimeframe = (typeof MARKET_DATA_TIMEFRAMES)[number];
export type DecimalString = string;

export interface ProviderCapabilities {
  readonly supportedTimeframes: readonly MarketDataTimeframe[];
  readonly dataMode: 'delayed' | 'realtime' | 'end-of-day';
  readonly historicalDepthDays: number | null;
  readonly supportsCorporateActions: boolean;
  readonly supportsFundamentals: boolean;
  readonly supportsPagination: boolean;
  readonly rateLimit: {
    readonly requests: number;
    readonly intervalMs: number;
  } | null;
}

export interface ProviderInstrumentDto {
  readonly providerSymbol: string;
  readonly symbol: string;
  readonly name: string;
  readonly marketCode: string;
  readonly currencyCode: string;
  readonly isin?: string | undefined;
}

export interface ProviderBarDto {
  readonly providerSymbol: string;
  readonly timeframe: MarketDataTimeframe;
  readonly openTime: Date;
  readonly closeTime: Date;
  readonly open: DecimalString;
  readonly high: DecimalString;
  readonly low: DecimalString;
  readonly close: DecimalString;
  readonly volume: DecimalString;
  readonly isClosed: boolean;
  readonly sourceTimestamp?: Date | undefined;
}

export interface FetchBarsRequest {
  readonly providerSymbol: string;
  readonly timeframe: MarketDataTimeframe;
  readonly from: Date;
  readonly to: Date;
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export interface ProviderBarBatch {
  readonly bars: readonly ProviderBarDto[];
  readonly nextCursor?: string | undefined;
}

export interface MarketDataProvider {
  readonly code: string;
  getCapabilities(): ProviderCapabilities;
  listInstruments(): Promise<readonly ProviderInstrumentDto[]>;
  fetchBars(request: FetchBarsRequest): Promise<ProviderBarBatch>;
}

/**
 * Adapter output is unknown by design. Only ValidatedMarketDataProvider may
 * promote an external response into the normalized provider contract.
 */
export interface RawMarketDataProviderAdapter {
  readonly code: string;
  getCapabilities(): unknown;
  listInstruments(): Promise<unknown>;
  fetchBars(request: FetchBarsRequest): Promise<unknown>;
}
