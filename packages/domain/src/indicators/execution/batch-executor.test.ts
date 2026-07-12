import { describe, expect, it } from 'vitest';

import type {
  IndicatorCalculationResult,
  IndicatorInput,
} from '../contracts.js';
import { macdDefinition } from '../definitions/set-b-trend.js';
import { smaDefinition } from '../definitions/moving-averages.js';
import { IndicatorRegistry } from '../registry/index.js';
import {
  IndicatorBatchExecutor,
  createIndicatorCacheKey,
} from './batch-executor.js';
import type { BatchIndicatorRequest, IndicatorMetrics } from './contracts.js';
import { MemoryIndicatorResultCache } from './memory-result-cache.js';

class RecordingMetrics implements IndicatorMetrics {
  readonly values = new Map<string, number>();

  increment(metric: string, value = 1): void {
    this.values.set(metric, (this.values.get(metric) ?? 0) + value);
  }
}

function input(overrides: Partial<IndicatorInput> = {}): IndicatorInput {
  return {
    instrumentId: 'instrument-1',
    timeframe: '1d',
    adjustmentMode: 'raw',
    dataCutoffAt: new Date('2026-07-12T00:00:00.000Z'),
    bars: [10, 11, 12, 13, 14, 15].map((close, index) => ({
      timestamp: new Date(Date.UTC(2026, 6, index + 1)),
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100 + index,
      isClosed: true,
    })),
    ...overrides,
  };
}

function request(
  requestId: string,
  overrides: Partial<BatchIndicatorRequest> = {},
): BatchIndicatorRequest {
  return {
    requestId,
    indicatorCode: 'MACD',
    indicatorVersion: 1,
    parameters: { fastPeriod: 2, slowPeriod: 3, signalPeriod: 2 },
    input: input(),
    closedBarPolicy: 'closed-only',
    ...overrides,
  };
}

describe('IndicatorBatchExecutor', () => {
  it('calculates duplicate requests once, preserves request order and then hits cache', async () => {
    let calculations = 0;
    const countingMacd = {
      ...macdDefinition,
      calculate(
        inputValue: IndicatorInput,
        parameters: Parameters<typeof macdDefinition.calculate>[1],
      ) {
        calculations += 1;
        return macdDefinition.calculate(inputValue, parameters);
      },
    };
    const registry = new IndicatorRegistry()
      .register(countingMacd)
      .register(smaDefinition);
    const cache = new MemoryIndicatorResultCache();
    const metrics = new RecordingMetrics();
    const executor = new IndicatorBatchExecutor(registry, {
      cache,
      metrics,
      now: () => new Date('2026-07-13T00:00:00.000Z'),
    });

    const first = await executor.execute([
      request('request-1'),
      request('request-2', {
        parameters: { signalPeriod: 2, slowPeriod: 3, fastPeriod: 2 },
      }),
      request('request-3', {
        indicatorCode: 'SMA',
        parameters: { period: 3 },
      }),
    ]);

    expect(calculations).toBe(1);
    expect(first.warmup).toEqual({
      minimumInputBars: 4,
      recommendedWarmupBars: 4,
      firstValidIndex: 3,
    });
    expect(first.results.map(({ requestId }) => requestId)).toEqual([
      'request-1',
      'request-2',
      'request-3',
    ]);
    expect(first.results[0]).toMatchObject({
      status: 'success',
      cacheHit: false,
      deduplicated: false,
    });
    expect(first.results[1]).toMatchObject({
      status: 'success',
      cacheHit: false,
      deduplicated: true,
    });
    expect(metrics.values.get('indicator.batch.deduplicated')).toBe(1);
    expect(metrics.values.get('indicator.calculation.completed')).toBe(2);

    const second = await executor.execute([request('request-4')]);
    expect(calculations).toBe(1);
    expect(second.results[0]).toMatchObject({
      status: 'success',
      cacheHit: true,
    });
  });

  it('isolates lookup, parameter and calculation failures', async () => {
    const failing = {
      ...smaDefinition,
      code: 'FAIL',
      calculate() {
        throw new Error('internal detail must not escape');
      },
    };
    const executor = new IndicatorBatchExecutor(
      new IndicatorRegistry().register(smaDefinition).register(failing),
      {
        cache: new MemoryIndicatorResultCache(),
        metrics: new RecordingMetrics(),
      },
    );

    const report = await executor.execute([
      request('missing', { indicatorCode: 'UNKNOWN' }),
      request('invalid', {
        indicatorCode: 'SMA',
        parameters: { period: 1 },
      }),
      request('failure', {
        indicatorCode: 'FAIL',
        parameters: { period: 3 },
      }),
      request('success', {
        indicatorCode: 'SMA',
        parameters: { period: 3 },
      }),
    ]);

    expect(report.results).toMatchObject([
      { status: 'failure', error: { code: 'INDICATOR_NOT_FOUND' } },
      { status: 'failure', error: { code: 'INDICATOR_PARAMETERS_INVALID' } },
      { status: 'failure', error: { code: 'INDICATOR_CALCULATION_FAILED' } },
      { status: 'success' },
    ]);
    expect(JSON.stringify(report)).not.toContain('internal detail');
  });

  it('changes cache identity for cutoff, policy and bar data', () => {
    const baseline = request('baseline');
    const baselineKey = createIndicatorCacheKey(baseline);

    expect(
      createIndicatorCacheKey(
        request('cutoff', {
          input: input({ dataCutoffAt: new Date('2026-07-13T00:00:00.000Z') }),
        }),
      ),
    ).not.toBe(baselineKey);
    expect(
      createIndicatorCacheKey(
        request('policy', { closedBarPolicy: 'include-open' }),
      ),
    ).not.toBe(baselineKey);
    const changedBars = input().bars.map((bar, index) =>
      index === 5 ? { ...bar, close: 99 } : bar,
    );
    expect(
      createIndicatorCacheKey(
        request('data', { input: input({ bars: changedBars }) }),
      ),
    ).not.toBe(baselineKey);
  });
});

describe('MemoryIndicatorResultCache', () => {
  it('clones values at the cache boundary and clears entries', async () => {
    const values: (number | null)[] = [null, 1];
    const result: IndicatorCalculationResult = {
      output: { kind: 'scalar', values },
      metadata: {
        indicatorCode: 'TEST',
        indicatorVersion: 1,
        parameterHash: 'hash',
        instrumentId: 'instrument-1',
        timeframe: '1d',
        adjustmentMode: 'raw',
        dataCutoffAt: new Date('2026-07-12T00:00:00.000Z'),
        closedBarPolicy: 'closed-only',
        calculatedAt: new Date('2026-07-13T00:00:00.000Z'),
        firstValidIndex: 1,
      },
    };
    const cache = new MemoryIndicatorResultCache();
    await cache.set('key', result);
    values[1] = 99;

    expect((await cache.get('key'))?.output).toEqual({
      kind: 'scalar',
      values: [null, 1],
    });
    expect(cache.size).toBe(1);
    cache.clear();
    expect(await cache.get('key')).toBeNull();
  });
});
