import type {
  IndicatorDefinition,
  ScalarIndicatorOutput,
} from '../contracts.js';
import { finiteResult, rollingMean, safeDivide } from '../math/index.js';
import { fieldSeries, periodWarmup, scalar } from './helpers.js';
import {
  createPeriodParameterSchema,
  emptyParameterSchema,
  type EmptyParameters,
  type PeriodParameters,
  scalarOutputSchema,
} from './schemas.js';

export const obvDefinition: IndicatorDefinition<
  EmptyParameters,
  ScalarIndicatorOutput
> = {
  code: 'OBV',
  version: 1,
  displayName: 'On-Balance Volume',
  category: 'volume',
  requiredInputFields: ['close', 'volume'],
  parameterSchema: emptyParameterSchema,
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#hacim',
  getWarmup: () => ({
    minimumInputBars: 1,
    recommendedWarmupBars: 1,
    firstValidIndex: 0,
  }),
  calculate(input) {
    const output: (number | null)[] = [];
    let previousClose: number | null = null;
    let previousObv = 0;
    for (const bar of input.bars) {
      if (bar.close === null || bar.volume === null || bar.volume < 0) {
        output.push(null);
        previousClose = null;
        previousObv = 0;
        continue;
      }
      if (previousClose === null) {
        output.push(0);
      } else if (bar.close > previousClose) {
        previousObv = finiteResult(previousObv + bar.volume);
        output.push(previousObv);
      } else if (bar.close < previousClose) {
        previousObv = finiteResult(previousObv - bar.volume);
        output.push(previousObv);
      } else {
        output.push(previousObv);
      }
      previousClose = bar.close;
    }
    return scalar(output);
  },
};

export const volumeSmaDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  code: 'VOLUME_SMA',
  version: 1,
  displayName: 'Volume Simple Moving Average',
  category: 'volume',
  requiredInputFields: ['volume'],
  parameterSchema: createPeriodParameterSchema(20),
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#hacim',
  getWarmup: ({ period }) => periodWarmup(period),
  calculate: (input, { period }) =>
    scalar(rollingMean(fieldSeries(input, 'volume'), period)),
};

export const relativeVolumeDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  ...volumeSmaDefinition,
  code: 'RELATIVE_VOLUME',
  displayName: 'Relative Volume',
  calculate(input, { period }) {
    const volume = fieldSeries(input, 'volume');
    const average = rollingMean(volume, period);
    return scalar(
      volume.map((current, index) =>
        safeDivide(current, average[index] ?? null),
      ),
    );
  },
};
