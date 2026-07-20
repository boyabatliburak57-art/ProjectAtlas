import type {
  StrategyParameterDefinition,
  StrategyParameterValue,
} from '../strategies/contracts.js';
import type {
  BacktestExecutionPlan,
  BacktestTimelineEvent,
} from './contracts.js';

export const BACKTEST_RUN_STATUSES = [
  'queued',
  'resolvingData',
  'running',
  'calculatingMetrics',
  'completed',
  'failed',
  'cancelRequested',
  'cancelled',
  'expired',
] as const;

export type BacktestRunStatus = (typeof BACKTEST_RUN_STATUSES)[number];

export interface BacktestDataSnapshotResolution {
  readonly id: string;
  readonly hash: string;
  readonly dataCutoffAt: string;
  readonly universeSnapshot: Readonly<Record<string, unknown>>;
  readonly events: readonly BacktestTimelineEvent[];
  readonly coverageStatus: 'complete' | 'partial' | 'notEvaluable';
}

export interface BacktestRunRecord {
  readonly id: string;
  readonly requestedBy: string;
  readonly strategyId: string;
  readonly strategyRevision: number;
  readonly status: BacktestRunStatus;
  readonly requestHash: string;
  readonly idempotencyKeyHash: string;
  readonly executionPlan: BacktestExecutionPlan;
  readonly dataSnapshotId: string;
  readonly dataSnapshotHash: string;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly complexityScore: number;
  readonly progressPercent: number;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelRequestedAt: string | null;
  readonly errorCode: string | null;
}

export interface CreateBacktestRunRequest {
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly strategyId: string;
  readonly strategyRevision: number;
  readonly executionPlan: BacktestExecutionPlan;
  readonly dataSnapshotHash: string;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly complexityScore: number;
  readonly experimentBinding?:
    | {
        readonly hash: string;
        readonly sampleRole: ExperimentSampleRole;
        readonly values: Readonly<Record<string, StrategyParameterValue>>;
      }
    | undefined;
}

export interface BacktestRunCreationInput {
  readonly id: string;
  readonly requestedBy: string;
  readonly strategyId: string;
  readonly strategyRevision: number;
  readonly requestHash: string;
  readonly idempotencyKeyHash: string;
  readonly executionPlan: BacktestExecutionPlan;
  readonly snapshot: BacktestDataSnapshotResolution;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly complexityScore: number;
  readonly experimentBinding?: CreateBacktestRunRequest['experimentBinding'];
  readonly queuedAt: string;
}

export interface BacktestRunRepository {
  findById(id: string): Promise<BacktestRunRecord | null>;
  findByIdempotency(
    userId: string,
    idempotencyKeyHash: string,
  ): Promise<BacktestRunRecord | null>;
  createIdempotently(input: BacktestRunCreationInput): Promise<{
    readonly run: BacktestRunRecord;
    readonly created: boolean;
  }>;
  listDispatchable(limit: number): Promise<readonly BacktestRunRecord[]>;
  requestCancellation(input: {
    readonly runId: string;
    readonly userId: string;
    readonly requestedAt: string;
  }): Promise<BacktestRunRecord | null>;
}

export interface BacktestDataSnapshotResolver {
  resolve(input: {
    readonly userId: string;
    readonly strategyId: string;
    readonly strategyRevision: number;
    readonly snapshotHash: string;
    readonly rangeFrom: string;
    readonly rangeTo: string;
  }): Promise<BacktestDataSnapshotResolution>;
}

export interface BacktestEntitlementPort {
  authorize(input: {
    readonly userId: string;
    readonly complexityScore: number;
  }): Promise<{
    readonly allowed: boolean;
    readonly maximumComplexityScore: number;
  }>;
}

export interface BacktestRunDispatcher {
  dispatch(input: {
    readonly runId: string;
    readonly correlationId: string;
  }): Promise<void>;
}

export interface BacktestRunApplicationDependencies {
  readonly repository: BacktestRunRepository;
  readonly snapshotResolver: BacktestDataSnapshotResolver;
  readonly entitlement: BacktestEntitlementPort;
  readonly dispatcher: BacktestRunDispatcher;
  readonly idGenerator: () => string;
  readonly now?: (() => Date) | undefined;
}

export type ExperimentSampleRole = 'train' | 'validation' | 'test' | 'holdout';

export type ExperimentGridAxis =
  | {
      readonly parameter: string;
      readonly values: readonly StrategyParameterValue[];
    }
  | {
      readonly parameter: string;
      readonly range: {
        readonly from: number;
        readonly to: number;
        readonly step: number;
      };
    };

export interface ExperimentSampleRange {
  readonly role: ExperimentSampleRole;
  readonly from: string;
  readonly to: string;
}

export interface ExperimentGridDefinition {
  readonly axes: readonly ExperimentGridAxis[];
  readonly samples: readonly ExperimentSampleRange[];
  readonly maximumCombinations: number;
}

export interface ExperimentCombination {
  readonly index: number;
  readonly values: Readonly<Record<string, StrategyParameterValue>>;
  readonly bindingHash: string;
}

export interface ExperimentChildBinding {
  readonly combinationIndex: number;
  readonly sampleRole: ExperimentSampleRole;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly values: Readonly<Record<string, StrategyParameterValue>>;
  readonly bindingHash: string;
}

export interface ExperimentDefinitionInput {
  readonly parameterDefinitions: readonly StrategyParameterDefinition[];
  readonly grid: ExperimentGridDefinition;
}

export interface ExperimentRuntimeRecord {
  readonly id: string;
  readonly ownerUserId: string;
  readonly status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelRequested'
    | 'cancelled';
  readonly strategyId: string;
  readonly strategyRevision: number;
  readonly dataSnapshotHash: string;
}

export interface ExperimentRunCompatibilityKey {
  readonly ownerUserId: string;
  readonly strategyId: string;
  readonly strategyRevision: number;
  readonly bindingHash: string;
  readonly dataSnapshotHash: string;
  readonly engineVersion: string;
  readonly executionPolicyVersion: string;
  readonly costPolicyVersion: string;
  readonly eventOrderingPolicyVersion: string;
  readonly rangeFrom: string;
  readonly rangeTo: string;
}

export interface ExperimentRuntimeRepository {
  isCancellationRequested(experimentId: string): Promise<boolean>;
  findReusableCompletedRun(
    key: ExperimentRunCompatibilityKey,
  ): Promise<{ readonly runId: string } | null>;
  attachChild(input: {
    readonly experimentId: string;
    readonly ownerUserId: string;
    readonly child: ExperimentChildBinding;
    readonly runId: string;
    readonly status: 'queued' | 'reused';
  }): Promise<'created' | 'duplicate'>;
  markChildFailed(input: {
    readonly experimentId: string;
    readonly child: ExperimentChildBinding;
    readonly errorCode: string;
  }): Promise<void>;
  listRunningChildRunIds(experimentId: string): Promise<readonly string[]>;
  completeExperiment(input: {
    readonly experimentId: string;
    readonly status: 'completed' | 'partial' | 'failed' | 'cancelled';
    readonly completedCount: number;
    readonly failedCount: number;
    readonly reusedCount: number;
    readonly warnings: readonly string[];
  }): Promise<void>;
}

export interface ExperimentChildRunPort {
  create(input: {
    readonly experiment: ExperimentRuntimeRecord;
    readonly child: ExperimentChildBinding;
  }): Promise<{ readonly runId: string }>;
  requestCancellation(runId: string, userId: string): Promise<void>;
}
