import { Decimal, parseLedgerDecimal } from '../portfolio/decimal.js';
import type {
  BacktestBenchmarkSeries,
  BacktestCurvePoint,
  BacktestFill,
  BacktestMetric,
  BacktestMetricMethodology,
  BacktestMetricReasonCode,
  BacktestMetricSet,
  BacktestTrade,
} from './contracts.js';

export const BACKTEST_METRIC_POLICY: BacktestMetricMethodology = {
  version: 'backtest-metrics-v2',
  returnConvention: 'simple-close-to-close',
  annualizationFactor: 252,
  annualizedReturnDayCount: 365,
  riskFreeRateAnnual: '0',
  standardDeviation: 'sample',
  downsideTargetPeriodic: '0',
  turnover: {
    approach: 'gross',
    denominator: 'average-portfolio-equity',
    annualized: false,
    syntheticCorporateActionFills: 'excluded',
  },
  benchmark: {
    adjustmentMode: 'same-as-strategy',
    dateAlignment: 'exact-date-intersection-no-forward-fill',
    range: 'same-start-and-end',
    dataCutoff: 'same-as-backtest-snapshot',
  },
};

export interface BacktestMetricInput {
  readonly initialEquity: string;
  readonly endingEquity: string;
  readonly equityCurve: readonly BacktestCurvePoint[];
  readonly drawdownCurve: readonly BacktestCurvePoint[];
  readonly fills: readonly BacktestFill[];
  readonly trades: readonly BacktestTrade[];
  readonly benchmark?: BacktestBenchmarkSeries | undefined;
  readonly adjustmentMode: 'raw' | 'splitAdjusted' | 'totalReturnAdjusted';
  readonly dataCutoffAt?: string | undefined;
  readonly policy?: BacktestMetricMethodology | undefined;
}

export interface BacktestMetricCalculation {
  readonly metrics: BacktestMetricSet;
  readonly methodology: BacktestMetricMethodology;
  readonly benchmarkCurve: readonly BacktestCurvePoint[];
}

export function calculateBacktestMetrics(
  input: BacktestMetricInput,
): BacktestMetricCalculation {
  const policy = input.policy ?? BACKTEST_METRIC_POLICY;
  try {
    const initial = positive(input.initialEquity, 'initialEquity');
    const ending = nonNegative(input.endingEquity, 'endingEquity');
    const equity = normalizeCurve(input.equityCurve);
    const returns = buildSimpleReturns(equity);
    const totalReturn = complete(
      decimalRatio(ending.minus(initial), initial),
      Math.max(1, equity.length),
      policy,
    );
    const annualizedReturn = calculateAnnualizedReturn(
      initial,
      ending,
      equity,
      policy,
    );
    const annualizedVolatility = calculateVolatility(returns, policy);
    const sharpeRatio = calculateSharpe(returns, annualizedVolatility, policy);
    const sortinoRatio = calculateSortino(returns, policy);
    const maximumDrawdown = maximumDrawdownRatio(input.drawdownCurve);
    const calmarRatio = calculateCalmar(
      annualizedReturn,
      maximumDrawdown,
      policy,
    );
    const expectancy = calculateExpectancy(input.trades, policy);
    const profitFactor = calculateProfitFactor(input.trades, policy);
    const turnover = calculateTurnover(input.fills, equity, ending, policy);
    const benchmark = calculateBenchmark(input, equity, policy);
    const excessReturn =
      benchmark.metric.status === 'complete' &&
      totalReturn.status === 'complete'
        ? complete(
            finiteMetric(totalReturn).minus(finiteMetric(benchmark.metric)),
            benchmark.metric.observationCount,
            policy,
            benchmark.metric.warnings,
          )
        : notEvaluable(
            benchmark.metric.reasonCode ?? 'MISSING_BENCHMARK',
            benchmark.metric.observationCount,
            policy,
            benchmark.metric.warnings,
          );
    return {
      methodology: policy,
      benchmarkCurve: benchmark.curve,
      metrics: {
        totalReturn,
        annualizedReturn,
        annualizedVolatility,
        sharpeRatio,
        sortinoRatio,
        calmarRatio,
        expectancy,
        profitFactor,
        turnover,
        benchmarkReturn: benchmark.metric,
        excessReturn,
      },
    };
  } catch {
    const failed = notEvaluable('INVALID_INPUT', 0, policy);
    return {
      methodology: policy,
      benchmarkCurve: [],
      metrics: {
        totalReturn: failed,
        annualizedReturn: failed,
        annualizedVolatility: failed,
        sharpeRatio: failed,
        sortinoRatio: failed,
        calmarRatio: failed,
        expectancy: failed,
        profitFactor: failed,
        turnover: failed,
        benchmarkReturn: failed,
        excessReturn: failed,
      },
    };
  }
}

function calculateAnnualizedReturn(
  initial: Decimal,
  ending: Decimal,
  equity: readonly BacktestCurvePoint[],
  policy: BacktestMetricMethodology,
): BacktestMetric {
  if (equity.length < 2)
    return notEvaluable('INSUFFICIENT_OBSERVATIONS', equity.length, policy);
  const elapsedDays =
    (Date.parse(equity.at(-1)!.timestamp) - Date.parse(equity[0]!.timestamp)) /
    86_400_000;
  if (!Number.isFinite(elapsedDays) || elapsedDays < 1)
    return notEvaluable('PERIOD_TOO_SHORT', equity.length, policy);
  const ratio = safeNumber(ending.dividedBy(initial).toString());
  const value =
    Math.pow(ratio, policy.annualizedReturnDayCount / elapsedDays) - 1;
  return finiteComplete(value, equity.length, policy);
}

function calculateVolatility(
  returns: readonly number[],
  policy: BacktestMetricMethodology,
): BacktestMetric {
  if (returns.length < 2)
    return notEvaluable('INSUFFICIENT_OBSERVATIONS', returns.length, policy);
  return finiteComplete(
    sampleStandardDeviation(returns) * Math.sqrt(policy.annualizationFactor),
    returns.length,
    policy,
  );
}

function calculateSharpe(
  returns: readonly number[],
  volatility: BacktestMetric,
  policy: BacktestMetricMethodology,
): BacktestMetric {
  if (volatility.status !== 'complete') return volatility;
  const periodicDeviation = sampleStandardDeviation(returns);
  if (periodicDeviation === 0)
    return notEvaluable('ZERO_VOLATILITY', returns.length, policy);
  const annualRiskFree = safeNumber(policy.riskFreeRateAnnual);
  const periodicRiskFree =
    Math.pow(1 + annualRiskFree, 1 / policy.annualizationFactor) - 1;
  return finiteComplete(
    ((mean(returns) - periodicRiskFree) / periodicDeviation) *
      Math.sqrt(policy.annualizationFactor),
    returns.length,
    policy,
  );
}

function calculateSortino(
  returns: readonly number[],
  policy: BacktestMetricMethodology,
): BacktestMetric {
  if (returns.length < 2)
    return notEvaluable('INSUFFICIENT_OBSERVATIONS', returns.length, policy);
  const target = safeNumber(policy.downsideTargetPeriodic);
  const squaredDownside = returns.map((value) =>
    Math.pow(Math.min(0, value - target), 2),
  );
  const downsideDeviation = Math.sqrt(mean(squaredDownside));
  if (downsideDeviation === 0)
    return notEvaluable('ZERO_DOWNSIDE_DEVIATION', returns.length, policy);
  return finiteComplete(
    ((mean(returns) - target) / downsideDeviation) *
      Math.sqrt(policy.annualizationFactor),
    returns.length,
    policy,
  );
}

function calculateCalmar(
  annualizedReturn: BacktestMetric,
  maximumDrawdown: number,
  policy: BacktestMetricMethodology,
): BacktestMetric {
  if (annualizedReturn.status !== 'complete') return annualizedReturn;
  if (maximumDrawdown === 0)
    return notEvaluable(
      'ZERO_DRAWDOWN',
      annualizedReturn.observationCount,
      policy,
    );
  return finiteComplete(
    safeNumber(annualizedReturn.value!) / maximumDrawdown,
    annualizedReturn.observationCount,
    policy,
  );
}

function calculateExpectancy(
  trades: readonly BacktestTrade[],
  policy: BacktestMetricMethodology,
): BacktestMetric {
  if (trades.length === 0) return notEvaluable('ZERO_CLOSED_TRADES', 0, policy);
  const total = trades.reduce(
    (sum, trade) => sum.plus(Decimal.parse(trade.realizedPnl)),
    Decimal.ZERO,
  );
  return complete(
    total.dividedBy(Decimal.parse(String(trades.length))),
    trades.length,
    policy,
  );
}

function calculateProfitFactor(
  trades: readonly BacktestTrade[],
  policy: BacktestMetricMethodology,
): BacktestMetric {
  if (trades.length === 0) return notEvaluable('ZERO_CLOSED_TRADES', 0, policy);
  let profit = Decimal.ZERO;
  let loss = Decimal.ZERO;
  for (const trade of trades) {
    const pnl = Decimal.parse(trade.realizedPnl);
    if (pnl.compare(Decimal.ZERO) > 0) profit = profit.plus(pnl);
    if (pnl.compare(Decimal.ZERO) < 0) loss = loss.minus(pnl);
  }
  if (loss.isZero()) return notEvaluable('ZERO_LOSSES', trades.length, policy);
  return complete(profit.dividedBy(loss), trades.length, policy);
}

function calculateTurnover(
  fills: readonly BacktestFill[],
  equity: readonly BacktestCurvePoint[],
  endingEquity: Decimal,
  policy: BacktestMetricMethodology,
): BacktestMetric {
  const included = fills.filter((fill) => !fill.syntheticCorporateAction);
  const notional = included.reduce(
    (sum, fill) => sum.plus(nonNegative(fill.grossAmount, 'grossAmount')),
    Decimal.ZERO,
  );
  const values =
    equity.length === 0
      ? [endingEquity]
      : equity.map((point) => nonNegative(point.value, 'equity'));
  const average = values
    .reduce((sum, value) => sum.plus(value), Decimal.ZERO)
    .dividedBy(Decimal.parse(String(values.length)));
  if (average.isZero())
    return notEvaluable('NON_POSITIVE_CAPITAL', values.length, policy);
  return complete(notional.dividedBy(average), included.length, policy);
}

function calculateBenchmark(
  input: BacktestMetricInput,
  equity: readonly BacktestCurvePoint[],
  policy: BacktestMetricMethodology,
): {
  readonly metric: BacktestMetric;
  readonly curve: readonly BacktestCurvePoint[];
} {
  const benchmark = input.benchmark;
  if (!benchmark)
    return {
      metric: notEvaluable('MISSING_BENCHMARK', 0, policy),
      curve: [],
    };
  if (
    benchmark.code.trim().length === 0 ||
    benchmark.adjustmentMode !== input.adjustmentMode ||
    (input.dataCutoffAt !== undefined &&
      benchmark.dataCutoffAt !== input.dataCutoffAt)
  )
    return {
      metric: notEvaluable('BENCHMARK_CONTEXT_MISMATCH', 0, policy),
      curve: [],
    };
  const curve = normalizeCurve(benchmark.points);
  if (equity.length < 2 || curve.length < 2)
    return {
      metric: notEvaluable('MISSING_BENCHMARK', curve.length, policy),
      curve,
    };
  const byTimestamp = new Map(curve.map((point) => [point.timestamp, point]));
  const aligned = equity
    .map((point) => byTimestamp.get(point.timestamp))
    .filter((point): point is BacktestCurvePoint => point !== undefined);
  const sameRange =
    aligned[0]?.timestamp === equity[0]?.timestamp &&
    aligned.at(-1)?.timestamp === equity.at(-1)?.timestamp;
  if (!sameRange || aligned.length < 2)
    return {
      metric: notEvaluable('MISSING_BENCHMARK_DATES', aligned.length, policy),
      curve: aligned,
    };
  const first = positive(aligned[0]!.value, 'benchmark.start');
  const last = positive(aligned.at(-1)!.value, 'benchmark.end');
  const warnings =
    aligned.length === equity.length ? [] : ['MISSING_BENCHMARK_DATES'];
  return {
    metric: complete(
      last.dividedBy(first).minus(Decimal.parse('1')),
      aligned.length,
      policy,
      warnings,
    ),
    curve: aligned,
  };
}

function normalizeCurve(
  points: readonly BacktestCurvePoint[],
): readonly BacktestCurvePoint[] {
  const ordered = [...points].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const seen = new Set<string>();
  for (const point of ordered) {
    if (
      !Number.isFinite(Date.parse(point.timestamp)) ||
      seen.has(point.timestamp)
    )
      throw new Error('INVALID_CURVE');
    seen.add(point.timestamp);
    nonNegative(point.value, 'curve.value');
  }
  return ordered;
}

function buildSimpleReturns(points: readonly BacktestCurvePoint[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = positive(points[index - 1]!.value, 'previousEquity');
    const current = nonNegative(points[index]!.value, 'currentEquity');
    returns.push(
      safeNumber(
        current.dividedBy(previous).minus(Decimal.parse('1')).toString(),
      ),
    );
  }
  return returns;
}

function maximumDrawdownRatio(points: readonly BacktestCurvePoint[]): number {
  if (points.length === 0) return 0;
  return Math.max(
    0,
    ...points.map((point) => Math.abs(safeNumber(point.value)) / 100),
  );
}

function sampleStandardDeviation(values: readonly number[]): number {
  const average = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) /
      (values.length - 1),
  );
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finiteMetric(metric: BacktestMetric): Decimal {
  if (metric.value === null) throw new Error('METRIC_NOT_COMPLETE');
  return Decimal.parse(metric.value);
}

function finiteComplete(
  value: number,
  observationCount: number,
  policy: BacktestMetricMethodology,
): BacktestMetric {
  if (!Number.isFinite(value))
    return notEvaluable('INVALID_INPUT', observationCount, policy);
  return complete(Decimal.parse(formatFinite(value)), observationCount, policy);
}

function complete(
  value: Decimal,
  observationCount: number,
  policy: BacktestMetricMethodology,
  warnings: readonly string[] = [],
): BacktestMetric {
  return {
    value: value.toDatabaseString('backtestMetric'),
    status: 'complete',
    reasonCode: null,
    observationCount,
    methodologyVersion: policy.version,
    warnings,
  };
}

function notEvaluable(
  reasonCode: BacktestMetricReasonCode,
  observationCount: number,
  policy: BacktestMetricMethodology,
  warnings: readonly string[] = [],
): BacktestMetric {
  return {
    value: null,
    status: 'notEvaluable',
    reasonCode,
    observationCount,
    methodologyVersion: policy.version,
    warnings,
  };
}

function decimalRatio(numerator: Decimal, denominator: Decimal): Decimal {
  if (denominator.isZero()) throw new Error('DIVISION_BY_ZERO');
  return numerator.dividedBy(denominator);
}

function positive(value: string, field: string): Decimal {
  return parseLedgerDecimal(value, field, { positive: true });
}

function nonNegative(value: string, field: string): Decimal {
  return parseLedgerDecimal(value, field, { nonNegative: true });
}

function safeNumber(value: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1e18)
    throw new Error('NON_FINITE_INPUT');
  return number;
}

function formatFinite(value: number): string {
  if (!Number.isFinite(value)) throw new Error('NON_FINITE_RESULT');
  const normalized = value.toFixed(12).replace(/\.?0+$/, '');
  return normalized === '-0' || normalized === '' ? '0' : normalized;
}
