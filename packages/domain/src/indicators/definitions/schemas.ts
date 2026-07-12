import type {
  DomainSchema,
  MultiIndicatorOutput,
  ScalarIndicatorOutput,
} from '../contracts.js';
import { IndicatorDomainError } from '../errors.js';

export interface PeriodParameters {
  readonly period: number;
}

export interface MacdParameters {
  readonly fastPeriod: number;
  readonly slowPeriod: number;
  readonly signalPeriod: number;
}

export interface StochasticParameters {
  readonly kPeriod: number;
  readonly dPeriod: number;
}

export interface StochasticRsiParameters extends StochasticParameters {
  readonly rsiPeriod: number;
}

export interface ChannelParameters extends PeriodParameters {
  readonly multiplier: number;
}

export interface KeltnerParameters {
  readonly emaPeriod: number;
  readonly atrPeriod: number;
  readonly multiplier: number;
}

export type EmptyParameters = Readonly<Record<never, never>>;

export function createPeriodParameterSchema(
  defaultPeriod: number,
): DomainSchema<PeriodParameters> {
  return {
    metadata: periodMetadata(defaultPeriod),
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
  metadata: { type: 'object', properties: {}, additionalProperties: false },
  parse(value) {
    if (!isRecord(value) || Object.keys(value).length !== 0) {
      throw parametersInvalid();
    }
    return {};
  },
};

export const scalarOutputSchema: DomainSchema<ScalarIndicatorOutput> = {
  metadata: { type: 'scalar-series' },
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

export function createMultiOutputSchema(
  expectedKeys: readonly string[],
): DomainSchema<MultiIndicatorOutput> {
  return {
    metadata: { type: 'multi-series', keys: [...expectedKeys] },
    parse(value) {
      if (
        !isRecord(value) ||
        value.kind !== 'multi' ||
        !isRecord(value.outputs)
      ) {
        throw outputInvalid();
      }
      const actualKeys = Object.keys(value.outputs).sort();
      const sortedExpected = [...expectedKeys].sort();
      if (
        actualKeys.length !== sortedExpected.length ||
        actualKeys.some((key, index) => key !== sortedExpected[index]) ||
        Object.values(value.outputs).some(
          (series) =>
            !Array.isArray(series) ||
            series.some(
              (item) =>
                item !== null &&
                (typeof item !== 'number' || !Number.isFinite(item)),
            ),
        )
      ) {
        throw outputInvalid();
      }
      return value as unknown as MultiIndicatorOutput;
    },
  };
}

export function createMacdParameterSchema(): DomainSchema<MacdParameters> {
  return {
    metadata: {
      type: 'object',
      properties: {
        fastPeriod: integerMetadata(12),
        slowPeriod: integerMetadata(26),
        signalPeriod: integerMetadata(9),
      },
      constraints: ['fastPeriod < slowPeriod'],
      additionalProperties: false,
    },
    parse(value) {
      const record = parameterRecord(value, [
        'fastPeriod',
        'slowPeriod',
        'signalPeriod',
      ]);
      const fastPeriod = integerParameter(record, 'fastPeriod', 12);
      const slowPeriod = integerParameter(record, 'slowPeriod', 26);
      const signalPeriod = integerParameter(record, 'signalPeriod', 9);
      if (fastPeriod >= slowPeriod) throw parametersInvalid();
      return { fastPeriod, slowPeriod, signalPeriod };
    },
  };
}

export function createStochasticParameterSchema(): DomainSchema<StochasticParameters> {
  return {
    metadata: {
      type: 'object',
      properties: {
        kPeriod: integerMetadata(14),
        dPeriod: integerMetadata(3),
      },
      additionalProperties: false,
    },
    parse(value) {
      const record = parameterRecord(value, ['kPeriod', 'dPeriod']);
      return {
        kPeriod: integerParameter(record, 'kPeriod', 14),
        dPeriod: integerParameter(record, 'dPeriod', 3),
      };
    },
  };
}

export function createStochasticRsiParameterSchema(): DomainSchema<StochasticRsiParameters> {
  return {
    metadata: {
      type: 'object',
      properties: {
        rsiPeriod: integerMetadata(14),
        kPeriod: integerMetadata(14),
        dPeriod: integerMetadata(3),
      },
      additionalProperties: false,
    },
    parse(value) {
      const record = parameterRecord(value, [
        'rsiPeriod',
        'kPeriod',
        'dPeriod',
      ]);
      return {
        rsiPeriod: integerParameter(record, 'rsiPeriod', 14),
        kPeriod: integerParameter(record, 'kPeriod', 14),
        dPeriod: integerParameter(record, 'dPeriod', 3),
      };
    },
  };
}

export function createChannelParameterSchema(
  defaultPeriod: number,
  defaultMultiplier: number,
): DomainSchema<ChannelParameters> {
  return {
    metadata: {
      type: 'object',
      properties: {
        period: integerMetadata(defaultPeriod),
        multiplier: positiveMetadata(defaultMultiplier),
      },
      additionalProperties: false,
    },
    parse(value) {
      const record = parameterRecord(value, ['period', 'multiplier']);
      return {
        period: integerParameter(record, 'period', defaultPeriod),
        multiplier: positiveParameter(record, 'multiplier', defaultMultiplier),
      };
    },
  };
}

export function createKeltnerParameterSchema(): DomainSchema<KeltnerParameters> {
  return {
    metadata: {
      type: 'object',
      properties: {
        emaPeriod: integerMetadata(20),
        atrPeriod: integerMetadata(10),
        multiplier: positiveMetadata(2),
      },
      additionalProperties: false,
    },
    parse(value) {
      const record = parameterRecord(value, [
        'emaPeriod',
        'atrPeriod',
        'multiplier',
      ]);
      return {
        emaPeriod: integerParameter(record, 'emaPeriod', 20),
        atrPeriod: integerParameter(record, 'atrPeriod', 10),
        multiplier: positiveParameter(record, 'multiplier', 2),
      };
    },
  };
}

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

function outputInvalid(): IndicatorDomainError {
  return new IndicatorDomainError('INDICATOR_OUTPUT_INVALID');
}

function parameterRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (!isRecord(value)) throw parametersInvalid();
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw parametersInvalid();
  }
  return value;
}

function integerParameter(
  record: Record<string, unknown>,
  key: string,
  defaultValue: number,
): number {
  const value = record[key] ?? defaultValue;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 2 ||
    value > 500
  ) {
    throw parametersInvalid();
  }
  return value;
}

function positiveParameter(
  record: Record<string, unknown>,
  key: string,
  defaultValue: number,
): number {
  const value = record[key] ?? defaultValue;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw parametersInvalid();
  }
  return value;
}

function periodMetadata(
  defaultValue: number,
): Readonly<Record<string, unknown>> {
  return {
    type: 'object',
    properties: { period: integerMetadata(defaultValue) },
    additionalProperties: false,
  };
}

function integerMetadata(
  defaultValue: number,
): Readonly<Record<string, unknown>> {
  return { type: 'integer', minimum: 2, maximum: 500, default: defaultValue };
}

function positiveMetadata(
  defaultValue: number,
): Readonly<Record<string, unknown>> {
  return { type: 'number', exclusiveMinimum: 0, default: defaultValue };
}
