import type { ScanRunApplicationService, ScanRunStatus } from '@atlas/domain';

export const SCAN_RUN_APPLICATION = Symbol('SCAN_RUN_APPLICATION');
export const SCANNER_RUNTIME_READER = Symbol('SCANNER_RUNTIME_READER');
export const SCANNER_RUN_DISPATCHER = Symbol('SCANNER_RUN_DISPATCHER');

export interface ScanRunStatusView {
  readonly id: string;
  readonly status: ScanRunStatus;
  readonly executionMode: 'sync' | 'async';
  readonly planVersion: number;
  readonly ruleVersion: number;
  readonly dataCutoffAt: Date;
  readonly queuedAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly cancelRequestedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly timeoutAt: Date | null;
  readonly updatedAt: Date;
  readonly progress: {
    readonly total: number;
    readonly processed: number;
    readonly matched: number;
    readonly notEvaluable: number;
    readonly warnings: number;
    readonly phase: string;
    readonly updatedAt: Date;
  };
  readonly errorCode: string | null;
}

export type ScanResultStatusFilter = 'matched' | 'not_evaluable';
export type ScanResultSort = 'createdAt' | 'rank';
export type ScanResultDirection = 'asc' | 'desc';

export interface ScanResultCursor {
  readonly id: string;
  readonly sortValue: string | number | null;
}

export interface ScanResultView {
  readonly id: string;
  readonly instrumentId: string;
  readonly rank: number | null;
  readonly status: ScanResultStatusFilter;
  readonly computedValues: Readonly<Record<string, unknown>>;
  readonly explanation?: Readonly<Record<string, unknown>> | undefined;
  readonly warnings: readonly Readonly<Record<string, unknown>>[];
  readonly dataCutoffAt: Date;
  readonly matchedAt: Date | null;
  readonly sourceBatchIndex: number;
  readonly resultVersion: number;
  readonly createdAt: Date;
}

export interface ScanResultPage {
  readonly items: readonly ScanResultView[];
  readonly nextCursor: ScanResultCursor | null;
}

export interface ScannerRuntimeReader {
  status(runId: string): Promise<ScanRunStatusView | null>;
  results(input: {
    readonly runId: string;
    readonly limit: number;
    readonly status?: ScanResultStatusFilter | undefined;
    readonly sort: ScanResultSort;
    readonly direction: ScanResultDirection;
    readonly cursor?: ScanResultCursor | undefined;
    readonly includeExplanation: boolean;
  }): Promise<ScanResultPage>;
}

export interface ScannerRunDispatcher {
  dispatch(input: {
    readonly runId: string;
    readonly correlationId: string;
  }): Promise<void>;
}

export type ScanRunCommands = Pick<
  ScanRunApplicationService,
  'create' | 'getOwned' | 'requestCancellation'
>;
