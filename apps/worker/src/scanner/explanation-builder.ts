import type {
  PreparedOperandValue,
  PreparedOperandValues,
  ScanConditionNode,
  ScanNodeEvaluation,
  ScanRuleAst,
  ScanRuleEvaluation,
  ScanRuleNode,
} from '@atlas/domain';
import { createScanOperandKey } from '@atlas/domain';

import type { ScannerWarning } from './contracts';

export const SCANNER_EXPLANATION_VERSION = 1 as const;

export function buildScannerExplanation(
  rule: ScanRuleAst,
  evaluation: ScanRuleEvaluation,
  values: PreparedOperandValues,
  warnings: readonly ScannerWarning[],
): Readonly<Record<string, unknown>> {
  const conditions = conditionMap(rule.root);
  return {
    version: SCANNER_EXPLANATION_VERSION,
    status: evaluation.status,
    root: explainNode(evaluation.root, conditions, values, warnings),
  };
}

export function buildComputedValues(
  rule: ScanRuleAst,
  values: PreparedOperandValues,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  visitConditions(rule.root, (condition) => {
    result[condition.nodeId] = {
      left: publicValue(values.get(createScanOperandKey(condition.left))),
      ...(condition.right === undefined
        ? {}
        : {
            right: publicValue(
              values.get(createScanOperandKey(condition.right)),
            ),
          }),
      ...(condition.upperBound === undefined
        ? {}
        : {
            upperBound: publicValue(
              values.get(createScanOperandKey(condition.upperBound)),
            ),
          }),
    };
  });
  return result;
}

function explainNode(
  evaluation: ScanNodeEvaluation,
  conditions: ReadonlyMap<string, ScanConditionNode>,
  values: PreparedOperandValues,
  warnings: readonly ScannerWarning[],
): Readonly<Record<string, unknown>> {
  if (evaluation.type === 'group') {
    return {
      nodeId: evaluation.nodeId,
      type: evaluation.type,
      operator: evaluation.operator,
      status: evaluation.status,
      children: evaluation.children.map((child) =>
        explainNode(child, conditions, values, warnings),
      ),
    };
  }

  const condition = conditions.get(evaluation.nodeId);
  if (condition === undefined) {
    return {
      nodeId: evaluation.nodeId,
      type: evaluation.type,
      operator: evaluation.operator,
      status: evaluation.status,
      reason: evaluation.reason,
    };
  }
  const left = values.get(createScanOperandKey(condition.left));
  return {
    nodeId: evaluation.nodeId,
    type: evaluation.type,
    operator: evaluation.operator,
    status: evaluation.status,
    ...(evaluation.reason === undefined ? {} : { reason: evaluation.reason }),
    timeframe: operandTimeframe(condition.left),
    currentValue: left?.current ?? null,
    ...(left?.type === 'number'
      ? { previousValue: left.previous ?? null }
      : {}),
    warnings: warnings
      .filter((warning) => warning.nodeId === evaluation.nodeId)
      .map(({ code, message }) => ({ code, message })),
  };
}

function publicValue(value: PreparedOperandValue | undefined): unknown {
  if (value === undefined) return null;
  return value.type === 'number'
    ? { current: value.current, previous: value.previous ?? null }
    : { current: value.current };
}

function operandTimeframe(operand: ScanConditionNode['left']): string | null {
  return 'timeframe' in operand ? operand.timeframe : null;
}

function conditionMap(
  root: ScanRuleNode,
): ReadonlyMap<string, ScanConditionNode> {
  const result = new Map<string, ScanConditionNode>();
  visitConditions(root, (condition) => result.set(condition.nodeId, condition));
  return result;
}

function visitConditions(
  node: ScanRuleNode,
  visit: (condition: ScanConditionNode) => void,
): void {
  if (node.type === 'condition') {
    visit(node);
    return;
  }
  for (const child of node.children) visitConditions(child, visit);
}
