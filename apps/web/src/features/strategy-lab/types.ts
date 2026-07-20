export interface StrategyConditionDraft {
  readonly indicator: 'RSI' | 'EMA';
  readonly period: number;
  readonly operator: 'LT' | 'GT' | 'CROSSES_ABOVE' | 'CROSSES_BELOW';
  readonly value: number;
}

export interface StrategyDefinition {
  readonly schemaVersion: 1;
  readonly baseTimeframe: string;
  readonly entryRule: Record<string, unknown>;
  readonly exitRule: Record<string, unknown>;
  readonly filterRule: null;
  readonly parameters: readonly Record<string, unknown>[];
  readonly positionSizing: Record<string, unknown>;
  readonly riskControls: Record<string, unknown>;
  readonly executionPolicy: Record<string, unknown>;
  readonly costPolicy: Record<string, unknown>;
  readonly dataIntegrityPolicy: Record<string, unknown>;
  readonly benchmarkCode: string | null;
}

export interface StrategyValidation {
  readonly valid: boolean;
  readonly errors: readonly { code: string; path: string; message: string }[];
  readonly warnings: readonly { code: string; path: string; message: string }[];
  readonly complexityScore: number;
  readonly workload: {
    readonly nodeCount: number;
    readonly conditionCount: number;
    readonly indicatorCount: number;
    readonly timeframeCount: number;
    readonly estimatedOperationsPerInstrument: number;
  };
  readonly warmup: { readonly maximumBars: number };
  readonly requiredData: {
    readonly requiresHistoricalUniverse: boolean;
    readonly requiresCorporateActions: boolean;
    readonly fundamentalMetrics: readonly string[];
  };
}

export interface Strategy {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly status: 'draft' | 'validated' | 'archived' | 'deleted';
  readonly currentRevision: number;
  readonly updatedAt: string;
  readonly revision: {
    readonly revision: number;
    readonly definition: StrategyDefinition;
    readonly validation: StrategyValidation;
    readonly status: 'draft' | 'validated';
  };
}

export interface BacktestRun {
  readonly id: string;
  readonly strategyId: string;
  readonly strategyRevision: number;
  readonly status:
    | 'queued'
    | 'resolvingData'
    | 'running'
    | 'calculatingMetrics'
    | 'completed'
    | 'failed'
    | 'cancelRequested'
    | 'cancelled'
    | 'expired';
  readonly progressPercent: number;
  readonly queuedAt: string;
  readonly completedAt: string | null;
  readonly errorCode: string | null;
  readonly dataSnapshotHash: string;
}

export interface BacktestSummary {
  readonly endingEquity?: string | null;
  readonly totalReturn?: string | null;
  readonly annualizedReturn?: string | null;
  readonly annualizedVolatility?: string | null;
  readonly maximumDrawdown?: string | null;
  readonly sharpe?: string | null;
  readonly sortino?: string | null;
  readonly calmar?: string | null;
  readonly tradeCount?: number | null;
  readonly winRate?: string | null;
  readonly profitFactor?: string | null;
  readonly exposure?: string | null;
  readonly turnover?: string | null;
  readonly totalFees?: string | null;
  readonly totalSlippage?: string | null;
  readonly benchmarkReturn?: string | null;
  readonly excessReturn?: string | null;
  readonly expectancy?: string | null;
  readonly metrics?: Readonly<Record<string, BacktestMetricResult>>;
  readonly methodology?: Record<string, unknown>;
  readonly dataSnapshot?: {
    readonly id: string;
    readonly hash: string;
    readonly dataCutoffAt: string;
    readonly coverageStatus: string;
  };
  readonly warnings?: readonly { code: string; message?: string }[];
}

export interface BacktestMetricResult {
  readonly value: string | null;
  readonly status: 'complete' | 'notEvaluable';
  readonly reasonCode: string | null;
  readonly observationCount: number;
  readonly methodologyVersion: string;
  readonly warnings: readonly string[];
}

export interface SeriesPoint {
  readonly timestamp: string;
  readonly value: string;
}

export interface Trade {
  readonly id: string;
  readonly instrumentId?: string;
  readonly symbol?: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly entryPrice: string;
  readonly exitPrice: string;
  readonly quantity: string;
  readonly realizedPnl: string;
  readonly returnPercent?: string;
  readonly fees?: string;
}

export interface Experiment {
  readonly id: string;
  readonly name: string;
  readonly strategyId: string;
  readonly strategyRevision: number;
  readonly status: string;
  readonly combinationCount: number;
  readonly completedRunCount: number;
  readonly failedRunCount: number;
  readonly warnings: readonly { code: string; message?: string }[];
  readonly createdAt: string;
}
