import type {
  IndicatorDefinition,
  ScalarIndicatorOutput,
} from '../contracts.js';
import { exponentialMovingAverage, rollingMean } from '../math/index.js';
import {
  fieldSeries,
  periodWarmup,
  scalar,
  weightedMovingAverage,
} from './helpers.js';
import {
  createPeriodParameterSchema,
  type PeriodParameters,
  scalarOutputSchema,
} from './schemas.js';

export const smaDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  code: 'SMA',
  version: 1,
  displayName: 'Simple Moving Average',
  category: 'price',
  requiredInputFields: ['close'],
  parameterSchema: createPeriodParameterSchema(14),
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#fiyat-ve-ortalamalar',
  getWarmup: ({ period }) => periodWarmup(period),
  calculate: (input, { period }) =>
    scalar(rollingMean(fieldSeries(input, 'close'), period)),
};

export const emaDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  ...smaDefinition,
  code: 'EMA',
  displayName: 'Exponential Moving Average',
  calculate: (input, { period }) =>
    scalar(exponentialMovingAverage(fieldSeries(input, 'close'), period)),
};

export const wmaDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  ...smaDefinition,
  code: 'WMA',
  displayName: 'Weighted Moving Average',
  calculate: (input, { period }) =>
    scalar(weightedMovingAverage(fieldSeries(input, 'close'), period)),
};
