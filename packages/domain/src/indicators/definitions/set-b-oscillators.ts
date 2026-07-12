import type {
  IndicatorDefinition,
  MultiIndicatorOutput,
  ScalarIndicatorOutput,
} from '../contracts.js';
import {
  finiteResult,
  rollingMax,
  rollingMean,
  rollingMin,
  safeDivide,
  typicalPrice,
} from '../math/index.js';
import {
  alignSeries,
  fieldSeries,
  multi,
  periodWarmup,
  scalar,
} from './helpers.js';
import { rsiDefinition } from './momentum.js';
import {
  createMultiOutputSchema,
  createPeriodParameterSchema,
  createStochasticParameterSchema,
  createStochasticRsiParameterSchema,
  type PeriodParameters,
  scalarOutputSchema,
  type StochasticParameters,
  type StochasticRsiParameters,
} from './schemas.js';

const stochasticSchema = createMultiOutputSchema(['k', 'd']);
const stochasticSpecification = { kind: 'multi', keys: ['k', 'd'] } as const;

export const stochasticDefinition: IndicatorDefinition<
  StochasticParameters,
  MultiIndicatorOutput
> = {
  code: 'STOCHASTIC',
  version: 1,
  displayName: 'Stochastic Oscillator',
  category: 'momentum',
  requiredInputFields: ['high', 'low', 'close'],
  parameterSchema: createStochasticParameterSchema(),
  outputSchema: stochasticSchema,
  outputSpecification: stochasticSpecification,
  documentationReference: 'DOC-008#momentum',
  getWarmup: ({ kPeriod, dPeriod }) => {
    const minimumInputBars = kPeriod + dPeriod - 1;
    return {
      minimumInputBars,
      recommendedWarmupBars: minimumInputBars,
      firstValidIndex: minimumInputBars - 1,
    };
  },
  calculate(input, { kPeriod, dPeriod }) {
    const high = rollingMax(fieldSeries(input, 'high'), kPeriod);
    const low = rollingMin(fieldSeries(input, 'low'), kPeriod);
    const close = fieldSeries(input, 'close');
    const rawK = close.map((value, index) =>
      oscillator(value, low[index], high[index]),
    );
    const d = rollingMean(rawK, dPeriod);
    const firstValidIndex = kPeriod + dPeriod - 2;
    return multi({
      k: alignSeries(rawK, firstValidIndex),
      d: alignSeries(d, firstValidIndex),
    });
  },
};

export const stochasticRsiDefinition: IndicatorDefinition<
  StochasticRsiParameters,
  MultiIndicatorOutput
> = {
  ...stochasticDefinition,
  code: 'STOCHASTIC_RSI',
  displayName: 'Stochastic RSI',
  requiredInputFields: ['close'],
  parameterSchema: createStochasticRsiParameterSchema(),
  getWarmup: ({ rsiPeriod, kPeriod, dPeriod }) => {
    const minimumInputBars = rsiPeriod + kPeriod + dPeriod - 1;
    return {
      minimumInputBars,
      recommendedWarmupBars: minimumInputBars,
      firstValidIndex: minimumInputBars - 1,
    };
  },
  calculate(input, { rsiPeriod, kPeriod, dPeriod }) {
    const rsi = rsiDefinition.calculate(input, { period: rsiPeriod }).values;
    const high = rollingMax(rsi, kPeriod);
    const low = rollingMin(rsi, kPeriod);
    const rawK = rsi.map((value, index) =>
      oscillator(value, low[index], high[index]),
    );
    const d = rollingMean(rawK, dPeriod);
    const firstValidIndex = rsiPeriod + kPeriod + dPeriod - 2;
    return multi({
      k: alignSeries(rawK, firstValidIndex),
      d: alignSeries(d, firstValidIndex),
    });
  },
};

export const cciDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  code: 'CCI',
  version: 1,
  displayName: 'Commodity Channel Index',
  category: 'momentum',
  requiredInputFields: ['high', 'low', 'close'],
  parameterSchema: createPeriodParameterSchema(20),
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#momentum',
  getWarmup: ({ period }) => periodWarmup(period),
  calculate(input, { period }) {
    const prices = input.bars.map((bar) =>
      typicalPrice(bar.high, bar.low, bar.close),
    );
    const averages = rollingMean(prices, period);
    return scalar(
      prices.map((value, index) => {
        const average = averages[index] ?? null;
        if (value === null || average === null || index < period - 1)
          return null;
        let deviation = 0;
        for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
          const sample = prices[cursor];
          if (sample === null || sample === undefined) return null;
          deviation += Math.abs(sample - average);
        }
        const meanDeviation = finiteResult(deviation / period);
        return safeDivide(value - average, 0.015 * meanDeviation);
      }),
    );
  },
};

export const williamsRDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  code: 'WILLIAMS_R',
  version: 1,
  displayName: 'Williams %R',
  category: 'momentum',
  requiredInputFields: ['high', 'low', 'close'],
  parameterSchema: createPeriodParameterSchema(14),
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#momentum',
  getWarmup: ({ period }) => periodWarmup(period),
  calculate(input, { period }) {
    const high = rollingMax(fieldSeries(input, 'high'), period);
    const low = rollingMin(fieldSeries(input, 'low'), period);
    const close = fieldSeries(input, 'close');
    return scalar(
      close.map((value, index) => {
        const upper = high[index] ?? null;
        const lower = low[index] ?? null;
        if (value === null || upper === null || lower === null) return null;
        const ratio = safeDivide(upper - value, upper - lower);
        return ratio === null ? null : finiteResult(-100 * ratio);
      }),
    );
  },
};

function oscillator(
  value: number | null,
  low: number | null | undefined,
  high: number | null | undefined,
): number | null {
  if (
    value === null ||
    low === null ||
    low === undefined ||
    high === null ||
    high === undefined
  ) {
    return null;
  }
  const ratio = safeDivide(value - low, high - low);
  return ratio === null ? null : finiteResult(ratio * 100);
}
