import { describe, expect, it } from 'vitest';

import type {
  IndicatorDefinition,
  IndicatorInput,
  IndicatorPriceBar,
  ScalarIndicatorOutput,
} from '../contracts.js';
import { IndicatorDomainError } from '../errors.js';
import {
  atrFixture,
  emaFixture,
  momentumFixture,
  obvFixture,
  relativeVolumeFixture,
  rocFixture,
  rsiFixture,
  SET_A_INPUT,
  smaFixture,
  type ScalarReferenceFixture,
  volumeSmaFixture,
  wmaFixture,
} from '../fixtures/set-a/reference-fixtures.js';
import {
  validateIndicatorInput,
  validateIndicatorOutput,
} from '../validation.js';
import { atrDefinition } from './volatility.js';
import {
  emaDefinition,
  smaDefinition,
  wmaDefinition,
} from './moving-averages.js';
import {
  momentumDefinition,
  rocDefinition,
  rsiDefinition,
} from './momentum.js';
import { CORE_INDICATORS_SET_A } from './index.js';
import {
  obvDefinition,
  relativeVolumeDefinition,
  volumeSmaDefinition,
} from './volume.js';

function fixtureInput(
  overrides: Partial<IndicatorPriceBar> = {},
): IndicatorInput {
  return {
    instrumentId: 'fixture-instrument',
    timeframe: '1d',
    adjustmentMode: 'raw',
    dataCutoffAt: new Date('2026-07-12T00:00:00.000Z'),
    bars: SET_A_INPUT.close.map((close, index) => ({
      timestamp: new Date(Date.UTC(2026, 6, index + 1)),
      open: close,
      high: SET_A_INPUT.high[index] ?? null,
      low: SET_A_INPUT.low[index] ?? null,
      close,
      volume: SET_A_INPUT.volume[index] ?? null,
      isClosed: true,
      ...overrides,
    })),
  };
}

function assertFixture<P>(
  definition: IndicatorDefinition<P, ScalarIndicatorOutput>,
  fixture: ScalarReferenceFixture<P>,
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
  expect(fixture.source).not.toContain('calculate(');
  expect(output.values).toHaveLength(fixture.expected.length);
  output.values.forEach((actual, index) => {
    const expected = fixture.expected[index];
    if (expected === null) expect(actual).toBeNull();
    else if (expected !== undefined)
      expect(actual).toBeCloseTo(expected, toleranceDigits(fixture.tolerance));
  });
}

function toleranceDigits(tolerance: number): number {
  return tolerance === 0 ? 15 : Math.max(0, Math.floor(-Math.log10(tolerance)));
}

describe('Core Indicators Set A reference fixtures', () => {
  it('matches independently recorded values for all ten definitions', () => {
    assertFixture(smaDefinition, smaFixture);
    assertFixture(emaDefinition, emaFixture);
    assertFixture(wmaDefinition, wmaFixture);
    assertFixture(rocDefinition, rocFixture);
    assertFixture(momentumDefinition, momentumFixture);
    assertFixture(atrDefinition, atrFixture);
    assertFixture(rsiDefinition, rsiFixture);
    assertFixture(obvDefinition, obvFixture);
    assertFixture(volumeSmaDefinition, volumeSmaFixture);
    assertFixture(relativeVolumeDefinition, relativeVolumeFixture);
  });

  it('publishes complete, unique and versioned definition metadata', () => {
    expect(CORE_INDICATORS_SET_A).toHaveLength(10);
    expect(new Set(CORE_INDICATORS_SET_A.map(({ code }) => code)).size).toBe(
      10,
    );
    for (const definition of CORE_INDICATORS_SET_A) {
      expect(definition.version).toBe(1);
      expect(definition.displayName.length).toBeGreaterThan(0);
      expect(definition.documentationReference).toMatch(/^DOC-008#/);
      expect(definition.outputSpecification).toEqual({ kind: 'scalar' });
    }
  });
});

describe('Core Indicators Set A boundaries', () => {
  it('rejects invalid parameters and insufficient input', () => {
    for (const definition of [
      smaDefinition,
      emaDefinition,
      wmaDefinition,
      rocDefinition,
      momentumDefinition,
      atrDefinition,
      rsiDefinition,
      volumeSmaDefinition,
      relativeVolumeDefinition,
    ]) {
      expect(() =>
        definition.parameterSchema.parse({ period: 1 }),
      ).toThrowError(
        expect.objectContaining<Partial<IndicatorDomainError>>({
          code: 'INDICATOR_PARAMETERS_INVALID',
        }),
      );
    }

    assertInsufficient(smaDefinition, { period: 3 });
    assertInsufficient(emaDefinition, { period: 3 });
    assertInsufficient(wmaDefinition, { period: 3 });
    assertInsufficient(rocDefinition, { period: 2 });
    assertInsufficient(momentumDefinition, { period: 2 });
    assertInsufficient(atrDefinition, { period: 3 });
    assertInsufficient(rsiDefinition, { period: 3 });
    assertInsufficient(obvDefinition, {});
    assertInsufficient(volumeSmaDefinition, { period: 3 });
    assertInsufficient(relativeVolumeDefinition, { period: 3 });
  });

  it('handles constant prices and zero volume without non-finite output', () => {
    const input = fixtureInput({ high: 10, low: 10, close: 10, volume: 0 });
    const cases = [
      calculateScalar(smaDefinition, input, { period: 3 }),
      calculateScalar(emaDefinition, input, { period: 3 }),
      calculateScalar(wmaDefinition, input, { period: 3 }),
      calculateScalar(rocDefinition, input, { period: 2 }),
      calculateScalar(momentumDefinition, input, { period: 2 }),
      calculateScalar(atrDefinition, input, { period: 3 }),
      calculateScalar(rsiDefinition, input, { period: 3 }),
      calculateScalar(obvDefinition, input, {}),
      calculateScalar(volumeSmaDefinition, input, { period: 3 }),
      calculateScalar(relativeVolumeDefinition, input, { period: 3 }),
    ];

    expect(cases[3]?.values.slice(2)).toEqual([0, 0, 0, 0]);
    expect(cases[4]?.values.slice(2)).toEqual([0, 0, 0, 0]);
    expect(cases[5]?.values.slice(2)).toEqual([0, 0, 0, 0]);
    expect(cases[6]?.values.slice(3)).toEqual([50, 50, 50]);
    expect(cases[7]?.values).toEqual([0, 0, 0, 0, 0, 0]);
    expect(cases[9]?.values).toEqual([null, null, null, null, null, null]);
    for (const output of cases) {
      expect(
        output.values.every(
          (value) => value === null || Number.isFinite(value),
        ),
      ).toBe(true);
    }
  });

  it('propagates missing values, preserves alignment and does not mutate input', () => {
    const mutable = fixtureInput();
    const bars = mutable.bars.map((bar, index) =>
      Object.freeze(index === 2 ? { ...bar, close: null } : { ...bar }),
    );
    const input = Object.freeze({ ...mutable, bars: Object.freeze(bars) });

    for (const output of [
      calculateScalar(smaDefinition, input, { period: 3 }),
      calculateScalar(emaDefinition, input, { period: 3 }),
      calculateScalar(wmaDefinition, input, { period: 3 }),
      calculateScalar(rocDefinition, input, { period: 2 }),
      calculateScalar(momentumDefinition, input, { period: 2 }),
      calculateScalar(atrDefinition, input, { period: 3 }),
      calculateScalar(rsiDefinition, input, { period: 3 }),
      calculateScalar(obvDefinition, input, {}),
      calculateScalar(volumeSmaDefinition, input, { period: 3 }),
      calculateScalar(relativeVolumeDefinition, input, { period: 3 }),
    ]) {
      expect(output.values).toHaveLength(input.bars.length);
      expect(
        output.values.every(
          (value) => value === null || Number.isFinite(value),
        ),
      ).toBe(true);
    }
    expect(input.bars[2]?.close).toBeNull();
  });

  it('rejects non-finite input and invalid output schema values', () => {
    const invalidInput = fixtureInput({ close: Number.POSITIVE_INFINITY });
    const parameters = smaDefinition.parameterSchema.parse({ period: 3 });
    expect(() =>
      validateIndicatorInput(
        invalidInput,
        smaDefinition.requiredInputFields,
        smaDefinition.getWarmup(parameters),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<IndicatorDomainError>>({
        code: 'INDICATOR_INPUT_INVALID',
      }),
    );
    expect(() =>
      smaDefinition.outputSchema.parse({
        kind: 'scalar',
        values: [null, Number.NaN],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<IndicatorDomainError>>({
        code: 'INDICATOR_OUTPUT_INVALID',
      }),
    );
  });

  it('keeps every definition finite for large but valid values', () => {
    const input = fixtureInput({
      open: 1e100,
      high: 1e100,
      low: 1e100,
      close: 1e100,
      volume: 1e100,
    });
    const outputs = [
      calculateScalar(smaDefinition, input, { period: 3 }),
      calculateScalar(emaDefinition, input, { period: 3 }),
      calculateScalar(wmaDefinition, input, { period: 3 }),
      calculateScalar(rocDefinition, input, { period: 2 }),
      calculateScalar(momentumDefinition, input, { period: 2 }),
      calculateScalar(atrDefinition, input, { period: 3 }),
      calculateScalar(rsiDefinition, input, { period: 3 }),
      calculateScalar(obvDefinition, input, {}),
      calculateScalar(volumeSmaDefinition, input, { period: 3 }),
      calculateScalar(relativeVolumeDefinition, input, { period: 3 }),
    ];
    for (const output of outputs) {
      expect(
        output.values.every(
          (value) => value === null || Number.isFinite(value),
        ),
      ).toBe(true);
    }
  });
});

function calculateScalar<P>(
  definition: IndicatorDefinition<P, ScalarIndicatorOutput>,
  input: IndicatorInput,
  parameters: P,
): ScalarIndicatorOutput {
  return definition.calculate(input, parameters);
}

function assertInsufficient<P>(
  definition: IndicatorDefinition<P, ScalarIndicatorOutput>,
  rawParameters: unknown,
): void {
  const parameters = definition.parameterSchema.parse(rawParameters);
  const warmup = definition.getWarmup(parameters);
  const input = fixtureInput();
  expect(() =>
    validateIndicatorInput(
      { ...input, bars: input.bars.slice(0, warmup.minimumInputBars - 1) },
      definition.requiredInputFields,
      warmup,
    ),
  ).toThrowError(
    expect.objectContaining<Partial<IndicatorDomainError>>({
      code: 'INDICATOR_INPUT_TOO_SHORT',
    }),
  );
}
