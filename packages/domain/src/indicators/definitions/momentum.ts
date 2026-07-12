import type {
  IndicatorDefinition,
  ScalarIndicatorOutput,
} from '../contracts.js';
import { finiteResult, safeDivide, wilderSmoothing } from '../math/index.js';
import { fieldSeries, laggedWarmup, scalar } from './helpers.js';
import {
  createPeriodParameterSchema,
  type PeriodParameters,
  scalarOutputSchema,
} from './schemas.js';

export const rocDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  code: 'ROC',
  version: 1,
  displayName: 'Rate of Change',
  category: 'momentum',
  requiredInputFields: ['close'],
  parameterSchema: createPeriodParameterSchema(12),
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#fiyat-ve-ortalamalar',
  getWarmup: ({ period }) => laggedWarmup(period),
  calculate(input, { period }) {
    const close = fieldSeries(input, 'close');
    return scalar(
      close.map((current, index) => {
        if (index < period || current === null) return null;
        const previous = close[index - period] ?? null;
        const ratio = safeDivide(current - (previous ?? current), previous);
        return ratio === null ? null : finiteResult(ratio * 100);
      }),
    );
  },
};

export const momentumDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  ...rocDefinition,
  code: 'MOMENTUM',
  displayName: 'Momentum',
  calculate(input, { period }) {
    const close = fieldSeries(input, 'close');
    return scalar(
      close.map((current, index) => {
        const previous =
          index < period ? null : (close[index - period] ?? null);
        return current === null || previous === null
          ? null
          : finiteResult(current - previous);
      }),
    );
  },
};

export const rsiDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  code: 'RSI',
  version: 1,
  displayName: 'Relative Strength Index',
  category: 'momentum',
  requiredInputFields: ['close'],
  parameterSchema: createPeriodParameterSchema(14),
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#momentum',
  getWarmup: ({ period }) => laggedWarmup(period),
  calculate(input, { period }) {
    const close = fieldSeries(input, 'close');
    const gains = close.map((current, index) => {
      const previous = index === 0 ? null : (close[index - 1] ?? null);
      return current === null || previous === null
        ? null
        : Math.max(current - previous, 0);
    });
    const losses = close.map((current, index) => {
      const previous = index === 0 ? null : (close[index - 1] ?? null);
      return current === null || previous === null
        ? null
        : Math.max(previous - current, 0);
    });
    const averageGains = wilderSmoothing(gains, period);
    const averageLosses = wilderSmoothing(losses, period);
    return scalar(
      averageGains.map((gain, index) => {
        const loss = averageLosses[index] ?? null;
        if (gain === null || loss === null) return null;
        if (gain === 0 && loss === 0) return 50;
        if (loss === 0) return 100;
        const relativeStrength = safeDivide(gain, loss);
        return relativeStrength === null
          ? null
          : finiteResult(100 - 100 / (1 + relativeStrength));
      }),
    );
  },
};
