import {
  assertFiniteOrNull,
  assertPeriod,
  finiteResult,
  type NullableNumber,
  type NumericSeries,
} from './arithmetic.js';

export function exponentialMovingAverage(
  values: NumericSeries,
  period: number,
): readonly NullableNumber[] {
  assertPeriod(period);
  return seededSmoothing(values, period, 2 / (period + 1));
}

export function wilderSmoothing(
  values: NumericSeries,
  period: number,
): readonly NullableNumber[] {
  assertPeriod(period);
  return seededSmoothing(values, period, 1 / period);
}

function seededSmoothing(
  values: NumericSeries,
  period: number,
  alpha: number,
): readonly NullableNumber[] {
  const output: NullableNumber[] = Array.from(
    { length: values.length },
    () => null,
  );
  let seedSum = 0;
  let seedCount = 0;
  let previous: number | null = null;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? null;
    assertFiniteOrNull(value);
    if (value === null) {
      seedSum = 0;
      seedCount = 0;
      previous = null;
      continue;
    }

    if (previous === null) {
      seedSum = finiteResult(seedSum + value);
      seedCount += 1;
      if (seedCount < period) continue;
      previous = finiteResult(seedSum / period);
    } else {
      previous = finiteResult(previous + alpha * (value - previous));
    }
    output[index] = previous;
  }
  return output;
}
