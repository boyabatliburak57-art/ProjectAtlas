import {
  assertFiniteOrNull,
  assertPeriod,
  finiteResult,
  type NullableNumber,
  type NumericSeries,
} from './arithmetic.js';

export type StandardDeviationMode = 'population' | 'sample';

export function rollingSum(
  values: NumericSeries,
  period: number,
): readonly NullableNumber[] {
  assertPeriod(period);
  const output: NullableNumber[] = Array.from(
    { length: values.length },
    () => null,
  );
  let sum = 0;
  let contiguousCount = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? null;
    assertFiniteOrNull(value);
    if (value === null) {
      sum = 0;
      contiguousCount = 0;
      continue;
    }

    sum = finiteResult(sum + value);
    contiguousCount += 1;
    if (contiguousCount > period) {
      const outgoing = values[index - period];
      if (outgoing === null || outgoing === undefined) {
        throw new Error('Rolling window invariant was violated');
      }
      sum = finiteResult(sum - outgoing);
      contiguousCount = period;
    }
    if (contiguousCount === period) output[index] = sum;
  }
  return output;
}

export function rollingMean(
  values: NumericSeries,
  period: number,
): readonly NullableNumber[] {
  return rollingSum(values, period).map((value) =>
    value === null ? null : finiteResult(value / period),
  );
}

export function rollingMin(
  values: NumericSeries,
  period: number,
): readonly NullableNumber[] {
  return rollingExtreme(values, period, (candidate, tail) => candidate <= tail);
}

export function rollingMax(
  values: NumericSeries,
  period: number,
): readonly NullableNumber[] {
  return rollingExtreme(values, period, (candidate, tail) => candidate >= tail);
}

export function rollingStandardDeviation(
  values: NumericSeries,
  period: number,
  mode: StandardDeviationMode,
): readonly NullableNumber[] {
  assertPeriod(period, mode === 'sample' ? 2 : 1);
  const output: NullableNumber[] = Array.from(
    { length: values.length },
    () => null,
  );
  let count = 0;
  let mean = 0;
  let m2 = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? null;
    assertFiniteOrNull(value);
    if (value === null) {
      count = 0;
      mean = 0;
      m2 = 0;
      continue;
    }

    if (count === period) {
      const outgoing = values[index - period];
      if (outgoing === null || outgoing === undefined) {
        throw new Error('Rolling window invariant was violated');
      }
      const reducedCount = count - 1;
      if (reducedCount === 0) {
        count = 0;
        mean = 0;
        m2 = 0;
      } else {
        const reducedMean = (count * mean - outgoing) / reducedCount;
        m2 -= (outgoing - mean) * (outgoing - reducedMean);
        mean = reducedMean;
        count = reducedCount;
      }
    }

    count += 1;
    const delta = value - mean;
    mean += delta / count;
    m2 += delta * (value - mean);
    mean = finiteResult(mean);
    m2 = finiteResult(m2);

    if (count === period) {
      const divisor = mode === 'sample' ? period - 1 : period;
      const variance = m2 < 0 && m2 > -Number.EPSILON * 16 ? 0 : m2 / divisor;
      output[index] = variance < 0 ? null : finiteResult(Math.sqrt(variance));
    }
  }
  return output;
}

function rollingExtreme(
  values: NumericSeries,
  period: number,
  removesTail: (candidate: number, tail: number) => boolean,
): readonly NullableNumber[] {
  assertPeriod(period);
  const output: NullableNumber[] = Array.from(
    { length: values.length },
    () => null,
  );
  const deque: number[] = [];
  let head = 0;
  let contiguousStart = 0;

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] ?? null;
    assertFiniteOrNull(value);
    if (value === null) {
      deque.length = 0;
      head = 0;
      contiguousStart = index + 1;
      continue;
    }

    while (head < deque.length && (deque[head] ?? 0) <= index - period)
      head += 1;
    while (deque.length > head) {
      const tailIndex = deque[deque.length - 1];
      if (tailIndex === undefined) break;
      const tail = values[tailIndex];
      if (tail === null || tail === undefined || !removesTail(value, tail))
        break;
      deque.pop();
    }
    deque.push(index);

    if (index - contiguousStart + 1 >= period) {
      const extremeIndex = deque[head];
      if (extremeIndex === undefined) throw new Error('Rolling deque is empty');
      output[index] = values[extremeIndex] ?? null;
    }

    if (head > 1024 && head * 2 > deque.length) {
      deque.splice(0, head);
      head = 0;
    }
  }
  return output;
}
