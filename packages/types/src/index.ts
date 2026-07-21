import type { SafeTraceContext } from './observability';

export const ATLAS_QUEUE_NAMES = {
  alerts: 'atlas.alerts.v1',
  backtests: 'atlas.backtests.v1',
  experiments: 'atlas.experiments.v1',
  notifications: 'atlas.notifications.v1',
  deadLetter: 'atlas.system.dead-letter.v1',
  marketData: 'atlas.market-data.v1',
  scanner: 'atlas.scanner.v1',
  system: 'atlas.system.v1',
} as const;

export const ATLAS_JOB_NAMES = {
  alertEvaluate: 'alerts.evaluate.v1',
  backtestRun: 'backtests.run.v1',
  backtestExperiment: 'backtests.experiment.v1',
  notificationDeliver: 'notifications.deliver.v1',
  barIngestion: 'market-data.bar-ingestion.v1',
  deadLetter: 'system.dead-letter.v1',
  heartbeat: 'system.heartbeat.v1',
  instrumentSync: 'market-data.instrument-sync.v1',
  fundamentalsIngest: 'market-data.fundamentals-ingest.v1',
  patternsDetect: 'market-data.patterns-detect.v1',
  marketIntelligenceReconcile: 'market-data.intelligence-reconcile.v1',
  scannerRun: 'scanner.run.v1',
} as const;

export type MarketIntelligenceInvalidationType =
  | 'new_closed_bar'
  | 'corrected_price_bar'
  | 'corporate_action_revision'
  | 'financial_restatement'
  | 'ratio_formula_version'
  | 'indicator_version'
  | 'pattern_algorithm_version'
  | 'instrument_classification_change'
  | 'user_marker_ownership_change';

export interface MarketIntelligenceInvalidationPayload {
  readonly eventId: string;
  readonly type: MarketIntelligenceInvalidationType;
  readonly instrumentId?: string;
  readonly market?: string;
  readonly userId?: string;
  readonly version: string;
  readonly occurredAt: string;
}

export interface MarketIntelligenceReconciliationQueuePayload {
  readonly market: string;
  readonly timeframe: string;
  readonly staleAfterMs: number;
  readonly invalidations: readonly MarketIntelligenceInvalidationPayload[];
  readonly correlationId?: string;
  readonly telemetry?: SafeTraceContext;
}

export interface FundamentalsIngestionQueuePayload {
  readonly providerCode: string;
  readonly providerSymbol: string;
  readonly correlationId?: string;
  readonly telemetry?: SafeTraceContext;
}

export interface ScannerRunQueuePayload {
  readonly runId: string;
  readonly correlationId: string;
  readonly telemetry?: SafeTraceContext;
}

export interface BacktestRunQueuePayload {
  readonly runId: string;
  readonly correlationId: string;
  readonly telemetry?: SafeTraceContext;
}

export interface ExperimentQueuePayload {
  readonly experimentId: string;
  readonly telemetry?: SafeTraceContext;
}

export interface MarketDataAlertEvent {
  readonly type: 'market_data_updated';
  readonly eventId: string;
  readonly instrumentId: string;
  readonly timeframe: string;
  readonly barOpenTime: string;
  readonly dataCutoffAt: string;
  readonly isClosed: boolean;
  readonly telemetry?: SafeTraceContext;
}

export interface ScanCompletedAlertEvent {
  readonly type: 'scan_completed';
  readonly eventId: string;
  readonly scanRunId: string;
  readonly dataCutoffAt: string;
  readonly telemetry?: SafeTraceContext;
}

export type AlertEvaluationQueuePayload =
  | MarketDataAlertEvent
  | ScanCompletedAlertEvent;

export interface NotificationDeliveryQueuePayload {
  readonly outboxId: number;
  readonly attempt: number;
  readonly telemetry?: SafeTraceContext;
}

export * from './observability';
