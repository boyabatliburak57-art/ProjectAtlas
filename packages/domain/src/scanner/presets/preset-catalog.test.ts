import { describe, expect, it } from 'vitest';

import { createCoreIndicatorRegistry } from '../../indicators/registry/indicator-registry.js';
import type { IndicatorOperand, ScanRuleNode } from '../ast/contracts.js';
import { planScanExecution } from '../planning/execution-planner.js';
import { validateScanRule } from '../validation/scan-rule-validator.js';
import {
  PRESET_CATEGORY_DEFINITIONS,
  PRESET_SCAN_DEFINITIONS,
} from './preset-catalog.js';

describe('preset scan seed catalog', () => {
  const registry = createCoreIndicatorRegistry();

  it('contains the DOC-012 categories and first ten versioned presets', () => {
    expect(PRESET_CATEGORY_DEFINITIONS.map(({ name }) => name)).toEqual([
      'Trend',
      'Momentum',
      'Volume',
      'Volatility',
      'Moving Average',
      'Breakout',
      'Overbought/Oversold',
      'Multi-Timeframe',
    ]);
    expect(PRESET_SCAN_DEFINITIONS.map(({ name }) => name)).toEqual([
      'RSI Oversold',
      'RSI Recovery',
      'EMA 20/50 Bullish Cross',
      'MACD Bullish Cross',
      'Price Above SMA 200',
      'Relative Volume Spike',
      'Bollinger Lower Band Recovery',
      'Donchian 20 Breakout',
      'Supertrend Positive',
      'ADX Trend Strength',
    ]);
    expect(
      PRESET_SCAN_DEFINITIONS.every(({ revision }) => revision === 1),
    ).toBe(true);
  });

  it.each(PRESET_SCAN_DEFINITIONS)(
    'validates $code AST, indicator versions and execution plan',
    (preset) => {
      const validation = validateScanRule(preset.rule);
      expect(validation).toMatchObject({ valid: true, errors: [] });

      for (const indicator of indicators(preset.rule.root)) {
        const resolved = registry.resolve(indicator.code, indicator.version);
        expect(resolved.catalog.status).toBe('enabled');
        expect(() =>
          resolved.parseParameters(indicator.parameters),
        ).not.toThrow();
      }

      const plan = planScanExecution(
        {
          rule: preset.rule,
          universeInstrumentCount: 500,
          requestedHistoryBars: 1,
        },
        {
          indicatorRegistry: registry,
          entitlement: { check: () => ({ allowed: true }) },
          limits: {
            maximumComplexityScore: 1_000_000,
            asynchronousComplexityThreshold: 100_000,
          },
        },
      );
      expect(plan.normalizedRule.version).toBe(1);
      expect(plan.indicatorRequests.length).toBeGreaterThan(0);
      expect(plan.dataRequirements).toEqual([
        expect.objectContaining({ timeframe: '1d' }),
      ]);
    },
  );
});

function indicators(node: ScanRuleNode): readonly IndicatorOperand[] {
  if (node.type === 'group') return node.children.flatMap(indicators);
  return [node.left, node.right, node.upperBound].filter(
    (operand): operand is IndicatorOperand => operand?.type === 'indicator',
  );
}
