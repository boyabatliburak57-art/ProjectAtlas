import {
  assertFiniteOrNull,
  finiteResult,
  type NullableNumber,
} from './arithmetic.js';

export function trueRange(
  high: NullableNumber,
  low: NullableNumber,
  previousClose: NullableNumber,
): NullableNumber {
  assertFiniteOrNull(high);
  assertFiniteOrNull(low);
  assertFiniteOrNull(previousClose);
  if (high === null || low === null) return null;
  if (high < low) return null;

  const intrabarRange = high - low;
  if (previousClose === null) return finiteResult(intrabarRange);
  return finiteResult(
    Math.max(
      intrabarRange,
      Math.abs(high - previousClose),
      Math.abs(low - previousClose),
    ),
  );
}

export function typicalPrice(
  high: NullableNumber,
  low: NullableNumber,
  close: NullableNumber,
): NullableNumber {
  assertFiniteOrNull(high);
  assertFiniteOrNull(low);
  assertFiniteOrNull(close);
  if (high === null || low === null || close === null) return null;
  if (high < low) return null;
  return finiteResult((high + low + close) / 3);
}
