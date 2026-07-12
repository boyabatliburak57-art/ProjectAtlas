import type {
  IndicatorInput,
  IndicatorInputField,
  ScalarIndicatorOutput,
  WarmupRequirement,
} from '../contracts.js';
import {
  assertFiniteOrNull,
  finiteResult,
  type NumericSeries,
} from '../math/arithmetic.js';

export function fieldSeries(
  input: IndicatorInput,
  field: IndicatorInputField,
): NumericSeries {
  return input.bars.map((bar) => bar[field]);
}

export function scalar(values: NumericSeries): ScalarIndicatorOutput {
  return { kind: 'scalar', values };
}

export function periodWarmup(period: number): WarmupRequirement {
  return {
    minimumInputBars: period,
    recommendedWarmupBars: period,
    firstValidIndex: period - 1,
  };
}

export function laggedWarmup(period: number): WarmupRequirement {
  return {
    minimumInputBars: period + 1,
    recommendedWarmupBars: period + 1,
    firstValidIndex: period,
  };
}

export function weightedMovingAverage(
  values: NumericSeries,
  period: number,
): NumericSeries {
  const output: (number | null)[] = Array.from(
    { length: values.length },
    () => null,
  );
  const divisor = (period * (period + 1)) / 2;
  let sum = 0;
  let weightedSum = 0;
  let count = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? null;
    assertFiniteOrNull(value);
    if (value === null) {
      sum = 0;
      weightedSum = 0;
      count = 0;
      continue;
    }

    if (count < period) {
      count += 1;
      sum = finiteResult(sum + value);
      weightedSum = finiteResult(weightedSum + count * value);
    } else {
      const outgoing = values[index - period];
      if (outgoing === null || outgoing === undefined) {
        throw new Error('WMA window invariant was violated');
      }
      weightedSum = finiteResult(weightedSum - sum + period * value);
      sum = finiteResult(sum - outgoing + value);
    }
    if (count === period) output[index] = finiteResult(weightedSum / divisor);
  }
  return output;
}
