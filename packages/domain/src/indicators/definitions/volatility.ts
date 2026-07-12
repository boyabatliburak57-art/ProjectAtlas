import type {
  IndicatorDefinition,
  ScalarIndicatorOutput,
} from '../contracts.js';
import { trueRange, wilderSmoothing } from '../math/index.js';
import { periodWarmup, scalar } from './helpers.js';
import {
  createPeriodParameterSchema,
  type PeriodParameters,
  scalarOutputSchema,
} from './schemas.js';

export const atrDefinition: IndicatorDefinition<
  PeriodParameters,
  ScalarIndicatorOutput
> = {
  code: 'ATR',
  version: 1,
  displayName: 'Average True Range',
  category: 'volatility',
  requiredInputFields: ['high', 'low', 'close'],
  parameterSchema: createPeriodParameterSchema(14),
  outputSchema: scalarOutputSchema,
  outputSpecification: { kind: 'scalar' },
  documentationReference: 'DOC-008#trend-ve-volatilite',
  getWarmup: ({ period }) => periodWarmup(period),
  calculate(input, { period }) {
    const ranges = input.bars.map((bar, index) =>
      trueRange(
        bar.high,
        bar.low,
        index === 0 ? null : (input.bars[index - 1]?.close ?? null),
      ),
    );
    return scalar(wilderSmoothing(ranges, period));
  },
};
