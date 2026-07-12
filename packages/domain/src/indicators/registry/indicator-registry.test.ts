import { describe, expect, it } from 'vitest';

import { smaDefinition } from '../definitions/moving-averages.js';
import { IndicatorDomainError } from '../errors.js';
import {
  createCoreIndicatorRegistry,
  DuplicateIndicatorDefinitionError,
  IndicatorRegistry,
} from './indicator-registry.js';

describe('IndicatorRegistry', () => {
  it('resolves exact code/version and distinguishes lookup failures', () => {
    const registry = new IndicatorRegistry().register(smaDefinition);

    expect(registry.resolve('SMA', 1).catalog.displayName).toBe(
      'Simple Moving Average',
    );
    expectCode(() => registry.resolve('UNKNOWN', 1), 'INDICATOR_NOT_FOUND');
    expectCode(() => registry.resolve('SMA', 2), 'INDICATOR_VERSION_NOT_FOUND');
  });

  it('rejects duplicate code/version registrations', () => {
    const registry = new IndicatorRegistry().register(smaDefinition);
    expect(() => registry.register(smaDefinition)).toThrowError(
      expect.objectContaining<Partial<DuplicateIndicatorDefinitionError>>({
        identifier: 'SMA@1',
      }),
    );
  });

  it('produces a sorted catalog with parameter and output metadata', () => {
    const catalog = createCoreIndicatorRegistry().catalog();

    expect(catalog).toHaveLength(20);
    expect(new Set(catalog.map(({ code }) => code)).size).toBe(20);
    expect(catalog.map(({ code }) => code)).toEqual(
      catalog.map(({ code }) => code).sort(),
    );
    const sma = catalog.find(({ code }) => code === 'SMA');
    const macd = catalog.find(({ code }) => code === 'MACD');
    expect(sma?.parameterMetadata).toMatchObject({ type: 'object' });
    expect(sma?.outputMetadata).toEqual({ type: 'scalar-series' });
    expect(macd?.parameterMetadata).toMatchObject({
      constraints: ['fastPeriod < slowPeriod'],
    });
    expect(macd?.outputMetadata).toEqual({
      type: 'multi-series',
      keys: ['macd', 'signal', 'histogram'],
    });
  });
});

function expectCode(action: () => unknown, code: IndicatorDomainError['code']) {
  expect(action).toThrowError(
    expect.objectContaining<Partial<IndicatorDomainError>>({ code }),
  );
}
