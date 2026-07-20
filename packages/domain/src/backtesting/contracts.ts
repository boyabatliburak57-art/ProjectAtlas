import type { ScanRuleAst } from '../scanner/ast/contracts.js';
import type { ScanRuleEvaluation } from '../scanner/evaluation/contracts.js';

export type BacktestDecimal = string;

export type BacktestPositionSizing =
  | { readonly type: 'equalWeight' }
  | { readonly type: 'fixedCash'; readonly amount: BacktestDecimal }
  | { readonly type: 'fixedPercentage'; readonly percent: BacktestDecimal };

export type BacktestCostPolicy =
  | { readonly type: 'costFree'; readonly version: string }
  | {
      readonly type: 'linear';
      readonly version: string;
      readonly commissionPercent: BacktestDecimal;
      readonly minimumCommission: BacktestDecimal;
      readonly fixedFee: BacktestDecimal;
      readonly marketTaxPercent: BacktestDecimal;
      readonly slippageBps: BacktestDecimal;
    };

export interface BacktestRiskPolicy {
  readonly stopLossPercent?: BacktestDecimal | undefined;
  readonly takeProfitPercent?: BacktestDecimal | undefined;
  readonly trailingStopPercent?: BacktestDecimal | undefined;
  readonly maximumHoldingBars?: number | undefined;
  readonly maximumPositionWeightPercent: BacktestDecimal;
  readonly sameBarAmbiguityPolicy: 'stopFirst';
}

export type BacktestLiquidityPolicy =
  | { readonly type: 'unlimited' }
  | {
      readonly type: 'volumeParticipation';
      readonly maximumParticipationPercent: BacktestDecimal;
      readonly partialFillPolicy: 'deterministicFloor' | 'reject';
    };

export interface HistoricalUniverseInstrument {
  readonly instrumentId: string;
  readonly listedAt: string;
  readonly delistedAt: string | null;
  readonly memberships: readonly {
    readonly indexCode: string;
    readonly effectiveFrom: string;
    readonly effectiveTo: string | null;
  }[];
}

export interface BacktestPointInTimePolicy {
  readonly dataCutoffAt: string;
  readonly universeVersion: string;
  readonly membershipSnapshotHash: string;
  readonly requiredIndexCodes: readonly string[];
  readonly instruments: readonly HistoricalUniverseInstrument[];
  readonly missingCoveragePolicy: 'exclude';
}

export interface BacktestCorporateActionPolicy {
  readonly version: string;
  readonly adjustmentMode: 'raw' | 'splitAdjusted' | 'totalReturnAdjusted';
  readonly delistingPolicy: 'lastAvailableClose' | 'writeOff' | 'notEvaluable';
}

export interface BacktestExecutionPlan {
  readonly runId: string;
  readonly strategyRevisionId: string;
  readonly dataSnapshotHash: string;
  readonly engineVersion: string;
  readonly executionPolicyVersion: string;
  readonly eventOrderingPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly timeframe: string;
  readonly initialCash: BacktestDecimal;
  readonly entryRule: ScanRuleAst;
  readonly exitRule: ScanRuleAst;
  readonly positionSizing: BacktestPositionSizing;
  readonly costPolicy?: BacktestCostPolicy | undefined;
  readonly riskPolicy?: BacktestRiskPolicy | undefined;
  readonly liquidityPolicy?: BacktestLiquidityPolicy | undefined;
  readonly pointInTimePolicy?: BacktestPointInTimePolicy | undefined;
  readonly corporateActionPolicy?: BacktestCorporateActionPolicy | undefined;
  readonly benchmark?: BacktestBenchmarkSeries | undefined;
  readonly maxConcurrentPositions: number;
  readonly fractionalShares: false;
  readonly allowShort: false;
  readonly allowLeverage: false;
  readonly liquidateAtEnd: boolean;
}

export interface BacktestBenchmarkSeries {
  readonly code: string;
  readonly adjustmentMode: 'raw' | 'splitAdjusted' | 'totalReturnAdjusted';
  readonly dataCutoffAt: string;
  readonly points: readonly BacktestCurvePoint[];
}

export interface BacktestBar {
  readonly eventId: string;
  readonly type: 'bar';
  readonly instrumentId: string;
  readonly symbol: string;
  readonly timestamp: string;
  readonly open: BacktestDecimal | null;
  readonly high: BacktestDecimal | null;
  readonly low: BacktestDecimal | null;
  readonly close: BacktestDecimal | null;
  readonly volume: BacktestDecimal | null;
  readonly isClosed: boolean;
  readonly revision?: string | undefined;
  readonly revisionAvailableAt?: string | undefined;
}

export interface BacktestCorporateActionEvent {
  readonly eventId: string;
  readonly type: 'corporateAction';
  readonly actionType: 'split' | 'bonusShare' | 'dividend' | 'delisting';
  readonly instrumentId: string;
  readonly symbol: string;
  readonly timestamp: string;
  readonly announcementAt: string;
  readonly exAt: string;
  readonly effectiveAt: string;
  readonly paymentAt: string | null;
  readonly revision: string;
  readonly revisionAvailableAt: string;
  readonly factor: BacktestDecimal | null;
  readonly cashPerShare: BacktestDecimal | null;
  readonly settlementPrice: BacktestDecimal | null;
}

export interface BacktestForcedExitEvent {
  readonly eventId: string;
  readonly type: 'forcedExit';
  readonly instrumentId: string;
  readonly symbol: string;
  readonly timestamp: string;
  readonly price: BacktestDecimal | null;
  readonly reason: string;
}

export type BacktestTimelineEvent =
  | BacktestBar
  | BacktestForcedExitEvent
  | BacktestCorporateActionEvent;

export interface BacktestSignalContext {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly signalAt: string;
  readonly timeframe: string;
  readonly bars: readonly BacktestBar[];
}

export interface BacktestSignalEvaluator {
  evaluate(
    rule: ScanRuleAst,
    context: BacktestSignalContext,
  ): ScanRuleEvaluation;
}

export interface BacktestOrderIntent {
  readonly id: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly signalAt: string;
  readonly signalEventId: string;
  readonly reason: 'entry' | 'exit';
}

export interface BacktestFill {
  readonly id: string;
  readonly deduplicationKey: string;
  readonly orderIntentId: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantity: BacktestDecimal;
  readonly requestedQuantity: BacktestDecimal;
  readonly referencePrice: BacktestDecimal;
  readonly price: BacktestDecimal;
  readonly grossAmount: BacktestDecimal;
  readonly slippageAmount: BacktestDecimal;
  readonly commission: BacktestDecimal;
  readonly fixedFee: BacktestDecimal;
  readonly tax: BacktestDecimal;
  readonly totalCosts: BacktestDecimal;
  readonly netCashEffect: BacktestDecimal;
  readonly partial: boolean;
  readonly syntheticCorporateAction?: boolean | undefined;
  readonly signalAt: string;
  readonly filledAt: string;
  readonly reason:
    | 'entry'
    | 'exit'
    | 'forcedExit'
    | 'endOfTest'
    | 'stopLoss'
    | 'takeProfit'
    | 'trailingStop'
    | 'maximumHolding';
}

export interface BacktestPosition {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly quantity: BacktestDecimal;
  readonly averageCost: BacktestDecimal;
  readonly costBasis: BacktestDecimal;
  readonly openedAt: string;
  readonly entryFillId: string;
  readonly highestClose: BacktestDecimal;
  readonly holdingBars: number;
}

export interface BacktestTrade {
  readonly id: string;
  readonly instrumentId: string;
  readonly symbol: string;
  readonly quantity: BacktestDecimal;
  readonly entryPrice: BacktestDecimal;
  readonly exitPrice: BacktestDecimal;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly realizedPnl: BacktestDecimal;
  readonly grossPnl: BacktestDecimal;
  readonly totalCosts: BacktestDecimal;
  readonly returnPercent: BacktestDecimal;
  readonly exitReason: Exclude<BacktestFill['reason'], 'entry'>;
  readonly entryFillId: string;
  readonly exitFillId: string;
}

export type BacktestMetricReasonCode =
  | 'INSUFFICIENT_OBSERVATIONS'
  | 'INVALID_INPUT'
  | 'NON_POSITIVE_CAPITAL'
  | 'PERIOD_TOO_SHORT'
  | 'ZERO_VOLATILITY'
  | 'ZERO_DOWNSIDE_DEVIATION'
  | 'ZERO_DRAWDOWN'
  | 'ZERO_CLOSED_TRADES'
  | 'ZERO_LOSSES'
  | 'MISSING_BENCHMARK'
  | 'BENCHMARK_CONTEXT_MISMATCH'
  | 'MISSING_BENCHMARK_DATES';

export interface BacktestMetric {
  readonly value: BacktestDecimal | null;
  readonly status: 'complete' | 'notEvaluable';
  readonly reasonCode: BacktestMetricReasonCode | null;
  readonly observationCount: number;
  readonly methodologyVersion: string;
  readonly warnings: readonly string[];
}

export interface BacktestMetricSet {
  readonly totalReturn: BacktestMetric;
  readonly annualizedReturn: BacktestMetric;
  readonly annualizedVolatility: BacktestMetric;
  readonly sharpeRatio: BacktestMetric;
  readonly sortinoRatio: BacktestMetric;
  readonly calmarRatio: BacktestMetric;
  readonly expectancy: BacktestMetric;
  readonly profitFactor: BacktestMetric;
  readonly turnover: BacktestMetric;
  readonly benchmarkReturn: BacktestMetric;
  readonly excessReturn: BacktestMetric;
}

export interface BacktestMetricMethodology {
  readonly version: string;
  readonly returnConvention: 'simple-close-to-close';
  readonly annualizationFactor: 252;
  readonly annualizedReturnDayCount: 365;
  readonly riskFreeRateAnnual: BacktestDecimal;
  readonly standardDeviation: 'sample';
  readonly downsideTargetPeriodic: BacktestDecimal;
  readonly turnover: {
    readonly approach: 'gross';
    readonly denominator: 'average-portfolio-equity';
    readonly annualized: false;
    readonly syntheticCorporateActionFills: 'excluded';
  };
  readonly benchmark: {
    readonly adjustmentMode: 'same-as-strategy';
    readonly dateAlignment: 'exact-date-intersection-no-forward-fill';
    readonly range: 'same-start-and-end';
    readonly dataCutoff: 'same-as-backtest-snapshot';
  };
}

export interface BacktestCurvePoint {
  readonly timestamp: string;
  readonly value: BacktestDecimal;
}

export interface BacktestWarning {
  readonly code:
    | 'BAR_NOT_CLOSED'
    | 'DUPLICATE_EVENT_IGNORED'
    | 'MISSING_EXECUTION_PRICE'
    | 'INSUFFICIENT_CASH'
    | 'MAX_POSITIONS_REACHED'
    | 'SIGNAL_NOT_EVALUABLE'
    | 'FORCED_EXIT_PRICE_MISSING'
    | 'LIQUIDITY_VOLUME_UNAVAILABLE'
    | 'PARTICIPATION_LIMIT_REJECTED'
    | 'HISTORICAL_UNIVERSE_EXCLUDED'
    | 'CORPORATE_ACTION_NOT_AVAILABLE'
    | 'CORPORATE_ACTION_DOUBLE_APPLICATION_PREVENTED'
    | 'SAME_BAR_RISK_AMBIGUITY'
    | 'DELISTING_NOT_EVALUABLE'
    | 'COST_FREE_BACKTEST';
  readonly eventId: string;
  readonly instrumentId: string;
}

export interface BacktestSimulationState {
  readonly currentTime: string | null;
  readonly cash: BacktestDecimal;
  readonly positions: readonly BacktestPosition[];
  readonly pendingOrders: readonly BacktestOrderIntent[];
  readonly lastPrices: Readonly<Record<string, BacktestDecimal>>;
  readonly realizedPnl: BacktestDecimal;
}

export interface BacktestSummary {
  readonly initialCash: BacktestDecimal;
  readonly endingCash: BacktestDecimal;
  readonly endingEquity: BacktestDecimal;
  readonly totalReturnPercent: BacktestDecimal;
  readonly maximumDrawdownPercent: BacktestDecimal;
  readonly realizedPnl: BacktestDecimal;
  readonly tradeCount: number;
  readonly winningTradeCount: number;
  readonly losingTradeCount: number;
  readonly winRatePercent: BacktestDecimal;
  readonly profitFactor: BacktestDecimal | null;
  readonly exposurePercent: BacktestDecimal;
  readonly totalCosts: BacktestDecimal;
  readonly metrics: BacktestMetricSet;
  readonly methodology: BacktestMetricMethodology;
}

export interface PointInTimeFundamentalRevision {
  readonly instrumentId: string;
  readonly metricCode: string;
  readonly value: BacktestDecimal;
  readonly periodEnd: string;
  readonly publishedAt: string;
  readonly providerRevision: string;
  readonly revisionAvailableAt: string;
}

export interface BacktestCheckpoint {
  readonly version: 1;
  readonly engineVersion: string;
  readonly planHash: string;
  readonly timelineHash: string;
  readonly lastProcessedOrderKey: string | null;
  readonly processedEventIds: readonly string[];
  readonly state: BacktestSimulationState;
  readonly fills: readonly BacktestFill[];
  readonly trades: readonly BacktestTrade[];
  readonly equityCurve: readonly BacktestCurvePoint[];
  readonly cashCurve: readonly BacktestCurvePoint[];
  readonly exposureCurve: readonly BacktestCurvePoint[];
  readonly drawdownCurve: readonly BacktestCurvePoint[];
  readonly warnings: readonly BacktestWarning[];
  readonly stateHash: string;
}

export interface BacktestRunOptions {
  readonly checkpoint?: BacktestCheckpoint | undefined;
  readonly stopAfterTimestampBuckets?: number | undefined;
}

export interface BacktestResult {
  readonly status: 'completed' | 'checkpointed';
  readonly planHash: string;
  readonly timelineHash: string;
  readonly resultHash: string;
  readonly state: BacktestSimulationState;
  readonly fills: readonly BacktestFill[];
  readonly trades: readonly BacktestTrade[];
  readonly equityCurve: readonly BacktestCurvePoint[];
  readonly cashCurve: readonly BacktestCurvePoint[];
  readonly exposureCurve: readonly BacktestCurvePoint[];
  readonly drawdownCurve: readonly BacktestCurvePoint[];
  readonly benchmarkCurve: readonly BacktestCurvePoint[];
  readonly warnings: readonly BacktestWarning[];
  readonly summary: BacktestSummary | null;
  readonly checkpoint: BacktestCheckpoint;
}

export class BacktestDomainError extends Error {
  constructor(
    readonly code:
      | 'BACKTEST_PLAN_INVALID'
      | 'BACKTEST_EVENT_INVALID'
      | 'BACKTEST_CHECKPOINT_MISMATCH'
      | 'BACKTEST_CHECKPOINT_INVALID',
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(code);
    this.name = 'BacktestDomainError';
  }
}
