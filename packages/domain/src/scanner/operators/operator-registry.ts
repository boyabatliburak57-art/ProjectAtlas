import type {
  ScanConditionNode,
  ScanOperand,
  ScanOperator,
} from '../ast/contracts.js';

export type OperandValueType = 'number' | 'boolean';

export interface ScanOperatorDefinition {
  readonly code: ScanOperator;
  readonly arity: 1 | 2 | 3;
  readonly valueType: OperandValueType;
  readonly historyRequirement: 'none' | 'previous' | 'period';
  readonly requiredOption?: 'period' | 'percent' | undefined;
}

const definitions: readonly ScanOperatorDefinition[] = [
  ...(['EQ', 'NE'] as const).map((code) => ({
    code,
    arity: 2 as const,
    valueType: 'number' as const,
    historyRequirement: 'none' as const,
  })),
  ...(['GT', 'GTE', 'LT', 'LTE'] as const).map((code) => ({
    code,
    arity: 2 as const,
    valueType: 'number' as const,
    historyRequirement: 'none' as const,
  })),
  ...(['BETWEEN', 'OUTSIDE'] as const).map((code) => ({
    code,
    arity: 3 as const,
    valueType: 'number' as const,
    historyRequirement: 'none' as const,
  })),
  ...(['CROSSES_ABOVE', 'CROSSES_BELOW'] as const).map((code) => ({
    code,
    arity: 2 as const,
    valueType: 'number' as const,
    historyRequirement: 'previous' as const,
  })),
  ...(['HIGHEST_IN_PERIOD', 'LOWEST_IN_PERIOD'] as const).map((code) => ({
    code,
    arity: 1 as const,
    valueType: 'number' as const,
    historyRequirement: 'period' as const,
    requiredOption: 'period' as const,
  })),
  ...(['INCREASED_BY_PERCENT', 'DECREASED_BY_PERCENT'] as const).map(
    (code) => ({
      code,
      arity: 1 as const,
      valueType: 'number' as const,
      historyRequirement: 'previous' as const,
      requiredOption: 'percent' as const,
    }),
  ),
  {
    code: 'WITHIN_PERCENT_OF',
    arity: 2,
    valueType: 'number',
    historyRequirement: 'none',
    requiredOption: 'percent',
  },
  ...(['IS_TRUE', 'IS_FALSE'] as const).map((code) => ({
    code,
    arity: 1 as const,
    valueType: 'boolean' as const,
    historyRequirement: 'none' as const,
  })),
];

const registry = new Map(
  definitions.map((definition) => [definition.code, definition]),
);

export function resolveScanOperator(
  code: ScanOperator,
): ScanOperatorDefinition {
  const definition = registry.get(code);
  if (definition === undefined)
    throw new Error(`Missing operator definition: ${code}`);
  return definition;
}

export function operandValueType(operand: ScanOperand): OperandValueType {
  if (operand.type === 'constantBoolean') return 'boolean';
  if (operand.type === 'marketField') {
    return operand.field === 'isIndexMember' || operand.field === 'isActive'
      ? 'boolean'
      : 'number';
  }
  return 'number';
}

export function conditionOperands(
  node: ScanConditionNode,
): readonly ScanOperand[] {
  return [node.left, node.right, node.upperBound].filter(
    (operand): operand is ScanOperand => operand !== undefined,
  );
}

export const SCAN_OPERATOR_DEFINITIONS = definitions;
