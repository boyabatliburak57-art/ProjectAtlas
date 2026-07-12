import type { IndicatorTimeframe } from '../../indicators/contracts.js';

export const SCAN_RULE_VERSION = 1 as const;
export const SCAN_GROUP_OPERATORS = ['AND', 'OR'] as const;
export const SCAN_OPERATORS = [
  'EQ',
  'NE',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'BETWEEN',
  'OUTSIDE',
  'CROSSES_ABOVE',
  'CROSSES_BELOW',
  'HIGHEST_IN_PERIOD',
  'LOWEST_IN_PERIOD',
  'INCREASED_BY_PERCENT',
  'DECREASED_BY_PERCENT',
  'WITHIN_PERCENT_OF',
  'IS_TRUE',
  'IS_FALSE',
] as const;

export type ScanGroupOperator = (typeof SCAN_GROUP_OPERATORS)[number];
export type ScanOperator = (typeof SCAN_OPERATORS)[number];
export type ScanUniverseStatus = 'active' | 'inactive' | 'delisted';

export interface ScanUniverseFilter {
  readonly market: 'BIST';
  readonly statuses: readonly ScanUniverseStatus[];
  readonly indexCodes: readonly string[];
  readonly sectorIds: readonly string[];
}

export interface IndicatorOperand {
  readonly type: 'indicator';
  readonly code: string;
  readonly version: number;
  readonly output?: string | undefined;
  readonly timeframe: IndicatorTimeframe;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface PriceFieldOperand {
  readonly type: 'priceField';
  readonly field: 'open' | 'high' | 'low' | 'close';
  readonly timeframe: IndicatorTimeframe;
}

export interface VolumeFieldOperand {
  readonly type: 'volumeField';
  readonly field: 'volume';
  readonly timeframe: IndicatorTimeframe;
}

export interface MarketFieldOperand {
  readonly type: 'marketField';
  readonly field:
    | 'marketCap'
    | 'freeFloatMarketCap'
    | 'averageVolume'
    | 'isIndexMember'
    | 'isActive';
}

export interface ConstantNumberOperand {
  readonly type: 'constantNumber';
  readonly value: number;
}

export interface ConstantBooleanOperand {
  readonly type: 'constantBoolean';
  readonly value: boolean;
}

export type ScanOperand =
  | IndicatorOperand
  | PriceFieldOperand
  | VolumeFieldOperand
  | MarketFieldOperand
  | ConstantNumberOperand
  | ConstantBooleanOperand;

export interface ScanConditionOptions {
  readonly period?: number | undefined;
  readonly percent?: number | undefined;
}

export interface ScanConditionNode {
  readonly type: 'condition';
  readonly nodeId: string;
  readonly operator: ScanOperator;
  readonly left: ScanOperand;
  readonly right?: ScanOperand | undefined;
  readonly upperBound?: ScanOperand | undefined;
  readonly options?: ScanConditionOptions | undefined;
}

export interface ScanGroupNode {
  readonly type: 'group';
  readonly nodeId: string;
  readonly operator: ScanGroupOperator;
  readonly children: readonly ScanRuleNode[];
}

export type ScanRuleNode = ScanGroupNode | ScanConditionNode;

export interface ScanRuleAst {
  readonly version: typeof SCAN_RULE_VERSION;
  readonly universe: ScanUniverseFilter;
  readonly root: ScanGroupNode;
}

export interface ScanValidationError {
  readonly code:
    | 'DUPLICATE_NODE_ID'
    | 'EMPTY_GROUP'
    | 'INVALID_FIELD'
    | 'INVALID_NODE'
    | 'INVALID_OPERAND'
    | 'NODE_LIMIT_EXCEEDED'
    | 'DEPTH_LIMIT_EXCEEDED'
    | 'OPERAND_TYPES_INCOMPATIBLE'
    | 'OPERATOR_NOT_SUPPORTED'
    | 'SCAN_RULE_VERSION_UNSUPPORTED';
  readonly path: string;
  readonly message: string;
  readonly nodeId?: string | undefined;
}

export interface ScanValidationLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
}

export interface ScanRuleValidationResult {
  readonly valid: boolean;
  readonly normalizedRule?: ScanRuleAst | undefined;
  readonly errors: readonly ScanValidationError[];
}
