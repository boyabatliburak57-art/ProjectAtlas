import { describe, expect, it } from 'vitest';

import { SCAN_OPERATOR_DEFINITIONS } from './operators/operator-registry.js';
import { serializeNormalizedScanRule } from './normalization/normalize-scan-rule.js';
import { validateScanRule } from './validation/scan-rule-validator.js';

interface MutableRawRule {
  version: number;
  universe: {
    market: string;
    statuses: string[];
    indexCodes: string[];
    sectorIds: string[];
  };
  root: {
    type: string;
    nodeId: string;
    operator: string;
    children: Record<string, unknown>[];
  };
}

function numberOperand(value: number) {
  return { type: 'constantNumber', value } as const;
}

function priceOperand(field: 'open' | 'high' | 'low' | 'close' = 'close') {
  return { type: 'priceField', field, timeframe: '1d' } as const;
}

function condition(
  nodeId: string,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    type: 'condition',
    nodeId,
    operator: 'GT',
    left: priceOperand(),
    right: numberOperand(10),
    ...overrides,
  };
}

function validRule(): MutableRawRule {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: ['XU100'],
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: 'root',
      operator: 'AND',
      children: [
        {
          type: 'condition',
          nodeId: 'rsi-limit',
          operator: 'GT',
          left: {
            type: 'indicator',
            code: 'RSI',
            version: 1,
            timeframe: '1d',
            parameters: { period: 14 },
          },
          right: numberOperand(50),
        },
        {
          type: 'group',
          nodeId: 'nested',
          operator: 'OR',
          children: [
            {
              type: 'condition',
              nodeId: 'active',
              operator: 'IS_TRUE',
              left: { type: 'marketField', field: 'isActive' },
            },
            {
              type: 'condition',
              nodeId: 'price-range',
              operator: 'BETWEEN',
              left: priceOperand('close'),
              right: numberOperand(10),
              upperBound: numberOperand(20),
            },
            {
              type: 'condition',
              nodeId: 'volume-high',
              operator: 'HIGHEST_IN_PERIOD',
              left: { type: 'volumeField', field: 'volume', timeframe: '1d' },
              options: { period: 20 },
            },
          ],
        },
      ],
    },
  };
}

describe('Scanner AST validation', () => {
  it('accepts nested groups and allowlisted operand families', () => {
    const result = validateScanRule(validRule());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.normalizedRule?.root.children).toHaveLength(2);
    expect(SCAN_OPERATOR_DEFINITIONS).toHaveLength(17);
  });

  it('rejects empty groups and duplicate nodeId values with exact paths', () => {
    const rule = validRule();
    rule.root.children = [
      condition('duplicate'),
      condition('duplicate'),
      { type: 'group', nodeId: 'empty', operator: 'AND', children: [] },
    ];
    const result = validateScanRule(rule);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DUPLICATE_NODE_ID',
          nodeId: 'duplicate',
          path: '/root/children/1/nodeId',
        }),
        expect.objectContaining({
          code: 'EMPTY_GROUP',
          nodeId: 'empty',
          path: '/root/children/2/children',
        }),
      ]),
    );
  });

  it('enforces depth and node limits at their boundaries', () => {
    const deep = validRule();
    deep.root.children = [
      {
        type: 'group',
        nodeId: 'level-2',
        operator: 'AND',
        children: [
          {
            type: 'group',
            nodeId: 'level-3',
            operator: 'AND',
            children: [condition('level-4')],
          },
        ],
      },
    ];
    const depthResult = validateScanRule(deep, { maxDepth: 3, maxNodes: 10 });
    const nodeResult = validateScanRule(validRule(), {
      maxDepth: 10,
      maxNodes: 3,
    });

    expect(depthResult.errors).toContainEqual(
      expect.objectContaining({
        code: 'DEPTH_LIMIT_EXCEEDED',
        path: '/root/children/0/children/0/children/0',
      }),
    );
    expect(nodeResult.errors).toContainEqual(
      expect.objectContaining({ code: 'NODE_LIMIT_EXCEEDED' }),
    );
  });

  it('rejects incompatible operands, arity and operator options', () => {
    const rule = validRule();
    rule.root.children = [
      condition('boolean-gt', {
        left: { type: 'constantBoolean', value: true },
      }),
      condition('missing-bound', { operator: 'BETWEEN' }),
      condition('missing-period', {
        operator: 'HIGHEST_IN_PERIOD',
        right: undefined,
      }),
      condition('unexpected-option', { options: { percent: 5 } }),
    ];
    const result = validateScanRule(rule);

    expect(
      result.errors.filter(({ code }) => code === 'OPERAND_TYPES_INCOMPATIBLE'),
    ).toHaveLength(4);
    expect(result.errors.map(({ nodeId }) => nodeId)).toEqual(
      expect.arrayContaining([
        'boolean-gt',
        'missing-bound',
        'missing-period',
        'unexpected-option',
      ]),
    );
  });

  it('rejects unsupported versions, operators, fields and executable-shaped data', () => {
    const rule = validRule();
    rule.version = 2;
    rule.root.children = [
      condition('unknown-operator', { operator: 'EXECUTE_SQL' }),
      condition('unknown-field', { sql: 'select * from instruments' }),
      condition('unknown-operand-field', {
        left: {
          type: 'indicator',
          code: 'RSI',
          version: 1,
          timeframe: '1d',
          parameters: {},
          functionName: 'eval',
        },
      }),
      condition('non-finite', { right: numberOperand(Number.NaN) }),
    ];
    const result = validateScanRule(rule);

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SCAN_RULE_VERSION_UNSUPPORTED' }),
        expect.objectContaining({ code: 'OPERATOR_NOT_SUPPORTED' }),
        expect.objectContaining({
          code: 'INVALID_FIELD',
          path: '/root/children/1/sql',
        }),
        expect.objectContaining({
          code: 'INVALID_FIELD',
          path: '/root/children/2/left/functionName',
        }),
        expect.objectContaining({
          code: 'INVALID_OPERAND',
          path: '/root/children/3/right/value',
        }),
      ]),
    );
  });

  it('validates universe allowlists', () => {
    const rule = validRule();
    rule.universe.market = 'NASDAQ';
    rule.universe.statuses = [];
    rule.universe.indexCodes = ['XU100', 'DROP TABLE'];
    const result = validateScanRule(rule);

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/universe/market' }),
        expect.objectContaining({ path: '/universe/statuses' }),
        expect.objectContaining({ path: '/universe/indexCodes' }),
      ]),
    );
  });
});

describe('Scanner AST normalization', () => {
  it('produces byte-identical output for semantically identical ordering', () => {
    const left = validRule();
    left.universe.statuses = ['inactive', 'active', 'active'];
    left.universe.indexCodes = ['XU050', 'XU100', 'XU050'];
    const right = validRule();
    right.universe.statuses = ['active', 'inactive'];
    right.universe.indexCodes = ['XU100', 'XU050'];
    right.root.children.reverse();
    const leftIndicator = left.root.children[0];
    const rightIndicator = right.root.children[1];
    const leftOperand = leftIndicator?.left;
    const rightOperand = rightIndicator?.left;
    if (
      isRecord(leftOperand) &&
      leftOperand.type === 'indicator' &&
      isRecord(rightOperand) &&
      rightOperand.type === 'indicator'
    ) {
      leftOperand.parameters = { period: 14, nested: { b: 2, a: 1 } };
      rightOperand.parameters = { nested: { a: 1, b: 2 }, period: 14 };
    }

    const normalizedLeft = validateScanRule(left).normalizedRule;
    const normalizedRight = validateScanRule(right).normalizedRule;
    expect(normalizedLeft).toBeDefined();
    expect(normalizedRight).toBeDefined();
    expect(serializeNormalizedScanRule(normalizedLeft!)).toBe(
      serializeNormalizedScanRule(normalizedRight!),
    );
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
