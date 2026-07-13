import type {
  ScanExecutionPlan,
  ScanPlannerDependencies,
} from '../planning/contracts.js';
import type { ScanRuleAst, ScanUniverseFilter } from '../ast/contracts.js';

export const SCAN_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancel_requested',
  'cancelled',
  'expired',
] as const;

export type ScanRunStatus = (typeof SCAN_RUN_STATUSES)[number];
export type ScanRunSourceType =
  | 'ad_hoc'
  | 'saved_scan'
  | 'preset_scan'
  | 'admin';

export interface ScanRunSource {
  readonly type: ScanRunSourceType;
  readonly id?: string | undefined;
  readonly revision?: number | undefined;
}

export interface ResolvedUniverseSnapshot {
  readonly instrumentIds: readonly string[];
  readonly filter: ScanUniverseFilter;
  readonly resolvedAt: Date;
}

export interface PersistedUniverseSnapshot {
  readonly instrumentIds: readonly string[];
  readonly filter: ScanUniverseFilter;
  readonly resolvedAt: string;
}

export interface ScanRun {
  readonly id: string;
  readonly source: ScanRunSource;
  readonly requestedBy: string;
  readonly idempotencyKeyHash: string;
  readonly requestHash: string;
  readonly status: ScanRunStatus;
  readonly executionMode: 'sync' | 'async';
  readonly planVersion: number;
  readonly ruleVersion: number;
  readonly normalizedRule: ScanRuleAst;
  readonly executionPlan: ScanExecutionPlan;
  readonly universeSnapshot: PersistedUniverseSnapshot;
  readonly complexityScore: number;
  readonly dataCutoffAt: Date;
  readonly queuedAt: Date;
  readonly cancelRequestedAt: Date | null;
  readonly cancelledAt: Date | null;
}

export interface NewScanRun {
  readonly source: ScanRunSource;
  readonly requestedBy: string;
  readonly idempotencyKeyHash: string;
  readonly requestHash: string;
  readonly executionPlan: ScanExecutionPlan;
  readonly universeSnapshot: PersistedUniverseSnapshot;
  readonly dataCutoffAt: Date;
}

export interface ScanRunTransition {
  readonly runId: string;
  readonly fromStatus: ScanRunStatus;
  readonly toStatus: ScanRunStatus;
  readonly occurredAt: Date;
  readonly actorUserId?: string | undefined;
  readonly errorCode?: string | undefined;
}

export interface IdempotentScanRunCreation {
  readonly run: ScanRun;
  readonly created: boolean;
}

export interface ScanRunRepository {
  findById(id: string): Promise<ScanRun | null>;
  findByIdempotency(
    requestedBy: string,
    idempotencyKeyHash: string,
  ): Promise<ScanRun | null>;
  createIdempotently(input: NewScanRun): Promise<IdempotentScanRunCreation>;
  transition(input: ScanRunTransition): Promise<ScanRun | null>;
}

export interface ScanUniverseResolver {
  resolve(filter: ScanUniverseFilter): Promise<ResolvedUniverseSnapshot>;
}

export interface ScanSourceAuthorizationPort {
  authorize(input: {
    readonly userId: string;
    readonly source: ScanRunSource;
  }): Promise<
    | boolean
    | {
        readonly allowed: boolean;
        readonly errorCode?: 'SAVED_SCAN_DELETED' | undefined;
      }
  >;
}

export interface CreateScanRunRequest {
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly rule: unknown;
  readonly source?: ScanRunSource | undefined;
  readonly requestedHistoryBars?: number | undefined;
}

export interface CreateScanRunResult {
  readonly run: ScanRun;
  readonly replayed: boolean;
}

export interface ScanRunApplicationDependencies {
  readonly repository: ScanRunRepository;
  readonly universeResolver: ScanUniverseResolver;
  readonly sourceAuthorization: ScanSourceAuthorizationPort;
  readonly planner: ScanPlannerDependencies;
  readonly now?: (() => Date) | undefined;
}
