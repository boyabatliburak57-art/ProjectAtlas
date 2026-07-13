import type {
  IndicatorDefinition,
  MultiIndicatorOutput,
} from '../contracts.js';
import {
  finiteResult,
  safeDivide,
  trueRange,
  wilderSmoothing,
} from '../math/index.js';
import { multi } from './helpers.js';
import {
  createChannelParameterSchema,
  createMultiOutputSchema,
  createPeriodParameterSchema,
  type ChannelParameters,
  type PeriodParameters,
} from './schemas.js';

const adxOutputs = ['adx', 'plusDi', 'minusDi'] as const;
const supertrendOutputs = ['trend', 'direction'] as const;

export const adxDefinition: IndicatorDefinition<
  PeriodParameters,
  MultiIndicatorOutput
> = {
  code: 'ADX',
  version: 1,
  displayName: 'Average Directional Index',
  category: 'trend',
  requiredInputFields: ['high', 'low', 'close'],
  parameterSchema: createPeriodParameterSchema(14),
  outputSchema: createMultiOutputSchema(adxOutputs),
  outputSpecification: { kind: 'multi', keys: adxOutputs },
  documentationReference: 'DOC-008#trend-ve-volatilite',
  getWarmup: ({ period }) => ({
    minimumInputBars: period * 2,
    recommendedWarmupBars: period * 2,
    firstValidIndex: period * 2 - 1,
  }),
  calculate(input, { period }) {
    const ranges = input.bars.map((bar, index) =>
      trueRange(
        bar.high,
        bar.low,
        index === 0 ? null : (input.bars[index - 1]?.close ?? null),
      ),
    );
    const plusMovement = input.bars.map((bar, index) => {
      const previous = input.bars[index - 1];
      if (
        previous === undefined ||
        bar.high === null ||
        bar.low === null ||
        previous.high === null ||
        previous.low === null
      ) {
        return null;
      }
      const up = bar.high - previous.high;
      const down = previous.low - bar.low;
      return up > down && up > 0 ? up : 0;
    });
    const minusMovement = input.bars.map((bar, index) => {
      const previous = input.bars[index - 1];
      if (
        previous === undefined ||
        bar.high === null ||
        bar.low === null ||
        previous.high === null ||
        previous.low === null
      ) {
        return null;
      }
      const up = bar.high - previous.high;
      const down = previous.low - bar.low;
      return down > up && down > 0 ? down : 0;
    });
    const averageRange = wilderSmoothing(ranges, period);
    const smoothedPlus = wilderSmoothing(plusMovement, period);
    const smoothedMinus = wilderSmoothing(minusMovement, period);
    const plusDi = averageRange.map((range, index) =>
      ratioPercent(smoothedPlus[index] ?? null, range),
    );
    const minusDi = averageRange.map((range, index) =>
      ratioPercent(smoothedMinus[index] ?? null, range),
    );
    const directionalIndex = plusDi.map((plus, index) => {
      const minus = minusDi[index] ?? null;
      if (plus === null || minus === null) return null;
      return ratioPercent(Math.abs(plus - minus), plus + minus);
    });
    return multi({
      adx: wilderSmoothing(directionalIndex, period),
      plusDi,
      minusDi,
    });
  },
};

export const supertrendDefinition: IndicatorDefinition<
  ChannelParameters,
  MultiIndicatorOutput
> = {
  code: 'SUPERTREND',
  version: 1,
  displayName: 'Supertrend',
  category: 'trend',
  requiredInputFields: ['high', 'low', 'close'],
  parameterSchema: createChannelParameterSchema(10, 3),
  outputSchema: createMultiOutputSchema(supertrendOutputs),
  outputSpecification: { kind: 'multi', keys: supertrendOutputs },
  documentationReference: 'DOC-008#trend-ve-volatilite',
  getWarmup: ({ period }) => ({
    minimumInputBars: period,
    recommendedWarmupBars: period,
    firstValidIndex: period - 1,
  }),
  calculate(input, { period, multiplier }) {
    const ranges = input.bars.map((bar, index) =>
      trueRange(
        bar.high,
        bar.low,
        index === 0 ? null : (input.bars[index - 1]?.close ?? null),
      ),
    );
    const atr = wilderSmoothing(ranges, period);
    const trend: (number | null)[] = Array.from(
      { length: input.bars.length },
      () => null,
    );
    const direction: (number | null)[] = Array.from(
      { length: input.bars.length },
      () => null,
    );
    let upper: number | null = null;
    let lower: number | null = null;
    let bullish = true;
    input.bars.forEach((bar, index) => {
      const range = atr[index] ?? null;
      if (
        range === null ||
        bar.high === null ||
        bar.low === null ||
        bar.close === null
      ) {
        upper = null;
        lower = null;
        return;
      }
      const midpoint = (bar.high + bar.low) / 2;
      const basicUpper = finiteResult(midpoint + multiplier * range);
      const basicLower = finiteResult(midpoint - multiplier * range);
      const previousClose = input.bars[index - 1]?.close ?? null;
      upper =
        upper === null ||
        previousClose === null ||
        basicUpper < upper ||
        previousClose > upper
          ? basicUpper
          : upper;
      lower =
        lower === null ||
        previousClose === null ||
        basicLower > lower ||
        previousClose < lower
          ? basicLower
          : lower;
      if (bullish && bar.close < lower) bullish = false;
      else if (!bullish && bar.close > upper) bullish = true;
      trend[index] = bullish ? lower : upper;
      direction[index] = bullish ? 1 : -1;
    });
    return multi({ trend, direction });
  },
};

function ratioPercent(
  numerator: number | null,
  denominator: number | null,
): number | null {
  const ratio = safeDivide(numerator, denominator);
  return ratio === null ? null : finiteResult(ratio * 100);
}
