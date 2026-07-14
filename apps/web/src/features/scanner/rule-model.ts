import type {
  ConditionNode,
  GroupNode,
  IndicatorDefinition,
  RuleNode,
  ScanRule,
  ValidationError,
} from './types';

export function nodeId(prefix: 'group' | 'condition'): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

export function condition(indicator: IndicatorDefinition): ConditionNode {
  return {
    type: 'condition',
    nodeId: nodeId('condition'),
    operator: 'GT',
    left: {
      type: 'indicator',
      code: indicator.code,
      version: indicator.version,
      timeframe: '1d',
      parameters: defaultParameters(indicator.parameters),
    },
    right: { type: 'constantNumber', value: 50 },
  };
}

export function emptyRule(indicator: IndicatorDefinition): ScanRule {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: [],
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: nodeId('group'),
      operator: 'AND',
      children: [condition(indicator)],
    },
  };
}

function defaultParameters(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const properties = isRecord(metadata.properties)
    ? metadata.properties
    : metadata;
  for (const [key, raw] of Object.entries(properties)) {
    if (raw && typeof raw === 'object' && 'default' in raw)
      result[key] = raw.default;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function updateNode(
  group: GroupNode,
  id: string,
  updater: (node: RuleNode) => RuleNode,
): GroupNode {
  return {
    ...group,
    children: group.children.map((child) => {
      if (child.nodeId === id) return updater(child);
      return child.type === 'group' ? updateNode(child, id, updater) : child;
    }),
  };
}

export function removeNode(group: GroupNode, id: string): GroupNode {
  return {
    ...group,
    children: group.children
      .filter((child) => child.nodeId !== id)
      .map((child) => (child.type === 'group' ? removeNode(child, id) : child)),
  };
}

export function addChild(
  group: GroupNode,
  parentId: string,
  child: RuleNode,
): GroupNode {
  if (group.nodeId === parentId)
    return { ...group, children: [...group.children, child] };
  return {
    ...group,
    children: group.children.map((item) =>
      item.type === 'group' ? addChild(item, parentId, child) : item,
    ),
  };
}

export function moveNode(
  group: GroupNode,
  id: string,
  direction: -1 | 1,
): GroupNode {
  const index = group.children.findIndex((child) => child.nodeId === id);
  if (index >= 0) {
    const target = index + direction;
    if (target < 0 || target >= group.children.length) return group;
    const children = [...group.children];
    [children[index], children[target]] = [children[target]!, children[index]!];
    return { ...group, children };
  }
  return {
    ...group,
    children: group.children.map((child) =>
      child.type === 'group' ? moveNode(child, id, direction) : child,
    ),
  };
}

export function localValidate(rule: ScanRule): ValidationError[] {
  const errors: ValidationError[] = [];
  const ids = new Set<string>();
  const visit = (node: RuleNode) => {
    if (ids.has(node.nodeId))
      errors.push({
        code: 'DUPLICATE_NODE_ID',
        path: node.nodeId,
        nodeId: node.nodeId,
        message: 'Düğüm kimliği benzersiz olmalı.',
      });
    ids.add(node.nodeId);
    if (node.type === 'group') {
      if (node.children.length === 0)
        errors.push({
          code: 'EMPTY_GROUP',
          path: node.nodeId,
          nodeId: node.nodeId,
          message: 'Grup en az bir koşul içermeli.',
        });
      node.children.forEach(visit);
    } else if (
      !node.left.code ||
      !node.operator ||
      (node.right?.type === 'constantNumber' &&
        !Number.isFinite(node.right.value))
    ) {
      errors.push({
        code: 'INVALID_CONDITION',
        path: node.nodeId,
        nodeId: node.nodeId,
        message: 'Koşul alanlarını tamamlayın.',
      });
    }
  };
  visit(rule.root);
  return errors;
}

export function complexityLabel(score = 0): 'Düşük' | 'Orta' | 'Yüksek' {
  if (score < 25_000) return 'Düşük';
  if (score < 50_000) return 'Orta';
  return 'Yüksek';
}
