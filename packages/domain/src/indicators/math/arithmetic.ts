import { IndicatorDomainError } from '../errors.js';

export type NullableNumber = number | null;
export type NumericSeries = readonly NullableNumber[];

export function safeDivide(
  numerator: NullableNumber,
  denominator: NullableNumber,
): NullableNumber {
  assertFiniteOrNull(numerator);
  assertFiniteOrNull(denominator);
  if (numerator === null || denominator === null || denominator === 0) {
    return null;
  }
  return finiteResult(numerator / denominator);
}

export function assertPeriod(period: number, minimum = 1): void {
  if (!Number.isInteger(period) || period < minimum) {
    throw new IndicatorDomainError('INDICATOR_PARAMETERS_INVALID');
  }
}

export function assertFiniteOrNull(value: NullableNumber): void {
  if (value !== null && !Number.isFinite(value)) {
    throw new IndicatorDomainError('INDICATOR_INPUT_INVALID');
  }
}

export function finiteResult(value: number): number {
  if (!Number.isFinite(value)) {
    throw new IndicatorDomainError('INDICATOR_CALCULATION_FAILED');
  }
  return value;
}
