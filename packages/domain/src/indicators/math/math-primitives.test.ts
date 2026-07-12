import { describe, expect, it } from 'vitest';

import { IndicatorDomainError } from '../errors.js';
import { safeDivide } from './arithmetic.js';
import { trueRange, typicalPrice } from './price.js';
import {
  rollingMax,
  rollingMean,
  rollingMin,
  rollingStandardDeviation,
  rollingSum,
} from './rolling.js';
import { exponentialMovingAverage, wilderSmoothing } from './smoothing.js';

function expectIndicatorError(
  action: () => unknown,
  code: IndicatorDomainError['code'],
): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<IndicatorDomainError>>({ code }),
  );
}

function expectFiniteOrNull(values: readonly (number | null)[]): void {
  expect(
    values.every((value) => value === null || Number.isFinite(value)),
  ).toBe(true);
}

describe('rolling primitives', () => {
  it('aligns sum and mean warm-up without mutating input', () => {
    const values = Object.freeze([1, 2, 3, 4]);

    expect(rollingSum(values, 3)).toEqual([null, null, 6, 9]);
    expect(rollingMean(values, 3)).toEqual([null, null, 2, 3]);
    expect(values).toEqual([1, 2, 3, 4]);
  });

  it('computes rolling min/max with a null reset', () => {
    const values = [3, 1, 2, 5, null, 4, 2, 6] as const;

    expect(rollingMin(values, 3)).toEqual([
      null,
      null,
      1,
      1,
      null,
      null,
      null,
      2,
    ]);
    expect(rollingMax(values, 3)).toEqual([
      null,
      null,
      3,
      5,
      null,
      null,
      null,
      6,
    ]);
  });

  it('makes population/sample standard deviation explicit', () => {
    const population = rollingStandardDeviation([1, 2, 3, 4], 3, 'population');
    const sample = rollingStandardDeviation([1, 2, 3, 4], 3, 'sample');

    expect(population[0]).toBeNull();
    expect(population[1]).toBeNull();
    expect(population[2]).toBeCloseTo(Math.sqrt(2 / 3), 12);
    expect(population[3]).toBeCloseTo(Math.sqrt(2 / 3), 12);
    expect(sample[2]).toBeCloseTo(1, 12);
    expect(sample[3]).toBeCloseTo(1, 12);
  });

  it('requires a full contiguous window again after missing data', () => {
    const values = [1, 2, null, 3, 4, 5] as const;

    expect(rollingSum(values, 3)).toEqual([null, null, null, null, null, 12]);
    expect(rollingStandardDeviation(values, 3, 'population')).toEqual([
      null,
      null,
      null,
      null,
      null,
      expect.closeTo(Math.sqrt(2 / 3), 12),
    ]);
  });

  it('rejects invalid periods and non-finite input', () => {
    expectIndicatorError(
      () => rollingMean([1, 2], 0),
      'INDICATOR_PARAMETERS_INVALID',
    );
    expectIndicatorError(
      () => rollingStandardDeviation([1], 1, 'sample'),
      'INDICATOR_PARAMETERS_INVALID',
    );
    expectIndicatorError(
      () => rollingMax([1, Number.NaN], 2),
      'INDICATOR_INPUT_INVALID',
    );
  });

  it('handles a large series with finite, aligned output', () => {
    const values = Array.from({ length: 20_000 }, (_, index) => index % 101);
    const output = rollingMax(values, 250);

    expect(output).toHaveLength(values.length);
    expect(output.slice(0, 249).every((value) => value === null)).toBe(true);
    expectFiniteOrNull(output);
  });
});

describe('seeded smoothing primitives', () => {
  it('uses an SMA seed for EMA at period minus one', () => {
    const values = Object.freeze([1, 2, 3, 4, 5]);

    expect(exponentialMovingAverage(values, 3)).toEqual([null, null, 2, 3, 4]);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses an SMA seed followed by Wilder recurrence', () => {
    const output = wilderSmoothing([1, 2, 3, 4, 5], 3);

    expect(output[0]).toBeNull();
    expect(output[1]).toBeNull();
    expect(output[2]).toBe(2);
    expect(output[3]).toBeCloseTo(8 / 3, 12);
    expect(output[4]).toBeCloseTo(31 / 9, 12);
  });

  it('resets seed state after null and never emits non-finite output', () => {
    const ema = exponentialMovingAverage([1, 2, null, 3, 4, 5], 3);
    const wilder = wilderSmoothing([1, 2, null, 3, 4, 5], 3);

    expect(ema).toEqual([null, null, null, null, null, 4]);
    expect(wilder).toEqual([null, null, null, null, null, 4]);
    expectFiniteOrNull(ema);
    expectFiniteOrNull(wilder);
  });
});

describe('price and arithmetic primitives', () => {
  it('performs safe division without NaN or Infinity', () => {
    expect(safeDivide(10, 2)).toBe(5);
    expect(safeDivide(10, 0)).toBeNull();
    expect(safeDivide(null, 2)).toBeNull();
    expect(safeDivide(0, 0)).toBeNull();
    expectIndicatorError(
      () => safeDivide(Number.POSITIVE_INFINITY, 2),
      'INDICATOR_INPUT_INVALID',
    );
  });

  it('computes true range with and without previous close', () => {
    expect(trueRange(12, 9, null)).toBe(3);
    expect(trueRange(12, 9, 8)).toBe(4);
    expect(trueRange(12, 9, 13)).toBe(4);
    expect(trueRange(null, 9, 8)).toBeNull();
    expect(trueRange(8, 9, 8)).toBeNull();
  });

  it('computes typical price and propagates missing data', () => {
    expect(typicalPrice(12, 9, 10.5)).toBe(10.5);
    expect(typicalPrice(12, null, 10)).toBeNull();
    expectIndicatorError(
      () => typicalPrice(12, 9, Number.NaN),
      'INDICATOR_INPUT_INVALID',
    );
  });
});
