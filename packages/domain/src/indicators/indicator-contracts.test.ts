import { describe, expect, it } from 'vitest';

import type {
  IndicatorInput,
  IndicatorPriceBar,
  WarmupRequirement,
} from './contracts.js';
import { IndicatorDomainError } from './errors.js';
import { createStableParameterHash } from './parameter-hash.js';
import {
  validateIndicatorInput,
  validateIndicatorOutput,
} from './validation.js';

const warmup: WarmupRequirement = {
  minimumInputBars: 3,
  recommendedWarmupBars: 5,
  firstValidIndex: 2,
};

function bar(timestamp: string): IndicatorPriceBar {
  return {
    timestamp: new Date(timestamp),
    open: 10,
    high: 12,
    low: 9,
    close: 11,
    volume: 100,
    isClosed: true,
  };
}

function input(bars: readonly IndicatorPriceBar[]): IndicatorInput {
  return {
    instrumentId: 'instrument-1',
    timeframe: '1d',
    bars,
    adjustmentMode: 'raw',
    dataCutoffAt: new Date('2026-07-12T00:00:00.000Z'),
  };
}

const orderedBars = [
  bar('2026-07-01T00:00:00.000Z'),
  bar('2026-07-02T00:00:00.000Z'),
  bar('2026-07-03T00:00:00.000Z'),
];

function expectIndicatorError(
  action: () => unknown,
  code: IndicatorDomainError['code'],
): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<IndicatorDomainError>>({ code }),
  );
}

describe('indicator input contracts', () => {
  it('accepts an ordered, unique and sufficiently long series', () => {
    expect(() =>
      validateIndicatorInput(input(orderedBars), ['close', 'volume'], warmup),
    ).not.toThrow();
  });

  it('rejects out-of-order and duplicate timestamps', () => {
    expectIndicatorError(
      () =>
        validateIndicatorInput(
          input([orderedBars[1]!, orderedBars[0]!, orderedBars[2]!]),
          ['close'],
          warmup,
        ),
      'INDICATOR_INPUT_INVALID',
    );
    expectIndicatorError(
      () =>
        validateIndicatorInput(
          input([orderedBars[0]!, orderedBars[0]!, orderedBars[2]!]),
          ['close'],
          warmup,
        ),
      'INDICATOR_INPUT_INVALID',
    );
  });

  it('distinguishes insufficient input from malformed numeric input', () => {
    expectIndicatorError(
      () =>
        validateIndicatorInput(
          input(orderedBars.slice(0, 2)),
          ['close'],
          warmup,
        ),
      'INDICATOR_INPUT_TOO_SHORT',
    );
    expectIndicatorError(
      () =>
        validateIndicatorInput(
          input([
            { ...orderedBars[0]!, close: Number.NaN },
            ...orderedBars.slice(1),
          ]),
          ['close'],
          warmup,
        ),
      'INDICATOR_INPUT_INVALID',
    );
  });
});

describe('stable parameter hash', () => {
  it('is deterministic across nested object key order', () => {
    const left = createStableParameterHash({
      period: 14,
      smoothing: { seed: 'wilder', alpha: 1 / 14 },
      sources: ['high', 'low', 'close'],
    });
    const right = createStableParameterHash({
      sources: ['high', 'low', 'close'],
      smoothing: { alpha: 1 / 14, seed: 'wilder' },
      period: 14,
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(createStableParameterHash({ period: 15 })).not.toBe(left);
  });

  it('rejects non-finite and non-JSON parameter values', () => {
    expectIndicatorError(
      () => createStableParameterHash({ period: Number.POSITIVE_INFINITY }),
      'INDICATOR_PARAMETERS_INVALID',
    );
    expectIndicatorError(
      () => createStableParameterHash({ calculatedAt: new Date() }),
      'INDICATOR_PARAMETERS_INVALID',
    );
  });
});

describe('indicator output contracts', () => {
  it('accepts scalar and exact named multi-output series', () => {
    expect(() =>
      validateIndicatorOutput(
        { kind: 'scalar', values: [null, null, 42] },
        3,
        warmup,
        { kind: 'scalar' },
      ),
    ).not.toThrow();
    expect(() =>
      validateIndicatorOutput(
        {
          kind: 'multi',
          outputs: {
            signal: [null, null, 1],
            histogram: [null, null, 0.5],
          },
        },
        3,
        warmup,
        { kind: 'multi', keys: ['histogram', 'signal'] },
      ),
    ).not.toThrow();
  });

  it('rejects length mismatch, non-null warm-up and non-finite values', () => {
    for (const values of [
      [null, null],
      [null, 1, 2],
      [null, null, Number.NaN],
      [null, null, Number.POSITIVE_INFINITY],
    ]) {
      expectIndicatorError(
        () =>
          validateIndicatorOutput({ kind: 'scalar', values }, 3, warmup, {
            kind: 'scalar',
          }),
        'INDICATOR_OUTPUT_INVALID',
      );
    }
  });

  it('rejects missing, unknown or duplicate multi-output keys', () => {
    expectIndicatorError(
      () =>
        validateIndicatorOutput(
          { kind: 'multi', outputs: { signal: [null, null, 1] } },
          3,
          warmup,
          { kind: 'multi', keys: ['signal', 'histogram'] },
        ),
      'INDICATOR_OUTPUT_INVALID',
    );
    expectIndicatorError(
      () =>
        validateIndicatorOutput(
          {
            kind: 'multi',
            outputs: {
              signal: [null, null, 1],
              unexpected: [null, null, 2],
            },
          },
          3,
          warmup,
          { kind: 'multi', keys: ['signal'] },
        ),
      'INDICATOR_OUTPUT_INVALID',
    );
    expectIndicatorError(
      () =>
        validateIndicatorOutput(
          { kind: 'multi', outputs: { signal: [null, null, 1] } },
          3,
          warmup,
          { kind: 'multi', keys: ['signal', 'signal'] },
        ),
      'INDICATOR_OUTPUT_INVALID',
    );
  });
});
