export const SYMBOL_DETAIL_READER = Symbol('SYMBOL_DETAIL_READER');

export type ChartAdjustmentMode = 'raw' | 'split-adjusted' | 'total-return';

export interface SymbolProfileView {
  readonly id: string;
  readonly symbol: string;
  readonly name: string;
  readonly isin: string | null;
  readonly marketCode: string;
  readonly currencyCode: string;
  readonly status: string;
  readonly sector: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
  } | null;
}

export interface SymbolBarView {
  readonly openTime: Date;
  readonly closeTime: Date;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly isClosed: boolean;
  readonly sourceTimestamp: Date | null;
  readonly qualityStatus: string;
}

export interface CorporateActionView {
  readonly eventKey: string;
  readonly type: 'split' | 'bonusShare' | 'rightsIssue' | 'dividend';
  readonly effectiveAt: Date;
  readonly factor: string | null;
  readonly cashAmount: string | null;
  readonly sourceType: 'corporate_action';
}

export interface PatternSignalView {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly algorithmVersion: string;
  readonly state: string;
  readonly direction: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly detectedAt: Date;
  readonly dataCutoffAt: Date;
  readonly evidenceVersion: number;
}

export interface UserChartMarkerView {
  readonly time: Date;
  readonly type: 'transaction' | 'alert';
  readonly label: string;
  readonly sourceType: 'portfolio_transaction' | 'alert_trigger';
  readonly sourceId: string;
}

export interface SymbolDetailReader {
  profile(normalizedSymbol: string): Promise<SymbolProfileView | null>;
  bars(input: {
    readonly instrumentId: string;
    readonly timeframe: string;
    readonly from: Date;
    readonly to: Date;
    readonly limit: number;
  }): Promise<readonly SymbolBarView[]>;
  corporateActions(input: {
    readonly instrumentId: string;
    readonly from: Date;
    readonly to: Date;
  }): Promise<readonly CorporateActionView[]>;
  patterns(input: {
    readonly instrumentId: string;
    readonly timeframe: string;
    readonly adjustmentMode: ChartAdjustmentMode;
    readonly from: Date;
    readonly to: Date;
    readonly limit: number;
  }): Promise<readonly PatternSignalView[]>;
  userMarkers(input: {
    readonly userId: string;
    readonly instrumentId: string;
    readonly from: Date;
    readonly to: Date;
  }): Promise<readonly UserChartMarkerView[]>;
  activeAlertCount(userId: string, instrumentId: string): Promise<number>;
}
