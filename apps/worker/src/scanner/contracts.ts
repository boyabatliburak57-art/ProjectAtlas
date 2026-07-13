import type {
  IndicatorInput,
  IndicatorTimeframe,
  PreparedOperandValues,
  ScanExecutionPlan,
  ScanRuleEvaluation,
  ScanRunStatus,
} from '@atlas/domain';
import type { ScannerRunQueuePayload } from '@atlas/types';

export type ScannerRunJobData = ScannerRunQueuePayload;

export interface ScannerRunRecord {
  readonly id: string;
  readonly requestedBy: string;
  readonly status: ScanRunStatus;
  readonly plan: ScanExecutionPlan;
  readonly instrumentIds: readonly string[];
  readonly dataCutoffAt: Date;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly progressTotal: number;
  readonly progressProcessed: number;
  readonly matchedCount: number;
  readonly notEvaluableCount: number;
  readonly warningCount: number;
}

export interface ScannerMarketDataInstrument {
  readonly instrumentId: string;
  readonly inputs: ReadonlyMap<IndicatorTimeframe, IndicatorInput>;
  readonly marketFields: Readonly<Record<string, number | boolean | null>>;
  readonly warnings: readonly ScannerWarning[];
}

export interface ScannerWarning {
  readonly code: string;
  readonly message: string;
  readonly nodeId?: string | undefined;
}

export interface ScannerMarketDataLoader {
  load(input: {
    readonly instrumentIds: readonly string[];
    readonly plan: ScanExecutionPlan;
    readonly dataCutoffAt: Date;
  }): Promise<readonly ScannerMarketDataInstrument[]>;
}

export interface ScannerResultWrite {
  readonly instrumentId: string;
  readonly status: 'matched' | 'not_evaluable';
  readonly computedValues: Readonly<Record<string, unknown>>;
  readonly explanation: Readonly<Record<string, unknown>>;
  readonly warnings: readonly ScannerWarning[];
}

export interface ScannerBatchCompletion {
  readonly processed: number;
  readonly matched: number;
  readonly notEvaluable: number;
  readonly warnings: number;
}

export interface ScannerProgress extends ScannerBatchCompletion {
  readonly total: number;
  readonly phase: 'loading' | 'evaluating' | 'persisting' | 'completed';
  readonly percent: number;
  readonly updatedAt: string;
}

export interface ScannerRuntimeRepository {
  loadRun(runId: string): Promise<ScannerRunRecord | null>;
  startRun(runId: string, occurredAt: Date): Promise<ScannerRunRecord | null>;
  isCancellationRequested(runId: string): Promise<boolean>;
  beginBatch(input: {
    readonly runId: string;
    readonly batchIndex: number;
    readonly planVersion: number;
    readonly instrumentIds: readonly string[];
    readonly occurredAt: Date;
  }): Promise<'started' | 'completed'>;
  completeBatch(input: {
    readonly runId: string;
    readonly batchIndex: number;
    readonly results: readonly ScannerResultWrite[];
    readonly counts: ScannerBatchCompletion;
    readonly dataCutoffAt: Date;
    readonly occurredAt: Date;
  }): Promise<ScannerProgress>;
  completeRun(runId: string, occurredAt: Date): Promise<void>;
  cancelRun(runId: string, occurredAt: Date): Promise<void>;
  failRun(runId: string, errorCode: string, occurredAt: Date): Promise<void>;
}

export interface ScannerMetrics {
  increment(
    name: string,
    value?: number,
    tags?: Readonly<Record<string, string>>,
  ): void;
  observe(
    name: string,
    value: number,
    tags?: Readonly<Record<string, string>>,
  ): void;
}

export interface ScannerInstrumentEvaluation {
  readonly values: PreparedOperandValues;
  readonly evaluation: ScanRuleEvaluation;
  readonly warnings: readonly ScannerWarning[];
}
