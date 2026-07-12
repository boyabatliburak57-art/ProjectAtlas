import type { DomainSchema, ScalarIndicatorOutput } from '../contracts.js';
import { IndicatorDomainError } from '../errors.js';

export interface PeriodParameters {
  readonly period: number;
}

export type EmptyParameters = Readonly<Record<never, never>>;

export function createPeriodParameterSchema(
  defaultPeriod: number,
): DomainSchema<PeriodParameters> {
  return {
    parse(value) {
      if (!isRecord(value)) throw parametersInvalid();
      const keys = Object.keys(value);
      if (keys.some((key) => key !== 'period')) throw parametersInvalid();
      const period = value.period ?? defaultPeriod;
      if (
        typeof period !== 'number' ||
        !Number.isInteger(period) ||
        period < 2 ||
        period > 500
      ) {
        throw parametersInvalid();
      }
      return { period };
    },
  };
}

export const emptyParameterSchema: DomainSchema<EmptyParameters> = {
  parse(value) {
    if (!isRecord(value) || Object.keys(value).length !== 0) {
      throw parametersInvalid();
    }
    return {};
  },
};

export const scalarOutputSchema: DomainSchema<ScalarIndicatorOutput> = {
  parse(value) {
    if (
      !isRecord(value) ||
      value.kind !== 'scalar' ||
      !Array.isArray(value.values) ||
      value.values.some(
        (item) =>
          item !== null && (typeof item !== 'number' || !Number.isFinite(item)),
      )
    ) {
      throw new IndicatorDomainError('INDICATOR_OUTPUT_INVALID');
    }
    return value as unknown as ScalarIndicatorOutput;
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function parametersInvalid(): IndicatorDomainError {
  return new IndicatorDomainError('INDICATOR_PARAMETERS_INVALID');
}
