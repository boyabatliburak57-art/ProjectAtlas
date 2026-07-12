import type {
  IndicatorInput,
  IndicatorInputField,
  IndicatorOutput,
  IndicatorOutputSpecification,
  IndicatorSeries,
  WarmupRequirement,
} from './contracts.js';
import { IndicatorDomainError } from './errors.js';

export function validateIndicatorInput(
  input: IndicatorInput,
  requiredFields: readonly IndicatorInputField[],
  warmup: WarmupRequirement,
): void {
  validateWarmup(warmup);
  if (
    input.instrumentId.trim().length === 0 ||
    !isValidDate(input.dataCutoffAt)
  ) {
    throw inputInvalid();
  }
  if (input.bars.length < warmup.minimumInputBars) {
    throw new IndicatorDomainError('INDICATOR_INPUT_TOO_SHORT');
  }

  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const bar of input.bars) {
    if (!isValidDate(bar.timestamp)) throw inputInvalid();
    const timestamp = bar.timestamp.getTime();
    if (
      timestamp <= previousTimestamp ||
      timestamp > input.dataCutoffAt.getTime()
    ) {
      throw inputInvalid();
    }
    previousTimestamp = timestamp;

    for (const field of requiredFields) {
      const value = bar[field];
      if (value !== null && !Number.isFinite(value)) throw inputInvalid();
    }
  }
}

export function validateIndicatorOutput(
  output: IndicatorOutput,
  inputLength: number,
  warmup: WarmupRequirement,
  specification: IndicatorOutputSpecification,
): void {
  validateWarmup(warmup);
  if (output.kind !== specification.kind) throw outputInvalid();

  if (output.kind === 'scalar') {
    validateSeries(output.values, inputLength, warmup.firstValidIndex);
    return;
  }
  if (specification.kind !== 'multi') throw outputInvalid();

  const expectedKeys = [...specification.keys].sort();
  const actualKeys = Object.keys(output.outputs).sort();
  if (
    expectedKeys.length === 0 ||
    expectedKeys.length !== actualKeys.length ||
    new Set(expectedKeys).size !== expectedKeys.length ||
    expectedKeys.some((key, index) => key !== actualKeys[index])
  ) {
    throw outputInvalid();
  }
  for (const series of Object.values(output.outputs)) {
    validateSeries(series, inputLength, warmup.firstValidIndex);
  }
}

function validateSeries(
  series: IndicatorSeries,
  inputLength: number,
  firstValidIndex: number,
): void {
  if (series.length !== inputLength) throw outputInvalid();
  for (let index = 0; index < series.length; index += 1) {
    const value = series[index];
    if (index < firstValidIndex && value !== null) throw outputInvalid();
    if (value !== null && !Number.isFinite(value)) throw outputInvalid();
  }
}

function validateWarmup(warmup: WarmupRequirement): void {
  if (
    !Number.isInteger(warmup.minimumInputBars) ||
    !Number.isInteger(warmup.recommendedWarmupBars) ||
    !Number.isInteger(warmup.firstValidIndex) ||
    warmup.minimumInputBars < 1 ||
    warmup.recommendedWarmupBars < warmup.minimumInputBars ||
    warmup.firstValidIndex < 0 ||
    warmup.firstValidIndex >= warmup.minimumInputBars
  ) {
    throw inputInvalid();
  }
}

function isValidDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function inputInvalid(): IndicatorDomainError {
  return new IndicatorDomainError('INDICATOR_INPUT_INVALID');
}

function outputInvalid(): IndicatorDomainError {
  return new IndicatorDomainError('INDICATOR_OUTPUT_INVALID');
}
