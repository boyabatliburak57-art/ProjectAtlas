import type {
  IndicatorInputField,
  IndicatorTimeframe,
  WarmupRequirement,
} from '../../indicators/contracts.js';
import type { IndicatorRegistry } from '../../indicators/registry/indicator-registry.js';
import type { ScanRuleAst, ScanUniverseFilter } from '../ast/contracts.js';

export const SCAN_EXECUTION_PLAN_VERSION = 1 as const;

export interface ScanPlanningRequest {
  readonly rule: unknown;
  readonly universeInstrumentCount: number;
  readonly requestedHistoryBars?: number | undefined;
}

export interface PlannedUniverseRequest {
  readonly filter: ScanUniverseFilter;
  readonly instrumentCount: number;
}

export interface PlannedIndicatorRequest {
  readonly key: string;
  readonly code: string;
  readonly version: number;
  readonly timeframe: IndicatorTimeframe;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly requestedOutputs: readonly string[];
  readonly requiredInputFields: readonly IndicatorInputField[];
  readonly warmup: WarmupRequirement;
}

export interface ScanDataRequirement {
  readonly timeframe: IndicatorTimeframe;
  readonly fields: readonly IndicatorInputField[];
  readonly requestedHistoryBars: number;
  readonly warmupBars: number;
  readonly operatorHistoryBars: number;
  readonly requiredBars: number;
}

export interface ScanComplexity {
  readonly score: number;
  readonly instrumentCount: number;
  readonly timeframeCount: number;
  readonly uniqueIndicatorCount: number;
  readonly warmupBars: number;
  readonly nodeCount: number;
  readonly groupDepth: number;
  readonly operatorHistoryBars: number;
  readonly requestedHistoryBars: number;
}

export interface ScanExecutionPlan {
  readonly planVersion: typeof SCAN_EXECUTION_PLAN_VERSION;
  readonly universe: PlannedUniverseRequest;
  readonly dataRequirements: readonly ScanDataRequirement[];
  readonly indicatorRequests: readonly PlannedIndicatorRequest[];
  readonly timeframes: readonly IndicatorTimeframe[];
  readonly normalizedRule: ScanRuleAst;
  readonly complexity: ScanComplexity;
  readonly executionMode: 'sync' | 'async';
}

export interface ScanEntitlementContext {
  readonly universeInstrumentCount: number;
  readonly uniqueIndicatorCount: number;
  readonly timeframes: readonly IndicatorTimeframe[];
  readonly complexityScore: number;
  readonly executionMode: ScanExecutionPlan['executionMode'];
}

export interface ScanEntitlementDecision {
  readonly allowed: boolean;
  readonly reasonCode?: string | undefined;
}

export interface ScanEntitlementPort {
  check(context: ScanEntitlementContext): ScanEntitlementDecision;
}

export interface ScanPlannerLimits {
  readonly maximumComplexityScore: number;
  readonly asynchronousComplexityThreshold: number;
}

export interface ScanPlannerDependencies {
  readonly indicatorRegistry: IndicatorRegistry;
  readonly entitlement: ScanEntitlementPort;
  readonly limits: ScanPlannerLimits;
}
