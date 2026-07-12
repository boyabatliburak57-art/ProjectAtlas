import type {
  ClosedBarPolicy,
  IndicatorCalculationResult,
  IndicatorInput,
  IndicatorOutput,
} from '../contracts.js';
import type { IndicatorErrorCode } from '../errors.js';

export interface BatchIndicatorRequest {
  readonly requestId: string;
  readonly indicatorCode: string;
  readonly indicatorVersion: number;
  readonly parameters: unknown;
  readonly input: IndicatorInput;
  readonly closedBarPolicy: ClosedBarPolicy;
}

export interface BatchWarmupAggregation {
  readonly minimumInputBars: number;
  readonly recommendedWarmupBars: number;
  readonly firstValidIndex: number;
}

export interface BatchIndicatorSuccess {
  readonly status: 'success';
  readonly requestId: string;
  readonly result: IndicatorCalculationResult;
  readonly cacheHit: boolean;
  readonly deduplicated: boolean;
}

export interface BatchIndicatorFailure {
  readonly status: 'failure';
  readonly requestId: string;
  readonly error: {
    readonly code: IndicatorErrorCode;
    readonly message: string;
  };
}

export type BatchIndicatorResult =
  | BatchIndicatorSuccess
  | BatchIndicatorFailure;

export interface BatchExecutionReport {
  readonly warmup: BatchWarmupAggregation;
  readonly results: readonly BatchIndicatorResult[];
}

export interface IndicatorResultCache {
  get(key: string): Promise<IndicatorCalculationResult | null>;
  set(key: string, value: IndicatorCalculationResult): Promise<void>;
}

export interface IndicatorMetrics {
  increment(
    metric: string,
    value?: number,
    tags?: Readonly<Record<string, string>>,
  ): void;
}

export interface BatchExecutorDependencies {
  readonly cache: IndicatorResultCache;
  readonly metrics: IndicatorMetrics;
  readonly now?: (() => Date) | undefined;
}

export type CachedIndicatorOutput = IndicatorOutput;
