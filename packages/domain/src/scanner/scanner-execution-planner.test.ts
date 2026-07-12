import { describe, expect, it, vi } from 'vitest';

import { createCoreIndicatorRegistry } from '../indicators/registry/indicator-registry.js';
import type {
  IndicatorOperand,
  ScanConditionNode,
  ScanOperator,
  ScanRuleAst,
  ScanRuleNode,
} from './ast/contracts.js';
import type {
  ScanEntitlementPort,
  ScanPlannerDependencies,
} from './planning/contracts.js';
import { ScanPlanningError } from './planning/errors.js';
import { planScanExecution } from './planning/execution-planner.js';
import { serializeScanExecutionPlan } from './planning/plan-serialization.js';

function indicator(
  code: 'SMA' | 'RSI' = 'SMA',
  overrides: Partial<IndicatorOperand> = {},
): IndicatorOperand {
  return {
    type: 'indicator',
    code,
    version: 1,
    timeframe: '1d',
    parameters: { period: 14 },
    ...overrides,
  };
}

function condition(
  nodeId: string,
  left: IndicatorOperand,
  operator: ScanOperator = 'GT',
  options?: { readonly period?: number; readonly percent?: number },
): ScanConditionNode {
  return {
    type: 'condition',
    nodeId,
    operator,
    left,
    ...(operator === 'IS_TRUE' ||
    operator === 'IS_FALSE' ||
    operator === 'HIGHEST_IN_PERIOD' ||
    operator === 'LOWEST_IN_PERIOD' ||
    operator === 'INCREASED_BY_PERCENT' ||
    operator === 'DECREASED_BY_PERCENT'
      ? {}
      : { right: { type: 'constantNumber', value: 50 } as const }),
    ...(options === undefined ? {} : { options }),
  };
}

function rule(...children: readonly ScanRuleNode[]): ScanRuleAst {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: ['XU100'],
      sectorIds: [],
    },
    root: { type: 'group', nodeId: 'root', operator: 'AND', children },
  };
}

function dependencies(
  entitlement?: ScanEntitlementPort,
  maximumComplexityScore = 100_000,
  asynchronousComplexityThreshold = 10_000,
): ScanPlannerDependencies {
  return {
    indicatorRegistry: createCoreIndicatorRegistry(),
    entitlement: entitlement ?? { check: () => ({ allowed: true }) },
    limits: { maximumComplexityScore, asynchronousComplexityThreshold },
  };
}

function plan(
  scanRule: unknown,
  deps = dependencies(),
  universeInstrumentCount = 100,
  requestedHistoryBars = 1,
) {
  return planScanExecution(
    { rule: scanRule, universeInstrumentCount, requestedHistoryBars },
    deps,
  );
}

describe('scanner execution planner', () => {
  it('deduplicates identical calculations while merging requested outputs', () => {
    const base = indicator('SMA');
    const executionPlan = plan(
      rule(
        condition('first', { ...base, output: 'value' }),
        condition('second', { ...base, output: 'signal' }),
        condition('third', base),
      ),
    );

    expect(executionPlan.indicatorRequests).toHaveLength(1);
    expect(executionPlan.indicatorRequests[0]).toMatchObject({
      code: 'SMA',
      version: 1,
      timeframe: '1d',
      requestedOutputs: ['signal', 'value'],
      requiredInputFields: ['close'],
    });
  });

  it('keeps parameter and timeframe variants as separate requests', () => {
    const executionPlan = plan(
      rule(
        condition('daily', indicator('SMA')),
        condition('weekly', indicator('SMA', { timeframe: '1w' })),
        condition('period', indicator('SMA', { parameters: { period: 20 } })),
      ),
    );

    expect(executionPlan.indicatorRequests).toHaveLength(3);
    expect(executionPlan.timeframes).toEqual(['1d', '1w']);
  });

  it('aggregates indicator warm-up, fields and requested history by timeframe', () => {
    const executionPlan = plan(
      rule(
        condition('sma', indicator('SMA')),
        condition('rsi', indicator('RSI')),
        {
          type: 'condition',
          nodeId: 'volume',
          operator: 'GT',
          left: { type: 'volumeField', field: 'volume', timeframe: '1d' },
          right: { type: 'constantNumber', value: 100 },
        },
      ),
      dependencies(),
      100,
      30,
    );

    expect(executionPlan.dataRequirements).toEqual([
      {
        timeframe: '1d',
        fields: ['close', 'volume'],
        requestedHistoryBars: 30,
        warmupBars: 15,
        operatorHistoryBars: 0,
        requiredBars: 44,
      },
    ]);
  });

  it('adds one previous bar for cross operands', () => {
    const executionPlan = plan(
      rule(condition('cross', indicator('SMA'), 'CROSSES_ABOVE')),
    );

    expect(executionPlan.dataRequirements[0]).toMatchObject({
      warmupBars: 14,
      operatorHistoryBars: 1,
      requiredBars: 15,
    });
  });

  it('uses the period window as operator history requirement', () => {
    const executionPlan = plan(
      rule(
        condition('highest', indicator('SMA'), 'HIGHEST_IN_PERIOD', {
          period: 20,
        }),
      ),
    );

    expect(executionPlan.dataRequirements[0]).toMatchObject({
      operatorHistoryBars: 19,
      requiredBars: 33,
    });
  });

  it('produces the same canonical plan for semantically identical ASTs', () => {
    const first = rule(
      condition('sma', indicator('SMA')),
      condition('rsi', indicator('RSI')),
    );
    const second = rule(...[...first.root.children].reverse());

    expect(serializeScanExecutionPlan(plan(first))).toBe(
      serializeScanExecutionPlan(plan(second)),
    );
  });

  it('calculates an auditable score and selects sync or async deterministically', () => {
    const syncPlan = plan(rule(condition('sma', indicator('SMA'))));
    const asyncPlan = plan(
      rule(condition('sma', indicator('SMA'))),
      dependencies(undefined, 100_000, syncPlan.complexity.score - 1),
    );

    expect(syncPlan.complexity).toEqual({
      score: 1005,
      instrumentCount: 100,
      timeframeCount: 1,
      uniqueIndicatorCount: 1,
      warmupBars: 14,
      nodeCount: 2,
      groupDepth: 1,
      operatorHistoryBars: 0,
      requestedHistoryBars: 1,
    });
    expect(syncPlan.executionMode).toBe('sync');
    expect(asyncPlan.executionMode).toBe('async');
  });

  it('enforces the complexity limit before entitlement evaluation', () => {
    const entitlement = { check: vi.fn(() => ({ allowed: true })) };

    expect(() =>
      plan(
        rule(condition('sma', indicator('SMA'))),
        dependencies(entitlement, 10, 10),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ScanPlanningError>>({
        code: 'SCAN_TOO_COMPLEX',
      }),
    );
    expect(entitlement.check).not.toHaveBeenCalled();
  });

  it('passes the bounded plan summary to the entitlement port', () => {
    const check = vi.fn(() => ({ allowed: true }));
    const executionPlan = plan(
      rule(condition('sma', indicator('SMA'))),
      dependencies({ check }),
    );

    expect(check).toHaveBeenCalledWith({
      universeInstrumentCount: 100,
      uniqueIndicatorCount: 1,
      timeframes: ['1d'],
      complexityScore: executionPlan.complexity.score,
      executionMode: 'sync',
    });
  });

  it('reports entitlement violations with a distinct domain error', () => {
    expect(() =>
      plan(
        rule(condition('sma', indicator('SMA'))),
        dependencies({
          check: () => ({ allowed: false, reasonCode: 'PLAN_NOT_INCLUDED' }),
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ScanPlanningError>>({
        code: 'SCAN_ENTITLEMENT_VIOLATION',
        details: { reasonCode: 'PLAN_NOT_INCLUDED' },
      }),
    );
  });

  it('rejects invalid rules and an empty resolved universe', () => {
    expect(() => plan({ version: 99 })).toThrowError(
      expect.objectContaining<Partial<ScanPlanningError>>({
        code: 'SCAN_RULE_INVALID',
      }),
    );
    expect(() =>
      plan(rule(condition('sma', indicator('SMA'))), dependencies(), 0),
    ).toThrowError(
      expect.objectContaining<Partial<ScanPlanningError>>({
        code: 'SCAN_UNIVERSE_EMPTY',
      }),
    );
  });

  it('does not mutate the source rule', () => {
    const source = rule(
      condition('z-condition', indicator('RSI')),
      condition('a-condition', indicator('SMA')),
    );
    const before = JSON.stringify(source);

    plan(source);

    expect(JSON.stringify(source)).toBe(before);
  });
});
