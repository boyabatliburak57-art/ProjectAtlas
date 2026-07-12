import type { ScanGroupOperator, ScanOperator } from '../ast/contracts.js';

export const SCAN_EVALUATION_STATUSES = [
  'matched',
  'notMatched',
  'notEvaluable',
] as const;

export type ScanEvaluationStatus = (typeof SCAN_EVALUATION_STATUSES)[number];

export type ScanNotEvaluableReason =
  | 'OPERAND_UNAVAILABLE'
  | 'OPERAND_TYPE_MISMATCH'
  | 'PREVIOUS_VALUE_UNAVAILABLE'
  | 'ZERO_DENOMINATOR'
  | 'OPERATOR_NOT_IMPLEMENTED';

export interface PreparedNumberValue {
  readonly type: 'number';
  readonly current: number | null;
  readonly previous?: number | null | undefined;
}

export interface PreparedBooleanValue {
  readonly type: 'boolean';
  readonly current: boolean | null;
}

export type PreparedOperandValue = PreparedNumberValue | PreparedBooleanValue;

export type PreparedOperandValues = ReadonlyMap<string, PreparedOperandValue>;

export interface ConditionNodeEvaluation {
  readonly type: 'condition';
  readonly nodeId: string;
  readonly operator: ScanOperator;
  readonly status: ScanEvaluationStatus;
  readonly reason?: ScanNotEvaluableReason | undefined;
}

export interface GroupNodeEvaluation {
  readonly type: 'group';
  readonly nodeId: string;
  readonly operator: ScanGroupOperator;
  readonly status: ScanEvaluationStatus;
  readonly children: readonly ScanNodeEvaluation[];
}

export type ScanNodeEvaluation = ConditionNodeEvaluation | GroupNodeEvaluation;

export interface ScanRuleEvaluation {
  readonly status: ScanEvaluationStatus;
  readonly root: GroupNodeEvaluation;
}

export interface ResolvedConditionOperands {
  readonly left: PreparedOperandValue;
  readonly right?: PreparedOperandValue | undefined;
  readonly upperBound?: PreparedOperandValue | undefined;
}

export interface ScanOperatorEvaluationInput {
  readonly operands: ResolvedConditionOperands;
  readonly percent?: number | undefined;
}

export interface ScanOperatorEvaluation {
  readonly status: ScanEvaluationStatus;
  readonly reason?: ScanNotEvaluableReason | undefined;
}

export type ScanOperatorEvaluator = (
  input: ScanOperatorEvaluationInput,
) => ScanOperatorEvaluation;
