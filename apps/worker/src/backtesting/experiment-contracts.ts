import type {
  ExperimentDefinitionInput,
  ExperimentRuntimeRecord,
  StrategyDefinition,
} from '@atlas/domain';
import type { ExperimentQueuePayload } from '@atlas/types';

export type ExperimentJobData = ExperimentQueuePayload;

export interface AuthoritativeExperiment {
  readonly runtime: ExperimentRuntimeRecord;
  readonly definition: ExperimentDefinitionInput;
  readonly strategyDefinition: StrategyDefinition;
  readonly strategyRevisionId: string;
  readonly complexityScore: number;
  readonly dataCutoffAt: string;
  readonly status: string;
}

export interface ExperimentAggregation {
  readonly terminal: boolean;
  readonly status: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  readonly completedCount: number;
  readonly failedCount: number;
  readonly cancelledCount: number;
  readonly reusedCount: number;
}

export interface ExperimentRuntimeMetrics {
  increment(name: string, value?: number): void;
  observe(name: string, value: number): void;
}
