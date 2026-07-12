import { describe, expect, it } from 'vitest';

import type {
  IndicatorDefinition,
  IndicatorInput,
  IndicatorOutput,
} from '../contracts.js';
import { IndicatorDomainError } from '../errors.js';
import {
  SET_B_INPUT,
  SET_B_REFERENCE_FIXTURES,
  type SetBReferenceFixture,
} from '../fixtures/set-b/reference-fixtures.js';
import {
  validateIndicatorInput,
  validateIndicatorOutput,
} from '../validation.js';
import { CORE_INDICATORS_SET_B } from './index.js';
import {
  cciDefinition,
  stochasticDefinition,
  stochasticRsiDefinition,
  williamsRDefinition,
} from './set-b-oscillators.js';
import {
  bollingerBandsDefinition,
  donchianChannelDefinition,
  keltnerChannelDefinition,
  macdDefinition,
} from './set-b-trend.js';
import { cmfDefinition, mfiDefinition } from './set-b-volume.js';

function fixtureInput(
  overrides: Partial<IndicatorInput['bars'][number]> = {},
): IndicatorInput {
  return {
    instrumentId: 'set-b-fixture',
    timeframe: '1d',
    adjustmentMode: 'raw',
    dataCutoffAt: new Date('2026-07-20T00:00:00.000Z'),
    bars: SET_B_INPUT.close.map((close, index) => ({
      timestamp: new Date(Date.UTC(2026, 6, index + 1)),
      open: close,
      high: SET_B_INPUT.high[index] ?? null,
      low: SET_B_INPUT.low[index] ?? null,
      close,
      volume: SET_B_INPUT.volume[index] ?? null,
      isClosed: true,
      ...overrides,
    })),
  };
}

function assertFixture<P>(
  definition: IndicatorDefinition<P>,
  fixture: SetBReferenceFixture,
): void {
  const parameters = definition.parameterSchema.parse(fixture.parameters);
  const warmup = definition.getWarmup(parameters);
  const input = fixtureInput();
  validateIndicatorInput(input, definition.requiredInputFields, warmup);
  const output = definition.outputSchema.parse(
    definition.calculate(input, parameters),
  );
  validateIndicatorOutput(
    output,
    input.bars.length,
    warmup,
    definition.outputSpecification,
  );

  expect(definition.code).toBe(fixture.indicator.code);
  expect(definition.version).toBe(fixture.indicator.version);
  expect(warmup.firstValidIndex).toBe(fixture.firstValidIndex);
  expect(fixture.source).toContain('not generated during tests');
  const actualOutputs =
    output.kind === 'scalar' ? { value: output.values } : output.outputs;
  expect(Object.keys(actualOutputs).sort()).toEqual(
    Object.keys(fixture.expected).sort(),
  );
  for (const [key, expectedSeries] of Object.entries(fixture.expected)) {
    const actualSeries = actualOutputs[key];
    expect(actualSeries).toHaveLength(expectedSeries.length);
    expectedSeries.forEach((expected, index) => {
      const actual = actualSeries?.[index];
      if (expected === null) expect(actual).toBeNull();
      else expect(actual).toBeCloseTo(expected, 9);
    });
  }
}

function fixtureFor(code: string): SetBReferenceFixture {
  const fixture = SET_B_REFERENCE_FIXTURES.find(
    (candidate) => candidate.indicator.code === code,
  );
  if (fixture === undefined) throw new Error(`Missing fixture for ${code}`);
  return fixture;
}

describe('Core Indicators Set B reference fixtures', () => {
  it('matches all ten static reference fixtures', () => {
    assertFixture(macdDefinition, fixtureFor('MACD'));
    assertFixture(bollingerBandsDefinition, fixtureFor('BOLLINGER_BANDS'));
    assertFixture(donchianChannelDefinition, fixtureFor('DONCHIAN_CHANNEL'));
    assertFixture(stochasticDefinition, fixtureFor('STOCHASTIC'));
    assertFixture(stochasticRsiDefinition, fixtureFor('STOCHASTIC_RSI'));
    assertFixture(cciDefinition, fixtureFor('CCI'));
    assertFixture(williamsRDefinition, fixtureFor('WILLIAMS_R'));
    assertFixture(cmfDefinition, fixtureFor('CMF'));
    assertFixture(mfiDefinition, fixtureFor('MFI'));
    assertFixture(keltnerChannelDefinition, fixtureFor('KELTNER_CHANNEL'));
  });

  it('publishes unique versioned metadata and a fixture per definition', () => {
    expect(CORE_INDICATORS_SET_B).toHaveLength(10);
    expect(new Set(CORE_INDICATORS_SET_B.map(({ code }) => code)).size).toBe(
      10,
    );
    expect(SET_B_REFERENCE_FIXTURES).toHaveLength(10);
    for (const definition of CORE_INDICATORS_SET_B) {
      expect(definition.version).toBe(1);
      expect(definition.documentationReference).toMatch(/^DOC-008#/);
      expect(fixtureFor(definition.code).notes.length).toBeGreaterThan(0);
    }
  });

  it('documents and enforces MACD SMA-seed warm-up alignment', () => {
    const parameters = macdDefinition.parameterSchema.parse({
      fastPeriod: 2,
      slowPeriod: 3,
      signalPeriod: 2,
    });
    expect(macdDefinition.getWarmup(parameters)).toEqual({
      minimumInputBars: 4,
      recommendedWarmupBars: 4,
      firstValidIndex: 3,
    });
    const output = macdDefinition.calculate(fixtureInput(), parameters);
    expect(output.outputs.macd?.slice(0, 3)).toEqual([null, null, null]);
    expect(output.outputs.signal?.[3]).toBeCloseTo(1 / 3, 12);
  });
});

describe('Core Indicators Set B boundaries', () => {
  it('rejects invalid parameter combinations and multi-output shapes', () => {
    expectIndicatorError(
      () =>
        macdDefinition.parameterSchema.parse({
          fastPeriod: 3,
          slowPeriod: 2,
          signalPeriod: 2,
        }),
      'INDICATOR_PARAMETERS_INVALID',
    );
    expectIndicatorError(
      () =>
        bollingerBandsDefinition.parameterSchema.parse({
          period: 3,
          multiplier: 0,
        }),
      'INDICATOR_PARAMETERS_INVALID',
    );
    expectIndicatorError(
      () => stochasticDefinition.parameterSchema.parse({ kPeriod: 1 }),
      'INDICATOR_PARAMETERS_INVALID',
    );
    expectIndicatorError(
      () =>
        macdDefinition.outputSchema.parse({
          kind: 'multi',
          outputs: { macd: [], signal: [] },
        }),
      'INDICATOR_OUTPUT_INVALID',
    );
  });

  it('classifies insufficient input for every definition', () => {
    assertInsufficient(macdDefinition, fixtureFor('MACD'));
    assertInsufficient(bollingerBandsDefinition, fixtureFor('BOLLINGER_BANDS'));
    assertInsufficient(
      donchianChannelDefinition,
      fixtureFor('DONCHIAN_CHANNEL'),
    );
    assertInsufficient(stochasticDefinition, fixtureFor('STOCHASTIC'));
    assertInsufficient(stochasticRsiDefinition, fixtureFor('STOCHASTIC_RSI'));
    assertInsufficient(cciDefinition, fixtureFor('CCI'));
    assertInsufficient(williamsRDefinition, fixtureFor('WILLIAMS_R'));
    assertInsufficient(cmfDefinition, fixtureFor('CMF'));
    assertInsufficient(mfiDefinition, fixtureFor('MFI'));
    assertInsufficient(keltnerChannelDefinition, fixtureFor('KELTNER_CHANNEL'));
  });

  it('handles zero-range and zero-volume without NaN or Infinity', () => {
    const input = fixtureInput({ high: 10, low: 10, close: 10, volume: 0 });
    for (const [definition, fixture] of executableCases()) {
      const output = definition.run(input, fixture.parameters);
      assertFiniteOrNull(output);
    }
    const stochastic = stochasticDefinition.calculate(input, {
      kPeriod: 3,
      dPeriod: 2,
    });
    expect(stochastic.outputs.k?.every((value) => value === null)).toBe(true);
    const cmf = cmfDefinition.calculate(input, { period: 3 });
    expect(cmf.values.every((value) => value === null)).toBe(true);
    const mfi = mfiDefinition.calculate(input, { period: 3 });
    expect(mfi.values.slice(3)).toEqual([50, 50, 50, 50, 50, 50, 50]);
  });

  it('propagates missing data, preserves input and remains finite at extremes', () => {
    const missing = fixtureInput({ close: null });
    const extreme = fixtureInput({
      open: 1e100,
      high: 1e100,
      low: 1e100,
      close: 1e100,
      volume: 1e100,
    });
    Object.freeze(missing.bars);
    for (const [definition, fixture] of executableCases()) {
      assertFiniteOrNull(definition.run(missing, fixture.parameters));
      assertFiniteOrNull(definition.run(extreme, fixture.parameters));
    }
    expect(missing.bars).toHaveLength(10);
  });
});

interface ExecutableDefinition {
  readonly run: (
    input: IndicatorInput,
    parameters: Readonly<Record<string, number>>,
  ) => IndicatorOutput;
}

function executableCases(): readonly [
  ExecutableDefinition,
  SetBReferenceFixture,
][] {
  return [
    [executable(macdDefinition), fixtureFor('MACD')],
    [executable(bollingerBandsDefinition), fixtureFor('BOLLINGER_BANDS')],
    [executable(donchianChannelDefinition), fixtureFor('DONCHIAN_CHANNEL')],
    [executable(stochasticDefinition), fixtureFor('STOCHASTIC')],
    [executable(stochasticRsiDefinition), fixtureFor('STOCHASTIC_RSI')],
    [executable(cciDefinition), fixtureFor('CCI')],
    [executable(williamsRDefinition), fixtureFor('WILLIAMS_R')],
    [executable(cmfDefinition), fixtureFor('CMF')],
    [executable(mfiDefinition), fixtureFor('MFI')],
    [executable(keltnerChannelDefinition), fixtureFor('KELTNER_CHANNEL')],
  ];
}

function executable<P>(
  definition: IndicatorDefinition<P>,
): ExecutableDefinition {
  return {
    run(input, rawParameters) {
      const parameters = definition.parameterSchema.parse(rawParameters);
      return definition.calculate(input, parameters);
    },
  };
}

function assertFiniteOrNull(output: IndicatorOutput): void {
  const series =
    output.kind === 'scalar' ? [output.values] : Object.values(output.outputs);
  for (const values of series) {
    expect(
      values.every((value) => value === null || Number.isFinite(value)),
    ).toBe(true);
  }
}

function assertInsufficient<P>(
  definition: IndicatorDefinition<P>,
  fixture: SetBReferenceFixture,
): void {
  const parameters = definition.parameterSchema.parse(fixture.parameters);
  const warmup = definition.getWarmup(parameters);
  const input = fixtureInput();
  expectIndicatorError(
    () =>
      validateIndicatorInput(
        { ...input, bars: input.bars.slice(0, warmup.minimumInputBars - 1) },
        definition.requiredInputFields,
        warmup,
      ),
    'INDICATOR_INPUT_TOO_SHORT',
  );
}

function expectIndicatorError(
  action: () => unknown,
  code: IndicatorDomainError['code'],
): void {
  expect(action).toThrowError(
    expect.objectContaining<Partial<IndicatorDomainError>>({ code }),
  );
}
