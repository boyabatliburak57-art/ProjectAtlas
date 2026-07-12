import type {
  IndicatorDefinition,
  MultiIndicatorOutput,
} from '../contracts.js';
import {
  exponentialMovingAverage,
  finiteResult,
  rollingMax,
  rollingMean,
  rollingMin,
  rollingStandardDeviation,
  trueRange,
  wilderSmoothing,
} from '../math/index.js';
import { alignSeries, fieldSeries, multi, periodWarmup } from './helpers.js';
import {
  createChannelParameterSchema,
  createKeltnerParameterSchema,
  createMacdParameterSchema,
  createMultiOutputSchema,
  createPeriodParameterSchema,
  type ChannelParameters,
  type KeltnerParameters,
  type MacdParameters,
  type PeriodParameters,
} from './schemas.js';

const threeBandSchema = createMultiOutputSchema(['upper', 'middle', 'lower']);
const threeBandSpecification = {
  kind: 'multi',
  keys: ['upper', 'middle', 'lower'],
} as const;

export const macdDefinition: IndicatorDefinition<
  MacdParameters,
  MultiIndicatorOutput
> = {
  code: 'MACD',
  version: 1,
  displayName: 'Moving Average Convergence Divergence',
  category: 'trend',
  requiredInputFields: ['close'],
  parameterSchema: createMacdParameterSchema(),
  outputSchema: createMultiOutputSchema(['macd', 'signal', 'histogram']),
  outputSpecification: {
    kind: 'multi',
    keys: ['macd', 'signal', 'histogram'],
  },
  documentationReference: 'DOC-008#trend-ve-volatilite',
  getWarmup: ({ slowPeriod, signalPeriod }) => {
    const minimumInputBars = slowPeriod + signalPeriod - 1;
    return {
      minimumInputBars,
      recommendedWarmupBars: minimumInputBars,
      firstValidIndex: minimumInputBars - 1,
    };
  },
  calculate(input, parameters) {
    const close = fieldSeries(input, 'close');
    const fast = exponentialMovingAverage(close, parameters.fastPeriod);
    const slow = exponentialMovingAverage(close, parameters.slowPeriod);
    const rawMacd = close.map((_value, index) => {
      const fastValue = fast[index] ?? null;
      const slowValue = slow[index] ?? null;
      return fastValue === null || slowValue === null
        ? null
        : finiteResult(fastValue - slowValue);
    });
    const signal = exponentialMovingAverage(rawMacd, parameters.signalPeriod);
    const firstValidIndex = parameters.slowPeriod + parameters.signalPeriod - 2;
    const macd = alignSeries(rawMacd, firstValidIndex);
    const alignedSignal = alignSeries(signal, firstValidIndex);
    const histogram = macd.map((value, index) => {
      const signalValue = alignedSignal[index] ?? null;
      return value === null || signalValue === null
        ? null
        : finiteResult(value - signalValue);
    });
    return multi({ macd, signal: alignedSignal, histogram });
  },
};

export const bollingerBandsDefinition: IndicatorDefinition<
  ChannelParameters,
  MultiIndicatorOutput
> = {
  code: 'BOLLINGER_BANDS',
  version: 1,
  displayName: 'Bollinger Bands',
  category: 'volatility',
  requiredInputFields: ['close'],
  parameterSchema: createChannelParameterSchema(20, 2),
  outputSchema: threeBandSchema,
  outputSpecification: threeBandSpecification,
  documentationReference: 'DOC-008#trend-ve-volatilite',
  getWarmup: ({ period }) => periodWarmup(period),
  calculate(input, { period, multiplier }) {
    const close = fieldSeries(input, 'close');
    const middle = rollingMean(close, period);
    const deviation = rollingStandardDeviation(close, period, 'population');
    return bandsFromRange(middle, deviation, multiplier);
  },
};

export const donchianChannelDefinition: IndicatorDefinition<
  PeriodParameters,
  MultiIndicatorOutput
> = {
  code: 'DONCHIAN_CHANNEL',
  version: 1,
  displayName: 'Donchian Channel',
  category: 'volatility',
  requiredInputFields: ['high', 'low'],
  parameterSchema: createPeriodParameterSchema(20),
  outputSchema: threeBandSchema,
  outputSpecification: threeBandSpecification,
  documentationReference: 'DOC-008#trend-ve-volatilite',
  getWarmup: ({ period }) => periodWarmup(period),
  calculate(input, { period }) {
    const upper = rollingMax(fieldSeries(input, 'high'), period);
    const lower = rollingMin(fieldSeries(input, 'low'), period);
    const middle = upper.map((value, index) => {
      const low = lower[index] ?? null;
      return value === null || low === null
        ? null
        : finiteResult((value + low) / 2);
    });
    return multi({ upper, middle, lower });
  },
};

export const keltnerChannelDefinition: IndicatorDefinition<
  KeltnerParameters,
  MultiIndicatorOutput
> = {
  code: 'KELTNER_CHANNEL',
  version: 1,
  displayName: 'Keltner Channel',
  category: 'volatility',
  requiredInputFields: ['high', 'low', 'close'],
  parameterSchema: createKeltnerParameterSchema(),
  outputSchema: threeBandSchema,
  outputSpecification: threeBandSpecification,
  documentationReference: 'DOC-008#trend-ve-volatilite',
  getWarmup: ({ emaPeriod, atrPeriod }) =>
    periodWarmup(Math.max(emaPeriod, atrPeriod)),
  calculate(input, { emaPeriod, atrPeriod, multiplier }) {
    const middle = exponentialMovingAverage(
      fieldSeries(input, 'close'),
      emaPeriod,
    );
    const ranges = input.bars.map((bar, index) =>
      trueRange(
        bar.high,
        bar.low,
        index === 0 ? null : (input.bars[index - 1]?.close ?? null),
      ),
    );
    const atr = wilderSmoothing(ranges, atrPeriod);
    return bandsFromRange(middle, atr, multiplier);
  },
};

function bandsFromRange(
  middle: readonly (number | null)[],
  range: readonly (number | null)[],
  multiplier: number,
): MultiIndicatorOutput {
  const upper = middle.map((value, index) => {
    const width = range[index] ?? null;
    return value === null || width === null
      ? null
      : finiteResult(value + multiplier * width);
  });
  const lower = middle.map((value, index) => {
    const width = range[index] ?? null;
    return value === null || width === null
      ? null
      : finiteResult(value - multiplier * width);
  });
  return multi({ upper, middle, lower });
}
