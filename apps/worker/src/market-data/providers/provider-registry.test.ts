import { describe, expect, it } from 'vitest';

import { ProviderError } from './errors';
import { ProviderRegistry } from './provider-registry';
import { FakeMarketDataProviderAdapter } from './testing/fake-market-data-provider';

const capabilities = {
  supportedTimeframes: ['1d'],
  dataMode: 'end-of-day',
  historicalDepthDays: 3650,
  supportsCorporateActions: false,
  supportsFundamentals: false,
  supportsPagination: true,
  rateLimit: { requests: 10, intervalMs: 1000 },
};

const instruments = [
  {
    providerSymbol: 'THYAO.IS',
    symbol: 'THYAO',
    name: 'Türk Hava Yolları A.O.',
    marketCode: 'BIST',
    currencyCode: 'try',
    isin: 'TRATHYAO91M5',
  },
];

const validBatch = {
  bars: [
    {
      providerSymbol: 'THYAO.IS',
      timeframe: '1d',
      openTime: '2026-07-10T07:00:00.000Z',
      closeTime: '2026-07-10T15:00:00.000Z',
      open: '100.10',
      high: '104.20',
      low: '99.80',
      close: '103.75',
      volume: '12345678',
      isClosed: true,
      sourceTimestamp: '2026-07-10T15:01:00.000Z',
    },
  ],
};

function createAdapter(
  overrides: Partial<{
    capabilities: unknown;
    instruments: unknown;
    barBatch: unknown;
  }> = {},
): FakeMarketDataProviderAdapter {
  return new FakeMarketDataProviderAdapter({
    capabilities: overrides.capabilities ?? capabilities,
    instruments: overrides.instruments ?? instruments,
    barBatch: overrides.barBatch ?? validBatch,
  });
}

describe('ProviderRegistry', () => {
  it('resolves a fake adapter by code and returns normalized instruments and bars', async () => {
    const registry = new ProviderRegistry();
    const adapter = createAdapter();
    registry.register(adapter);

    const provider = registry.resolve('fake-provider');
    const resultInstruments = await provider.listInstruments();
    const result = await provider.fetchBars({
      providerSymbol: 'THYAO.IS',
      timeframe: '1d',
      from: new Date('2026-07-10T00:00:00.000Z'),
      to: new Date('2026-07-11T00:00:00.000Z'),
    });

    expect(resultInstruments[0]).toMatchObject({
      currencyCode: 'TRY',
      providerSymbol: 'THYAO.IS',
      symbol: 'THYAO',
    });
    expect(result.bars[0]?.openTime).toEqual(
      new Date('2026-07-10T07:00:00.000Z'),
    );
    expect(result.bars[0]).not.toHaveProperty('providerCode');
    expect(adapter.fetchRequests).toHaveLength(1);
  });

  it('normalizes an unsupported timeframe without calling the adapter', async () => {
    const registry = new ProviderRegistry();
    const adapter = createAdapter();
    const provider = registry.register(adapter);

    await expect(
      provider.fetchBars({
        providerSymbol: 'THYAO.IS',
        timeframe: '1h',
        from: new Date('2026-07-10T00:00:00.000Z'),
        to: new Date('2026-07-11T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_UNSUPPORTED_TIMEFRAME',
      retryable: false,
    });
    expect(adapter.fetchRequests).toHaveLength(0);
  });

  it('rejects a malformed bar as a safe non-retryable provider error', async () => {
    const malformedBatch = {
      bars: [{ ...validBatch.bars[0], high: 'not-a-decimal' }],
    };
    const provider = new ProviderRegistry().register(
      createAdapter({ barBatch: malformedBatch }),
    );

    const promise = provider.fetchBars({
      providerSymbol: 'THYAO.IS',
      timeframe: '1d',
      from: new Date('2026-07-10T00:00:00.000Z'),
      to: new Date('2026-07-11T00:00:00.000Z'),
    });

    await expect(promise).rejects.toMatchObject({
      code: 'PROVIDER_MALFORMED_RESPONSE',
      message: 'Provider returned an invalid response',
      retryable: false,
    });
  });

  it('does not expose a raw adapter error message', async () => {
    const adapter = createAdapter();
    adapter.listInstruments = () =>
      Promise.reject(new Error('secret upstream response body'));
    const provider = new ProviderRegistry().register(adapter);

    const promise = provider.listInstruments();

    await expect(promise).rejects.toEqual(
      expect.objectContaining({
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Market data provider is unavailable',
        retryable: true,
      }),
    );
    await expect(promise).rejects.not.toThrow('secret upstream response body');
  });

  it('rejects unknown provider codes with the normalized taxonomy', () => {
    const registry = new ProviderRegistry();

    expect(() => registry.resolve('missing-provider')).toThrowError(
      expect.objectContaining<Partial<ProviderError>>({
        code: 'PROVIDER_NOT_REGISTERED',
        retryable: false,
      }),
    );
  });
});
