import type {
  IndicatorDefinition,
  ScalarIndicatorOutput,
} from '../contracts.js';
import {
  finiteResult,
  rollingSum,
  safeDivide,
  typicalPrice,
} from '../math/index.js';
import { periodWarmup, scalar } from './helpers.js';
import {
  createPeriodParameterSchema,
  type PeriodParameters,
  scalarOutputSchema,
} from './schemas.js';

export const cmfDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  code: 'CMF',
  version: 1,
  displayName: 'Chaikin Money Flow',
  category: 'volume',
  requiredInputFields: ['high', 'low', 'close', 'volume'],
  parameterSchema: createPeriodParameterSchema(20),
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#hacim',
  getWarmup: ({ period }) => periodWarmup(period),
  calculate(input, { period }) {
    const moneyFlowVolume = input.bars.map((bar) => {
      if (
        bar.high === null ||
        bar.low === null ||
        bar.close === null ||
        bar.volume === null
      ) {
        return null;
      }
      const multiplier = safeDivide(
        bar.close - bar.low - (bar.high - bar.close),
        bar.high - bar.low,
      );
      return multiplier === null ? null : finiteResult(multiplier * bar.volume);
    });
    const flow = rollingSum(moneyFlowVolume, period);
    const volume = rollingSum(
      input.bars.map((bar) => bar.volume),
      period,
    );
    return scalar(
      flow.map((value, index) => safeDivide(value, volume[index] ?? null)),
    );
  },
};

export const mfiDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  code: 'MFI',
  version: 1,
  displayName: 'Money Flow Index',
  category: 'volume',
  requiredInputFields: ['high', 'low', 'close', 'volume'],
  parameterSchema: createPeriodParameterSchema(14),
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#hacim',
  getWarmup: ({ period }) => ({
    minimumInputBars: period + 1,
    recommendedWarmupBars: period + 1,
    firstValidIndex: period,
  }),
  calculate(input, { period }) {
    const prices = input.bars.map((bar) =>
      typicalPrice(bar.high, bar.low, bar.close),
    );
    const positive: (number | null)[] = [null];
    const negative: (number | null)[] = [null];
    for (let index = 1; index < prices.length; index += 1) {
      const price = prices[index] ?? null;
      const previous = prices[index - 1] ?? null;
      const volume = input.bars[index]?.volume ?? null;
      if (price === null || previous === null || volume === null) {
        positive.push(null);
        negative.push(null);
        continue;
      }
      const rawFlow = finiteResult(price * volume);
      positive.push(price > previous ? rawFlow : 0);
      negative.push(price < previous ? rawFlow : 0);
    }
    const positiveFlow = rollingSum(positive, period);
    const negativeFlow = rollingSum(negative, period);
    return scalar(
      positiveFlow.map((gain, index) => {
        const loss = negativeFlow[index] ?? null;
        if (gain === null || loss === null) return null;
        if (gain === 0 && loss === 0) return 50;
        if (loss === 0) return 100;
        const ratio = safeDivide(gain, loss);
        return ratio === null ? null : finiteResult(100 - 100 / (1 + ratio));
      }),
    );
  },
};
