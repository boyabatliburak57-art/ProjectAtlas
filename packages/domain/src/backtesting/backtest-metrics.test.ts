import { describe, expect, it } from 'vitest';

import type {
  BacktestBenchmarkSeries,
  BacktestCurvePoint,
  BacktestFill,
  BacktestMetric,
  BacktestTrade,
} from './contracts.js';
import { BACKTEST_METRIC_POLICY, calculateBacktestMetrics } from './metrics.js';

const cutoff = '2026-01-01T23:59:59.000Z';

describe('backtest metrics remediation fixtures', () => {
  it('1. calculates a known annualized return', () => {
    const result = calculate({ equity: curve(['100', '110']) });
    expect(Number(result.metrics.annualizedReturn.value)).toBeCloseTo(0.1, 10);
  });

  it('2. calculates known sample annualized volatility', () => {
    const equity = cumulativeCurve([100, 101, 99.99, 101.9898]);
    const result = calculate({ equity });
    const expected = sampleDeviation([0.01, -0.01, 0.02]) * Math.sqrt(252);
    expect(Number(result.metrics.annualizedVolatility.value)).toBeCloseTo(
      expected,
      10,
    );
  });

  it('3. calculates a known Sharpe ratio with the versioned risk-free rate', () => {
    const returns = [0.01, -0.01, 0.02];
    const result = calculate({ equity: cumulativeReturns(returns) });
    const expected =
      (mean(returns) / sampleDeviation(returns)) * Math.sqrt(252);
    expect(Number(result.metrics.sharpeRatio.value)).toBeCloseTo(expected, 10);
  });

  it('4. marks Sharpe notEvaluable when volatility is zero', () => {
    const result = calculate({ equity: cumulativeReturns([0.01, 0.01]) });
    expect(result.metrics.sharpeRatio).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'ZERO_VOLATILITY',
    });
  });

  it('5. calculates known Sortino using a zero periodic downside target', () => {
    const returns = [0.02, -0.01, 0.01, -0.02];
    const result = calculate({ equity: cumulativeReturns(returns) });
    const downside = Math.sqrt(
      mean(returns.map((value) => Math.min(0, value) ** 2)),
    );
    expect(Number(result.metrics.sortinoRatio.value)).toBeCloseTo(
      (mean(returns) / downside) * Math.sqrt(252),
      10,
    );
  });

  it('6. marks Sortino notEvaluable when downside deviation is zero', () => {
    const result = calculate({ equity: cumulativeReturns([0.01, 0.02]) });
    expect(result.metrics.sortinoRatio).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'ZERO_DOWNSIDE_DEVIATION',
    });
  });

  it('7. calculates a known Calmar ratio', () => {
    const result = calculate({
      equity: curve(['100', '110']),
      drawdown: drawdown(['0', '-5']),
    });
    expect(Number(result.metrics.calmarRatio.value)).toBeCloseTo(2, 10);
  });

  it('8. marks Calmar notEvaluable when maximum drawdown is zero', () => {
    const result = calculate({ equity: curve(['100', '110']) });
    expect(result.metrics.calmarRatio).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'ZERO_DRAWDOWN',
    });
  });

  it('9. calculates mixed winning and losing net trade expectancy', () => {
    const result = calculate({ trades: [trade('100'), trade('-40')] });
    expect(result.metrics.expectancy).toMatchObject({
      status: 'complete',
      value: '30',
      observationCount: 2,
    });
  });

  it('10. marks zero closed-trade expectancy notEvaluable', () => {
    expect(calculate().metrics.expectancy).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'ZERO_CLOSED_TRADES',
    });
  });

  it('11. calculates known gross turnover from real fill notional', () => {
    const result = calculate({
      equity: curve(['100', '100']),
      fills: [
        fill('50'),
        fill('50'),
        { ...fill('999'), syntheticCorporateAction: true },
      ],
    });
    expect(result.metrics.turnover).toMatchObject({
      status: 'complete',
      value: '1',
      observationCount: 2,
    });
  });

  it('rejects benchmark cutoff and adjustment context mismatches', () => {
    const wrongAdjustment = {
      ...benchmark(['100', '110']),
      adjustmentMode: 'splitAdjusted' as const,
    };
    const wrongCutoff = {
      ...benchmark(['100', '110']),
      dataCutoffAt: '2026-01-02T23:59:59.000Z',
    };
    expect(
      calculate({ benchmark: wrongAdjustment }).metrics.benchmarkReturn,
    ).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'BENCHMARK_CONTEXT_MISMATCH',
    });
    expect(
      calculate({ benchmark: wrongCutoff }).metrics.benchmarkReturn,
    ).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'BENCHMARK_CONTEXT_MISMATCH',
    });
  });

  it('does not forward-fill missing benchmark boundary dates', () => {
    const result = calculate({
      benchmark: {
        ...benchmark(['100', '105']),
        points: [
          point('2025-01-02T15:00:00.000Z', '100'),
          point('2026-01-01T15:00:00.000Z', '105'),
        ],
      },
    });
    expect(result.metrics.benchmarkReturn).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'MISSING_BENCHMARK_DATES',
    });
  });

  it('12. reflects slippage notional and fee-reduced average equity in turnover', () => {
    const result = calculate({
      equity: curve(['100', '98']),
      fills: [fill('101', '2', '1'), fill('101', '2', '1')],
    });
    expect(Number(result.metrics.turnover.value)).toBeCloseTo(202 / 99, 10);
  });

  it('13. reports equal benchmark performance and zero excess return', () => {
    const result = calculate({ benchmark: benchmark(['100', '110']) });
    expect(result.metrics.benchmarkReturn.value).toBe('0.1');
    expect(result.metrics.excessReturn.value).toBe('0');
  });

  it('14. reports performance above benchmark', () => {
    const result = calculate({ benchmark: benchmark(['100', '105']) });
    expect(Number(result.metrics.excessReturn.value)).toBeCloseTo(0.05, 10);
  });

  it('15. reports performance below benchmark', () => {
    const result = calculate({ benchmark: benchmark(['100', '120']) });
    expect(Number(result.metrics.excessReturn.value)).toBeCloseTo(-0.1, 10);
  });

  it('16. marks a missing benchmark and excess return notEvaluable', () => {
    const result = calculate();
    expect(result.metrics.benchmarkReturn.reasonCode).toBe('MISSING_BENCHMARK');
    expect(result.metrics.excessReturn.reasonCode).toBe('MISSING_BENCHMARK');
  });

  it('17. marks a too-short backtest period notEvaluable', () => {
    const result = calculate({
      equity: [point('2025-01-01T15:00:00.000Z', '100')],
    });
    expect(result.metrics.annualizedReturn).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'INSUFFICIENT_OBSERVATIONS',
    });
  });

  it('18. contains no NaN or Infinity for invalid input', () => {
    const result = calculate({
      equity: [point('invalid-date', '100'), point('also-invalid', 'Infinity')],
    });
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/u);
    expect(result.metrics.totalReturn.status).toBe('notEvaluable');
  });

  it('19. serializes every versioned methodology decision', () => {
    const result = calculate();
    expect(result.methodology).toEqual(BACKTEST_METRIC_POLICY);
    expect(result.methodology).toMatchObject({
      returnConvention: 'simple-close-to-close',
      annualizationFactor: 252,
      annualizedReturnDayCount: 365,
      riskFreeRateAnnual: '0',
      standardDeviation: 'sample',
      downsideTargetPeriodic: '0',
      turnover: {
        approach: 'gross',
        annualized: false,
        syntheticCorporateActionFills: 'excluded',
      },
      benchmark: {
        adjustmentMode: 'same-as-strategy',
        dateAlignment: 'exact-date-intersection-no-forward-fill',
      },
    });
    const metrics = Object.values(result.metrics) as BacktestMetric[];
    for (const metric of metrics) {
      expect(['complete', 'notEvaluable']).toContain(metric.status);
      expect(typeof metric.observationCount).toBe('number');
      expect(metric.methodologyVersion).toBe(BACKTEST_METRIC_POLICY.version);
      expect(Array.isArray(metric.warnings)).toBe(true);
      expect(Object.hasOwn(metric, 'value')).toBe(true);
      expect(Object.hasOwn(metric, 'reasonCode')).toBe(true);
    }
  });
});

function calculate(
  overrides: {
    equity?: readonly BacktestCurvePoint[];
    drawdown?: readonly BacktestCurvePoint[];
    fills?: readonly BacktestFill[];
    trades?: readonly BacktestTrade[];
    benchmark?: BacktestBenchmarkSeries;
  } = {},
) {
  const equity = overrides.equity ?? curve(['100', '110']);
  return calculateBacktestMetrics({
    initialEquity: '100',
    endingEquity: equity.at(-1)?.value ?? '100',
    equityCurve: equity,
    drawdownCurve: overrides.drawdown ?? drawdown(['0', '0']),
    fills: overrides.fills ?? [],
    trades: overrides.trades ?? [],
    benchmark: overrides.benchmark,
    adjustmentMode: 'raw',
    dataCutoffAt: cutoff,
  });
}

function curve(values: readonly string[]): readonly BacktestCurvePoint[] {
  return values.map((value, index) =>
    point(`${2025 + index}-01-01T15:00:00.000Z`, value),
  );
}

function cumulativeCurve(values: readonly number[]) {
  return values.map((value, index) =>
    point(
      `2025-01-${String(index + 1).padStart(2, '0')}T15:00:00.000Z`,
      String(value),
    ),
  );
}

function cumulativeReturns(returns: readonly number[]) {
  const values = [100];
  for (const value of returns) values.push(values.at(-1)! * (1 + value));
  return cumulativeCurve(values);
}

function drawdown(values: readonly string[]) {
  return values.map((value, index) =>
    point(`${2025 + index}-01-01T15:00:00.000Z`, value),
  );
}

function benchmark(values: readonly string[]): BacktestBenchmarkSeries {
  return {
    code: 'XU100',
    adjustmentMode: 'raw',
    dataCutoffAt: cutoff,
    points: curve(values),
  };
}

function point(timestamp: string, value: string): BacktestCurvePoint {
  return { timestamp, value };
}

function fill(
  grossAmount: string,
  totalCosts = '0',
  slippageAmount = '0',
): BacktestFill {
  return {
    id: `fill-${grossAmount}-${totalCosts}-${slippageAmount}`,
    deduplicationKey: `key-${grossAmount}-${totalCosts}-${slippageAmount}`,
    orderIntentId: 'order',
    instrumentId: 'instrument',
    symbol: 'AAA',
    side: 'BUY',
    quantity: '1',
    requestedQuantity: '1',
    referencePrice: '100',
    price: grossAmount,
    grossAmount,
    slippageAmount,
    commission: totalCosts,
    fixedFee: '0',
    tax: '0',
    totalCosts,
    netCashEffect: `-${grossAmount}`,
    partial: false,
    signalAt: '2025-01-01T15:00:00.000Z',
    filledAt: '2025-01-02T15:00:00.000Z',
    reason: 'entry',
  };
}

function trade(realizedPnl: string): BacktestTrade {
  return {
    id: `trade-${realizedPnl}`,
    instrumentId: 'instrument',
    symbol: 'AAA',
    quantity: '1',
    entryPrice: '100',
    exitPrice: '100',
    openedAt: '2025-01-01T15:00:00.000Z',
    closedAt: '2025-01-02T15:00:00.000Z',
    realizedPnl,
    grossPnl: realizedPnl,
    totalCosts: '0',
    returnPercent: '0',
    exitReason: 'exit',
    entryFillId: 'entry',
    exitFillId: 'exit',
  };
}

function mean(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleDeviation(values: readonly number[]) {
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
      (values.length - 1),
  );
}
