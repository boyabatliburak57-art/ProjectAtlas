export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w';
export type GroupOperator = 'AND' | 'OR';

export interface IndicatorDefinition {
  code: string;
  version: number;
  name: string;
  category: string;
  parameters: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface OperatorDefinition {
  code: string;
  arity: 1 | 2 | 3;
  valueType: 'number' | 'boolean';
  historyRequirement: 'none' | 'previous' | 'period';
  requiredOption?: 'period' | 'percent';
}

export interface IndicatorOperand {
  type: 'indicator';
  code: string;
  version: number;
  timeframe: Timeframe;
  parameters: Record<string, unknown>;
}

export interface ConstantNumberOperand {
  type: 'constantNumber';
  value: number;
}

export type NumericOperand = IndicatorOperand | ConstantNumberOperand;

export interface ConditionNode {
  type: 'condition';
  nodeId: string;
  operator: string;
  left: IndicatorOperand;
  right?: NumericOperand;
  upperBound?: ConstantNumberOperand;
  options?: { period?: number; percent?: number };
}

export interface GroupNode {
  type: 'group';
  nodeId: string;
  operator: GroupOperator;
  children: RuleNode[];
}

export type RuleNode = GroupNode | ConditionNode;

export interface ScanRule {
  version: 1;
  universe: {
    market: 'BIST';
    statuses: ('active' | 'inactive' | 'delisted')[];
    indexCodes: string[];
    sectorIds: string[];
  };
  root: GroupNode;
}

export interface ValidationError {
  code: string;
  path: string;
  message: string;
  nodeId?: string;
}

export interface ValidationResult {
  valid: boolean;
  normalizedRule?: ScanRule;
  errors: ValidationError[];
  warnings: string[];
  complexity?: {
    score: number;
    nodeCount: number;
    uniqueIndicatorCount: number;
    warmupBars: number;
  };
  executionMode?: 'sync' | 'async';
  timeframes?: Timeframe[];
}

export interface RunProgress {
  total: number;
  processed: number;
  matched: number;
  notEvaluable: number;
  warnings: number;
  phase: string;
  percent: number;
  stale: boolean;
  terminal: boolean;
  pollAfterMs: number | null;
}

export interface ScanRun {
  id: string;
  status:
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelRequested'
    | 'cancelled'
    | 'expired';
  executionMode: 'sync' | 'async';
  planVersion: number;
  ruleVersion: number;
  progress: RunProgress;
  dataCutoffAt: string;
  errorCode: string | null;
}

export interface ScanResult {
  id: string;
  instrumentId: string;
  rank: number | null;
  status: 'matched' | 'notEvaluable';
  computedValues: Record<string, unknown>;
  explanation?: Record<string, unknown>;
  warnings: Record<string, unknown>[];
  dataCutoffAt: string;
}

export interface PresetSummary {
  id: string;
  code: string;
  name: string;
  description: string;
  categoryCode?: string;
  revision: number;
  rule?: ScanRule;
}
