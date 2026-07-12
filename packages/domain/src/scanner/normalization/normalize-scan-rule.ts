import type {
  IndicatorOperand,
  ScanConditionNode,
  ScanGroupNode,
  ScanOperand,
  ScanRuleAst,
  ScanRuleNode,
} from '../ast/contracts.js';

export function normalizeScanRule(rule: ScanRuleAst): ScanRuleAst {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: uniqueSorted(rule.universe.statuses),
      indexCodes: uniqueSorted(rule.universe.indexCodes),
      sectorIds: uniqueSorted(rule.universe.sectorIds),
    },
    root: normalizeGroup(rule.root),
  };
}

export function serializeNormalizedScanRule(rule: ScanRuleAst): string {
  return JSON.stringify(normalizeScanRule(rule));
}

function normalizeNode(node: ScanRuleNode): ScanRuleNode {
  return node.type === 'group'
    ? normalizeGroup(node)
    : normalizeCondition(node);
}

function normalizeGroup(node: ScanGroupNode): ScanGroupNode {
  const children = node.children
    .map(normalizeNode)
    .sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'en-US'),
    );
  return {
    type: 'group',
    nodeId: node.nodeId,
    operator: node.operator,
    children,
  };
}

function normalizeCondition(node: ScanConditionNode): ScanConditionNode {
  return {
    type: 'condition',
    nodeId: node.nodeId,
    operator: node.operator,
    left: normalizeOperand(node.left),
    ...(node.right === undefined
      ? {}
      : { right: normalizeOperand(node.right) }),
    ...(node.upperBound === undefined
      ? {}
      : { upperBound: normalizeOperand(node.upperBound) }),
    ...(node.options === undefined
      ? {}
      : {
          options: {
            ...(node.options.period === undefined
              ? {}
              : { period: node.options.period }),
            ...(node.options.percent === undefined
              ? {}
              : { percent: normalizeNumber(node.options.percent) }),
          },
        }),
  };
}

function normalizeOperand(operand: ScanOperand): ScanOperand {
  if (operand.type === 'indicator') return normalizeIndicator(operand);
  if (operand.type === 'constantNumber') {
    return { type: 'constantNumber', value: normalizeNumber(operand.value) };
  }
  return { ...operand };
}

function normalizeIndicator(operand: IndicatorOperand): IndicatorOperand {
  return {
    type: 'indicator',
    code: operand.code.toUpperCase(),
    version: operand.version,
    ...(operand.output === undefined ? {} : { output: operand.output }),
    timeframe: operand.timeframe,
    parameters: canonicalObject(operand.parameters),
  };
}

function canonicalObject(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) return canonicalObject(value);
  return typeof value === 'number' ? normalizeNumber(value) : value;
}

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, 'en-US'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
