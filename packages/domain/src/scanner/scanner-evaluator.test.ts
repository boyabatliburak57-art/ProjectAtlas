import { describe, expect, it } from 'vitest';

import type {
  ScanConditionNode,
  ScanGroupOperator,
  ScanOperand,
  ScanOperator,
  ScanRuleAst,
} from './ast/contracts.js';
import type {
  PreparedOperandValue,
  ScanEvaluationStatus,
} from './evaluation/contracts.js';
import { createPreparedOperandValues } from './evaluation/operand-values.js';
import {
  combineScanEvaluationStatuses,
  evaluateScanRule,
} from './evaluation/scan-rule-evaluator.js';

const close = {
  type: 'priceField',
  field: 'close',
  timeframe: '1d',
} as const;
const open = {
  type: 'priceField',
  field: 'open',
  timeframe: '1d',
} as const;
const active = { type: 'marketField', field: 'isActive' } as const;

function number(value: number) {
  return { type: 'constantNumber', value } as const;
}

function condition(
  operator: ScanOperator,
  left: ScanOperand = close,
  right?: ScanOperand,
  upperBound?: ScanOperand,
  percent?: number,
): ScanConditionNode {
  return {
    type: 'condition',
    nodeId: `condition-${operator}`,
    operator,
    left,
    ...(right === undefined ? {} : { right }),
    ...(upperBound === undefined ? {} : { upperBound }),
    ...(percent === undefined ? {} : { options: { percent } }),
  };
}

function rule(...children: readonly ScanConditionNode[]): ScanRuleAst {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: [],
      sectorIds: [],
    },
    root: { type: 'group', nodeId: 'root', operator: 'AND', children },
  };
}

function evaluate(
  node: ScanConditionNode,
  entries: readonly (readonly [ScanOperand, PreparedOperandValue])[] = [],
) {
  return evaluateScanRule(rule(node), createPreparedOperandValues(entries)).root
    .children[0]!;
}

describe('scanner operator evaluator', () => {
  it.each([
    ['EQ', 5, 5, 'matched'],
    ['NE', 5, 6, 'matched'],
    ['GT', 6, 5, 'matched'],
    ['GTE', 5, 5, 'matched'],
    ['LT', 4, 5, 'matched'],
    ['LTE', 5, 5, 'matched'],
    ['EQ', 5, 6, 'notMatched'],
    ['GT', 5, 5, 'notMatched'],
  ] as const)(
    '%s compares numeric operands',
    (operator, left, right, status) => {
      expect(
        evaluate(condition(operator, number(left), number(right))).status,
      ).toBe(status);
    },
  );

  it('treats BETWEEN bounds as inclusive and OUTSIDE as exclusive', () => {
    expect(
      evaluate(condition('BETWEEN', number(10), number(10), number(20))).status,
    ).toBe('matched');
    expect(
      evaluate(condition('OUTSIDE', number(20), number(10), number(20))).status,
    ).toBe('notMatched');
    expect(
      evaluate(condition('OUTSIDE', number(21), number(10), number(20))).status,
    ).toBe('matched');
  });

  it('evaluates boolean predicates', () => {
    const values = [[active, { type: 'boolean', current: true }]] as const;
    expect(evaluate(condition('IS_TRUE', active), values).status).toBe(
      'matched',
    );
    expect(evaluate(condition('IS_FALSE', active), values).status).toBe(
      'notMatched',
    );
  });

  it('matches crosses above only on the transition bar', () => {
    const node = condition('CROSSES_ABOVE', close, open);
    expect(
      evaluate(node, [
        [close, { type: 'number', previous: 9, current: 11 }],
        [open, { type: 'number', previous: 10, current: 10 }],
      ]).status,
    ).toBe('matched');
    expect(
      evaluate(node, [
        [close, { type: 'number', previous: 11, current: 12 }],
        [open, { type: 'number', previous: 10, current: 10 }],
      ]).status,
    ).toBe('notMatched');
  });

  it('matches crosses below only on the inverse transition bar', () => {
    const node = condition('CROSSES_BELOW', close, open);
    expect(
      evaluate(node, [
        [close, { type: 'number', previous: 11, current: 9 }],
        [open, { type: 'number', previous: 10, current: 10 }],
      ]).status,
    ).toBe('matched');
    expect(
      evaluate(node, [
        [close, { type: 'number', previous: 9, current: 8 }],
        [open, { type: 'number', previous: 10, current: 10 }],
      ]).status,
    ).toBe('notMatched');
  });

  it('reports a missing previous cross value as notEvaluable', () => {
    const result = evaluate(condition('CROSSES_ABOVE', close, number(10)), [
      [close, { type: 'number', current: 11 }],
    ]);
    expect(result).toMatchObject({
      status: 'notEvaluable',
      reason: 'PREVIOUS_VALUE_UNAVAILABLE',
    });
  });

  it('evaluates percentage distance and handles a zero reference safely', () => {
    expect(
      evaluate(
        condition('WITHIN_PERCENT_OF', number(104), number(100), undefined, 5),
      ).status,
    ).toBe('matched');
    expect(
      evaluate(
        condition('WITHIN_PERCENT_OF', number(0), number(0), undefined, 5),
      ).status,
    ).toBe('matched');
    expect(
      evaluate(
        condition('WITHIN_PERCENT_OF', number(1), number(0), undefined, 5),
      ),
    ).toMatchObject({ status: 'notEvaluable', reason: 'ZERO_DENOMINATOR' });
  });

  it('does not turn unavailable or mistyped prepared values into false', () => {
    expect(evaluate(condition('GT', close, number(10))).status).toBe(
      'notEvaluable',
    );
    expect(
      evaluate(condition('GT', close, number(10)), [
        [close, { type: 'boolean', current: true }],
      ]),
    ).toMatchObject({
      status: 'notEvaluable',
      reason: 'OPERAND_TYPE_MISMATCH',
    });
  });

  it('returns notEvaluable for operators reserved for later evaluator work', () => {
    expect(
      evaluate(condition('HIGHEST_IN_PERIOD', close), [
        [close, { type: 'number', current: 10 }],
      ]),
    ).toMatchObject({
      status: 'notEvaluable',
      reason: 'OPERATOR_NOT_IMPLEMENTED',
    });
  });
});

describe('three-state group evaluation', () => {
  const statuses = ['matched', 'notMatched', 'notEvaluable'] as const;
  const expected: Record<
    ScanGroupOperator,
    readonly (readonly ScanEvaluationStatus[])[]
  > = {
    AND: [
      ['matched', 'notMatched', 'notEvaluable'],
      ['notMatched', 'notMatched', 'notMatched'],
      ['notEvaluable', 'notMatched', 'notEvaluable'],
    ],
    OR: [
      ['matched', 'matched', 'matched'],
      ['matched', 'notMatched', 'notEvaluable'],
      ['matched', 'notEvaluable', 'notEvaluable'],
    ],
  };

  it.each(['AND', 'OR'] as const)(
    'implements the complete %s truth table',
    (operator) => {
      for (const [leftIndex, left] of statuses.entries()) {
        for (const [rightIndex, right] of statuses.entries()) {
          expect(combineScanEvaluationStatuses(operator, [left, right])).toBe(
            expected[operator][leftIndex]![rightIndex],
          );
        }
      }
    },
  );

  it('produces a nested node result tree for explanations', () => {
    const nestedRule: ScanRuleAst = {
      ...rule(),
      root: {
        type: 'group',
        nodeId: 'root',
        operator: 'AND',
        children: [
          condition('GT', number(11), number(10)),
          {
            type: 'group',
            nodeId: 'nested',
            operator: 'OR',
            children: [
              condition('IS_FALSE', { type: 'constantBoolean', value: false }),
            ],
          },
        ],
      },
    };
    expect(evaluateScanRule(nestedRule, new Map())).toEqual({
      status: 'matched',
      root: {
        type: 'group',
        nodeId: 'root',
        operator: 'AND',
        status: 'matched',
        children: [
          {
            type: 'condition',
            nodeId: 'condition-GT',
            operator: 'GT',
            status: 'matched',
          },
          {
            type: 'group',
            nodeId: 'nested',
            operator: 'OR',
            status: 'matched',
            children: [
              {
                type: 'condition',
                nodeId: 'condition-IS_FALSE',
                operator: 'IS_FALSE',
                status: 'matched',
              },
            ],
          },
        ],
      },
    });
  });
});
