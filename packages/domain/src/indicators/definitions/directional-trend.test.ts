import { describe, expect, it } from 'vitest';

import type { IndicatorInput } from '../contracts.js';
import { adxDefinition, supertrendDefinition } from './directional-trend.js';

const input: IndicatorInput = {
  instrumentId: '00000000-0000-4000-8000-000000000901',
  timeframe: '1d',
  adjustmentMode: 'raw',
  dataCutoffAt: new Date('2026-07-13T12:00:00.000Z'),
  bars: Array.from({ length: 40 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, index + 1)),
    open: 100 + index,
    high: 102 + index,
    low: 99 + index,
    close: 101 + index,
    volume: 1_000_000,
    isClosed: true,
  })),
};

describe('directional trend indicators', () => {
  it('produces a strong ADX reading for a steady directional series', () => {
    const parameters = adxDefinition.parameterSchema.parse({ period: 14 });
    const output = adxDefinition.calculate(input, parameters);

    expect(() => adxDefinition.outputSchema.parse(output)).not.toThrow();
    expect(output.outputs.adx?.at(-1)).toBeCloseTo(100);
    expect(output.outputs.plusDi?.at(-1)).toBeGreaterThan(0);
    expect(output.outputs.minusDi?.at(-1)).toBe(0);
  });

  it('produces positive Supertrend direction for a steady rising series', () => {
    const parameters = supertrendDefinition.parameterSchema.parse({
      period: 10,
      multiplier: 3,
    });
    const output = supertrendDefinition.calculate(input, parameters);

    expect(() => supertrendDefinition.outputSchema.parse(output)).not.toThrow();
    expect(output.outputs.direction?.at(-1)).toBe(1);
    expect(output.outputs.trend?.at(-1)).toEqual(expect.any(Number));
  });
});
