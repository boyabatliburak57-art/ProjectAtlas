import { Decimal, parseLedgerDecimal } from './decimal.js';

export interface DailyPortfolioValue {
  readonly date: string;
  readonly value: string;
  readonly externalFlow: string;
  readonly dividendIncome?: string | undefined;
}

export type MetricResult =
  | { readonly status: 'complete'; readonly value: string }
  | { readonly status: 'notEvaluable'; readonly reason: string };

export interface XirrCashFlow {
  readonly at: Date;
  readonly amount: string;
}

export const PERFORMANCE_POLICY = {
  version: 'twr-xirr-v1',
  sameDayCashFlow: 'beginningOfDay',
  xirrDayConvention: 365,
  xirrTolerance: 1e-10,
  xirrMaximumIterations: 200,
  xirrMaximumRate: 1_000_000,
} as const;

export interface PortfolioPerformanceSnapshot {
  readonly portfolioId: string;
  readonly ledgerVersion: number;
  readonly rangeStartAt: Date;
  readonly rangeEndAt: Date;
  readonly dataCutoffAt: Date;
  readonly performancePolicyVersion: string;
  readonly benchmarkCode: string;
  readonly status: 'complete' | 'partial' | 'notEvaluable';
  readonly dailyValueSeries: readonly DailyPortfolioValue[];
  readonly netContributionSeries: readonly {
    readonly date: string;
    readonly value: string;
  }[];
  readonly twr: MetricResult;
  readonly xirr: MetricResult;
  readonly benchmark: ReturnType<typeof alignBenchmark>;
  readonly periodReturns: Readonly<Record<string, MetricResult>>;
  readonly cacheKey: string;
  readonly warnings: readonly string[];
}

export interface PerformanceSnapshotRepository {
  find(cacheKey: string): Promise<PortfolioPerformanceSnapshot | null>;
  save(
    snapshot: PortfolioPerformanceSnapshot,
  ): Promise<PortfolioPerformanceSnapshot>;
  invalidatePortfolio(
    portfolioId: string,
    currentLedgerVersion: number,
  ): Promise<number>;
}

export class PortfolioPerformanceService {
  constructor(private readonly snapshots?: PerformanceSnapshotRepository) {}

  async calculate(input: {
    readonly portfolioId: string;
    readonly ledgerVersion: number;
    readonly rangeStartAt: Date;
    readonly rangeEndAt: Date;
    readonly dataCutoffAt: Date;
    readonly benchmarkCode: string;
    readonly dailyValues: readonly DailyPortfolioValue[];
    readonly xirrCashFlows: readonly XirrCashFlow[];
    readonly benchmarkValues: readonly BenchmarkObservation[];
    readonly periods?: Readonly<Record<string, string>>;
  }): Promise<PortfolioPerformanceSnapshot> {
    const cacheKey = performanceCacheKey({
      ...input,
      policyVersion: PERFORMANCE_POLICY.version,
    });
    const cached = await this.snapshots?.find(cacheKey);
    if (cached) return cached;
    const dailyValueSeries = orderSeries(input.dailyValues);
    const twr = calculateTwr(dailyValueSeries);
    const xirr = calculateXirr(input.xirrCashFlows);
    const benchmark = alignBenchmark(dailyValueSeries, input.benchmarkValues);
    const periodReturns = calculatePeriodReturns(
      dailyValueSeries,
      input.periods ?? {},
    );
    let cumulative = Decimal.ZERO;
    const netContributionSeries = dailyValueSeries.map((point) => {
      cumulative = cumulative.plus(
        parseLedgerDecimal(point.externalFlow, 'externalFlow'),
      );
      return {
        date: point.date,
        value: cumulative.toDatabaseString('netContribution'),
      };
    });
    const failed = [twr.status, xirr.status, benchmark.status].filter(
      (status) => status === 'notEvaluable',
    ).length;
    const warnings = [
      ...(twr.status === 'notEvaluable' ? [`TWR_${twr.reason}`] : []),
      ...(xirr.status === 'notEvaluable' ? [`XIRR_${xirr.reason}`] : []),
      ...benchmark.warnings,
    ];
    const snapshot: PortfolioPerformanceSnapshot = {
      portfolioId: input.portfolioId,
      ledgerVersion: input.ledgerVersion,
      rangeStartAt: input.rangeStartAt,
      rangeEndAt: input.rangeEndAt,
      dataCutoffAt: input.dataCutoffAt,
      performancePolicyVersion: PERFORMANCE_POLICY.version,
      benchmarkCode: input.benchmarkCode,
      status:
        failed === 0 && benchmark.status === 'complete'
          ? 'complete'
          : failed === 3
            ? 'notEvaluable'
            : 'partial',
      dailyValueSeries,
      netContributionSeries,
      twr,
      xirr,
      benchmark,
      periodReturns,
      cacheKey,
      warnings,
    };
    return this.snapshots ? this.snapshots.save(snapshot) : snapshot;
  }

  invalidate(portfolioId: string, currentLedgerVersion: number) {
    return (
      this.snapshots?.invalidatePortfolio(portfolioId, currentLedgerVersion) ??
      Promise.resolve(0)
    );
  }
}

export function performanceCacheKey(input: {
  readonly portfolioId: string;
  readonly ledgerVersion: number;
  readonly rangeStartAt: Date;
  readonly rangeEndAt: Date;
  readonly dataCutoffAt: Date;
  readonly benchmarkCode: string;
  readonly policyVersion: string;
}): string {
  return [
    input.portfolioId,
    input.ledgerVersion,
    input.rangeStartAt.toISOString(),
    input.rangeEndAt.toISOString(),
    input.dataCutoffAt.toISOString(),
    input.policyVersion,
    input.benchmarkCode,
  ].join(':');
}

export function calculateTwr(
  series: readonly DailyPortfolioValue[],
): MetricResult {
  const ordered = orderSeries(series);
  if (ordered.length < 2)
    return { status: 'notEvaluable', reason: 'INSUFFICIENT_OBSERVATIONS' };
  let factor = Decimal.parse('1');
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (!previous || !current) continue;
    const start = parseLedgerDecimal(previous.value, 'value', {
      nonNegative: true,
    });
    const flow = parseLedgerDecimal(current.externalFlow, 'externalFlow');
    const denominator = start.plus(flow);
    if (denominator.isZero() || denominator.isNegative())
      return { status: 'notEvaluable', reason: 'NON_POSITIVE_CAPITAL' };
    const end = parseLedgerDecimal(current.value, 'value', {
      nonNegative: true,
    });
    const subperiodFactor = end.dividedBy(denominator);
    factor = factor.times(subperiodFactor);
  }
  return {
    status: 'complete',
    value: ratioString(factor.minus(Decimal.parse('1'))),
  };
}

export function calculateXirr(
  cashFlows: readonly XirrCashFlow[],
  policy = PERFORMANCE_POLICY,
): MetricResult {
  if (cashFlows.length < 2)
    return { status: 'notEvaluable', reason: 'INSUFFICIENT_CASH_FLOWS' };
  const ordered = [...cashFlows].sort(
    (left, right) => left.at.getTime() - right.at.getTime(),
  );
  let values: number[];
  try {
    values = ordered.map((flow) => safeFinancialNumber(flow.amount));
  } catch {
    return { status: 'notEvaluable', reason: 'VALUE_OUT_OF_RANGE' };
  }
  if (!values.some((value) => value < 0) || !values.some((value) => value > 0))
    return { status: 'notEvaluable', reason: 'CASH_FLOW_SIGNS_REQUIRED' };
  if (signChanges(values) > 1)
    return {
      status: 'notEvaluable',
      reason: 'AMBIGUOUS_MULTIPLE_SIGN_CHANGES',
    };
  const origin = ordered[0]?.at;
  if (!origin || Number.isNaN(origin.getTime()))
    return { status: 'notEvaluable', reason: 'INVALID_DATE' };
  const years = ordered.map((flow) => {
    const days = (flow.at.getTime() - origin.getTime()) / 86_400_000;
    return days / policy.xirrDayConvention;
  });
  if (years.some((year) => !Number.isFinite(year) || year < 0))
    return { status: 'notEvaluable', reason: 'INVALID_DATE' };
  const npv = (rate: number) =>
    values.reduce(
      (total, amount, index) =>
        total + amount / Math.pow(1 + rate, years[index] ?? 0),
      0,
    );
  let low = -0.999999999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (
    Number.isFinite(highValue) &&
    Math.sign(lowValue) === Math.sign(highValue) &&
    high < policy.xirrMaximumRate
  ) {
    high *= 10;
    highValue = npv(high);
  }
  if (
    !Number.isFinite(lowValue) ||
    !Number.isFinite(highValue) ||
    Math.sign(lowValue) === Math.sign(highValue)
  )
    return { status: 'notEvaluable', reason: 'NO_SOLUTION' };
  for (
    let iteration = 0;
    iteration < policy.xirrMaximumIterations;
    iteration += 1
  ) {
    const midpoint = (low + high) / 2;
    const value = npv(midpoint);
    if (!Number.isFinite(value))
      return { status: 'notEvaluable', reason: 'NUMERIC_FAILURE' };
    if (
      Math.abs(value) <= policy.xirrTolerance ||
      high - low <= policy.xirrTolerance
    )
      return { status: 'complete', value: finiteRate(midpoint) };
    if (Math.sign(value) === Math.sign(lowValue)) {
      low = midpoint;
      lowValue = value;
    } else {
      high = midpoint;
      highValue = value;
    }
  }
  return { status: 'notEvaluable', reason: 'MAXIMUM_ITERATIONS' };
}

export interface BenchmarkObservation {
  readonly date: string;
  readonly priceIndex: string;
  readonly totalReturnIndex?: string | null | undefined;
}

export function alignBenchmark(
  portfolioSeries: readonly DailyPortfolioValue[],
  benchmarkSeries: readonly BenchmarkObservation[],
) {
  const portfolioDates = new Set(portfolioSeries.map((point) => point.date));
  const benchmarkByDate = new Map(
    benchmarkSeries.map((point) => [point.date, point] as const),
  );
  const dates = [...portfolioDates]
    .filter((date) => benchmarkByDate.has(date))
    .sort();
  const missingDates = [...portfolioDates]
    .filter((date) => !benchmarkByDate.has(date))
    .sort();
  if (dates.length < 2)
    return {
      status: 'notEvaluable' as const,
      priceReturn: null,
      totalReturn: null,
      alignedDates: dates,
      warnings: ['MISSING_BENCHMARK_DATA'] as const,
    };
  const first = benchmarkByDate.get(dates[0] ?? '');
  const last = benchmarkByDate.get(dates.at(-1) ?? '');
  if (!first || !last) throw new Error('Benchmark alignment invariant failed');
  const priceReturn = returnBetween(first.priceIndex, last.priceIndex);
  const totalReturn =
    first.totalReturnIndex && last.totalReturnIndex
      ? returnBetween(first.totalReturnIndex, last.totalReturnIndex)
      : null;
  return {
    status: missingDates.length ? ('partial' as const) : ('complete' as const),
    priceReturn,
    totalReturn,
    alignedDates: dates,
    warnings: missingDates.length
      ? (['MISSING_BENCHMARK_DATA'] as const)
      : ([] as const),
  };
}

export function calculatePeriodReturns(
  series: readonly DailyPortfolioValue[],
  periods: Readonly<Record<string, string>>,
): Readonly<Record<string, MetricResult>> {
  const ordered = orderSeries(series);
  const end = ordered.at(-1);
  const result: Record<string, MetricResult> = {};
  for (const [name, startDate] of Object.entries(periods)) {
    const start = ordered.find((point) => point.date >= startDate);
    result[name] =
      !start || !end || start.date > end.date
        ? { status: 'notEvaluable', reason: 'MISSING_PERIOD_DATA' }
        : {
            status: 'complete',
            value: returnBetween(start.value, end.value),
          };
  }
  return result;
}

export function totalReturnSeries(
  series: readonly DailyPortfolioValue[],
): readonly DailyPortfolioValue[] {
  return series.map((point) => ({
    ...point,
    value: parseLedgerDecimal(point.value, 'value')
      .plus(parseLedgerDecimal(point.dividendIncome ?? '0', 'dividendIncome'))
      .toDatabaseString('totalReturnValue'),
  }));
}

function returnBetween(startValue: string, endValue: string): string {
  const start = parseLedgerDecimal(startValue, 'startValue', {
    positive: true,
  });
  const end = parseLedgerDecimal(endValue, 'endValue', { nonNegative: true });
  return ratioString(end.dividedBy(start).minus(Decimal.parse('1')));
}

function orderSeries(series: readonly DailyPortfolioValue[]) {
  return [...series].sort((left, right) => left.date.localeCompare(right.date));
}

function ratioString(value: Decimal): string {
  return value.toDatabaseString('ratio');
}

function safeFinancialNumber(value: string): number {
  const normalized = parseLedgerDecimal(value, 'cashFlow').toString();
  const number = Number(normalized);
  if (!Number.isFinite(number) || Math.abs(number) > 1e18)
    throw new Error('Financial value is outside solver bounds');
  return number;
}

function signChanges(values: readonly number[]): number {
  const signs = values.filter((value) => value !== 0).map(Math.sign);
  return signs
    .slice(1)
    .reduce((count, sign, index) => count + (sign !== signs[index] ? 1 : 0), 0);
}

function finiteRate(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Non-finite XIRR result');
  return value.toFixed(12).replace(/\.?0+$/, '');
}
