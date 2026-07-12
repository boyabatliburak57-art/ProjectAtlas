import type {
  ScanConditionNode,
  ScanGroupNode,
  ScanOperand,
  ScanRuleAst,
  ScanRuleNode,
} from '../ast/contracts.js';
import { evaluateScanOperator } from '../operators/operator-evaluator.js';
import type {
  ConditionNodeEvaluation,
  GroupNodeEvaluation,
  PreparedOperandValue,
  PreparedOperandValues,
  ResolvedConditionOperands,
  ScanEvaluationStatus,
  ScanNodeEvaluation,
  ScanRuleEvaluation,
} from './contracts.js';
import { createScanOperandKey } from './operand-values.js';

export function evaluateScanRule(
  rule: ScanRuleAst,
  preparedValues: PreparedOperandValues,
): ScanRuleEvaluation {
  const root = evaluateGroup(rule.root, preparedValues);
  return { status: root.status, root };
}

export function combineScanEvaluationStatuses(
  operator: ScanGroupNode['operator'],
  statuses: readonly ScanEvaluationStatus[],
): ScanEvaluationStatus {
  if (operator === 'AND') {
    if (statuses.includes('notMatched')) return 'notMatched';
    return statuses.every((status) => status === 'matched')
      ? 'matched'
      : 'notEvaluable';
  }
  if (statuses.includes('matched')) return 'matched';
  return statuses.every((status) => status === 'notMatched')
    ? 'notMatched'
    : 'notEvaluable';
}

function evaluateNode(
  node: ScanRuleNode,
  values: PreparedOperandValues,
): ScanNodeEvaluation {
  return node.type === 'group'
    ? evaluateGroup(node, values)
    : evaluateCondition(node, values);
}

function evaluateGroup(
  node: ScanGroupNode,
  values: PreparedOperandValues,
): GroupNodeEvaluation {
  const children = node.children.map((child) => evaluateNode(child, values));
  return {
    type: 'group',
    nodeId: node.nodeId,
    operator: node.operator,
    status: combineScanEvaluationStatuses(
      node.operator,
      children.map((child) => child.status),
    ),
    children,
  };
}

function evaluateCondition(
  node: ScanConditionNode,
  values: PreparedOperandValues,
): ConditionNodeEvaluation {
  const resolved = resolveConditionOperands(node, values);
  if (resolved === undefined) {
    return {
      type: 'condition',
      nodeId: node.nodeId,
      operator: node.operator,
      status: 'notEvaluable',
      reason: 'OPERAND_UNAVAILABLE',
    };
  }
  const evaluation = evaluateScanOperator(node.operator, {
    operands: resolved,
    percent: node.options?.percent,
  });
  return {
    type: 'condition',
    nodeId: node.nodeId,
    operator: node.operator,
    ...evaluation,
  };
}

function resolveConditionOperands(
  node: ScanConditionNode,
  values: PreparedOperandValues,
): ResolvedConditionOperands | undefined {
  const left = resolveOperand(node.left, values);
  const right = resolveOptionalOperand(node.right, values);
  const upperBound = resolveOptionalOperand(node.upperBound, values);
  if (
    left === undefined ||
    right === missingOperand ||
    upperBound === missingOperand
  ) {
    return undefined;
  }
  return {
    left,
    ...(right === undefined ? {} : { right }),
    ...(upperBound === undefined ? {} : { upperBound }),
  };
}

const missingOperand = Symbol('missingOperand');

function resolveOptionalOperand(
  operand: ScanOperand | undefined,
  values: PreparedOperandValues,
): PreparedOperandValue | typeof missingOperand | undefined {
  if (operand === undefined) return undefined;
  return resolveOperand(operand, values) ?? missingOperand;
}

function resolveOperand(
  operand: ScanOperand,
  values: PreparedOperandValues,
): PreparedOperandValue | undefined {
  if (operand.type === 'constantNumber') {
    return { type: 'number', current: operand.value, previous: operand.value };
  }
  if (operand.type === 'constantBoolean') {
    return { type: 'boolean', current: operand.value };
  }
  return values.get(createScanOperandKey(operand));
}
