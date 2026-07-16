import { describe, expect, it } from 'vitest';
import type { DailyPortfolioValue } from './performance.js';
import {
  alignReturnSeries,
  annualizedVolatility,
  beta,
  buildReturnSeries,
  concentrationRisk,
  correlation,
  expectedShortfall,
  historicalVar,
  maximumDrawdown,
  PortfolioRiskApplicationService,
  RISK_POLICY,
  type PortfolioRiskSnapshot,
  type RiskSnapshotRepository,
} from './risk.js';

describe('pure portfolio risk fixtures', () => {
  it('1. returns zero annualized volatility for constant returns', () => {
    expect(annualizedVolatility([0.01, 0.01, 0.01], policy(2))).toMatchObject({
      status: 'complete',
      value: '0',
      observationCount: 3,
    });
  });
  it('2. calculates known sample volatility and annualizes it', () => {
    const result = annualizedVolatility([0.01, -0.01, 0.02, -0.02], policy(2));
    expect(Number(result.value)).toBeCloseTo(0.289827534924, 10);
  });
  it('3. aligns portfolio and benchmark only on exact dates', () => {
    const result = alignReturnSeries(
      [
        { date: '2026-01-02', value: 0.01 },
        { date: '2026-01-03', value: 0.02 },
      ],
      [
        { date: '2026-01-02', value: 0.03 },
        { date: '2026-01-04', value: 0.04 },
      ],
    );
    expect(result).toMatchObject({
      dates: ['2026-01-02'],
      portfolio: [0.01],
      benchmark: [0.03],
      warnings: ['MISSING_PORTFOLIO_DATES', 'MISSING_BENCHMARK_DATES'],
    });
  });
  it('4. calculates beta from aligned returns', () => {
    const benchmark = [-0.02, -0.01, 0, 0.01, 0.02];
    const result = beta(
      benchmark.map((value) => value * 2),
      benchmark,
      2,
    );
    expect(Number(result.value)).toBeCloseTo(2, 12);
  });
  it('5. marks beta notEvaluable for zero benchmark variance', () =>
    expect(beta([0.01, 0.02, 0.03], [0.01, 0.01, 0.01], 2)).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'ZERO_BENCHMARK_VARIANCE',
    }));
  it('6. calculates correlation fixture', () => {
    const result = correlation(
      [-0.02, -0.01, 0, 0.01, 0.02],
      [0.04, 0.02, 0, -0.02, -0.04],
      2,
    );
    expect(Number(result.value)).toBeCloseTo(-1, 12);
  });
  it('7. reports maximum drawdown peak, trough and recovery', () =>
    expect(maximumDrawdown(values([100, 120, 90, 120]))).toMatchObject({
      status: 'complete',
      value: {
        maximumDrawdown: '-0.25',
        currentDrawdown: '0',
        peakDate: '2026-01-02',
        troughDate: '2026-01-03',
        recoveryDate: '2026-01-04',
      },
    }));
  it('8. reports current unrecovered drawdown', () =>
    expect(maximumDrawdown(values([100, 120, 90, 100]))).toMatchObject({
      status: 'complete',
      value: {
        maximumDrawdown: '-0.25',
        currentDrawdown: '-0.166666666667',
        recoveryDate: null,
      },
    }));
  it('9. applies lower-tail nearest-rank Historical VaR 95', () =>
    expect(historicalVar(lossDistribution(), 0.95)).toMatchObject({
      status: 'complete',
      value: '0.02',
      warnings: ['HISTORICAL_VAR_IS_NOT_A_FORECAST'],
    }));
  it('10. applies lower-tail nearest-rank Historical VaR 99', () =>
    expect(historicalVar(lossDistribution(), 0.99)).toMatchObject({
      status: 'complete',
      value: '0.1',
    }));
  it('11. calculates Expected Shortfall beyond the 95% threshold', () =>
    expect(expectedShortfall(lossDistribution())).toMatchObject({
      status: 'complete',
      value: '0.06',
    }));
  it('12. enforces minimum history per metric', () =>
    expect(historicalVar([-0.1, 0.1], 0.95)).toMatchObject({
      status: 'notEvaluable',
      reasonCode: 'INSUFFICIENT_OBSERVATIONS',
      observationCount: 2,
    }));
  it('13. never inserts zero returns for missing dates', () => {
    const portfolio = buildReturnSeries([
      point('2026-01-01', 100),
      point('2026-01-03', 110),
    ]);
    const benchmark = buildReturnSeries([
      point('2026-01-01', 100),
      point('2026-01-02', 105),
      point('2026-01-03', 110),
    ]);
    const aligned = alignReturnSeries(portfolio.returns, benchmark.returns);
    expect(portfolio.returns).toHaveLength(1);
    expect(portfolio.returns[0]?.date).toBe('2026-01-03');
    expect(portfolio.returns[0]?.value).toBeCloseTo(0.1, 12);
    expect(aligned.observationCount).toBe(1);
    expect(aligned.warnings).toContain('MISSING_PORTFOLIO_DATES');
  });
  it('14. propagates stale input as a metric and snapshot warning', async () => {
    const snapshot = await service().calculate({
      ...riskInput(returnsSeries(102)),
      inputUpdatedAt: new Date('2025-01-01'),
    });
    expect(snapshot.warnings).toContain('STALE_INPUT');
    expect(snapshot.status).toBe('partial');
    expect(snapshot.volatility.warnings).toContain('STALE_INPUT');
  });
  it('15. calculates single-position concentration', () =>
    expect(
      concentrationRisk(
        [{ instrumentId: 'A', marketValue: '100', sectorId: 'S1' }],
        '0',
      ),
    ).toMatchObject({
      status: 'complete',
      value: {
        largestPositionWeight: '1',
        top3Weight: '1',
        top5Weight: '1',
        hhi: '1',
      },
    }));
  it('16. calculates multi-position HHI', () =>
    expect(
      concentrationRisk(
        [
          { instrumentId: 'A', marketValue: '40', sectorId: 'S1' },
          { instrumentId: 'B', marketValue: '30', sectorId: 'S1' },
          { instrumentId: 'C', marketValue: '20', sectorId: 'S2' },
          { instrumentId: 'D', marketValue: '10', sectorId: 'S3' },
        ],
        '0',
      ),
    ).toMatchObject({
      status: 'complete',
      value: { hhi: '0.3', top3Weight: '0.9' },
    }));
  it('17. aggregates sector concentration', () => {
    const result = concentrationRisk(
      [
        { instrumentId: 'A', marketValue: '40', sectorId: 'S1' },
        { instrumentId: 'B', marketValue: '30', sectorId: 'S1' },
        { instrumentId: 'C', marketValue: '30', sectorId: 'S2' },
      ],
      '0',
    );
    expect(result.value?.exposures).toContainEqual(
      expect.objectContaining({ type: 'sector', key: 'S1', weight: '0.7' }),
    );
  });
  it('18. exposes cash as a separate concentration category', () =>
    expect(
      concentrationRisk(
        [{ instrumentId: 'A', marketValue: '100', sectorId: 'S1' }],
        '100',
      ),
    ).toMatchObject({
      status: 'complete',
      value: { cashWeight: '0.5', hhi: '0.5' },
    }));
  it('19. preserves unknown sector as an explicit category', () => {
    const result = concentrationRisk(
      [
        { instrumentId: 'A', marketValue: '25', sectorId: null },
        { instrumentId: 'B', marketValue: '75', sectorId: 'S1' },
      ],
      '0',
    );
    expect(result.value?.unknownSectorWeight).toBe('0.25');
    expect(result.value?.exposures).toContainEqual(
      expect.objectContaining({
        type: 'sector',
        key: 'UNKNOWN',
        weight: '0.25',
      }),
    );
  });
  it('20. guards every public path from NaN and Infinity', () => {
    expect(annualizedVolatility([Number.NaN, 0], policy(1))).toMatchObject({
      status: 'notEvaluable',
      value: null,
      reasonCode: 'INVALID_INPUT',
    });
    expect(
      buildReturnSeries([
        { date: '2026-01-01', value: 'Infinity', externalFlow: '0' },
      ]),
    ).toMatchObject({ status: 'notEvaluable', returns: [] });
    expect(
      concentrationRisk(
        [{ instrumentId: 'A', marketValue: 'NaN', sectorId: null }],
        '0',
      ),
    ).toMatchObject({ status: 'notEvaluable', value: null });
  });
  it('21. versions cache identity and invalidates older ledger snapshots', async () => {
    const repository = new MemoryRiskRepository();
    const calculator = service(repository);
    const first = await calculator.calculate(riskInput(returnsSeries(102), 1));
    const second = await calculator.calculate(riskInput(returnsSeries(102), 2));
    expect(first.cacheKey).not.toBe(second.cacheKey);
    expect(await calculator.invalidate('portfolio', 2)).toBe(1);
  });
  it('22. produces deterministic output for identical input', async () => {
    const input = riskInput(returnsSeries(102));
    expect(await service().calculate(input)).toEqual(
      await service().calculate(input),
    );
  });
});

describe('risk performance fixtures', () => {
  it('calculates five years of daily observations within the baseline', async () => {
    const series = returnsSeries(1261);
    const started = performance.now();
    const snapshot = await service().calculate(riskInput(series));
    const duration = performance.now() - started;
    expect(snapshot.observationCount).toBe(1260);
    expect(snapshot.status).toBe('complete');
    expect(duration).toBeLessThan(2_000);
  });
  it('supports the largest numeric(28,10) position fixture without non-finite output', () => {
    const result = concentrationRisk(
      [
        {
          instrumentId: 'MAX',
          marketValue: '999999999999999999.9999999999',
          sectorId: 'MAX',
        },
      ],
      '0',
    );
    expect(result).toMatchObject({
      status: 'complete',
      value: { largestPositionWeight: '1', hhi: '1' },
    });
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });
  it('uses cache on repeated calculation', async () => {
    const repository = new MemoryRiskRepository();
    const calculator = service(repository);
    const input = riskInput(returnsSeries(102));
    const first = await calculator.calculate(input);
    const second = await calculator.calculate(input);
    expect(second).toEqual(first);
    expect(repository.saveCount).toBe(1);
    expect(repository.hitCount).toBe(1);
  });
});

function policy(minimumObservations: number) {
  return {
    methodologyVersion: RISK_POLICY.methodologyVersion,
    annualizationFactor: RISK_POLICY.annualizationFactor,
    minimumObservations,
  };
}
function lossDistribution() {
  return [
    -0.1,
    -0.08,
    -0.06,
    -0.04,
    -0.02,
    ...Array.from({ length: 95 }, () => 0.01),
  ];
}
function values(input: readonly number[]) {
  return input.map((value, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    value: String(value),
  }));
}
function point(date: string, value: number): DailyPortfolioValue {
  return { date, value: value.toFixed(10), externalFlow: '0' };
}
function returnsSeries(size: number): DailyPortfolioValue[] {
  let value = 100;
  return Array.from({ length: size }, (_, index) => {
    if (index > 0) value *= 1 + ((index % 11) - 5) / 1000;
    return point(
      new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
      value,
    );
  });
}
function riskInput(
  portfolioValues: readonly DailyPortfolioValue[],
  ledgerVersion = 1,
) {
  const benchmarkValues = portfolioValues.map((pointValue, index) => ({
    ...pointValue,
    value: (Number(pointValue.value) * (1 + ((index % 7) - 3) / 10000)).toFixed(
      10,
    ),
  }));
  return {
    portfolioId: 'portfolio',
    ledgerVersion,
    valuationSeriesVersion: 1,
    rangeStartAt: new Date(
      `${portfolioValues[0]?.date ?? '2020-01-01'}T00:00:00Z`,
    ),
    rangeEndAt: new Date(
      `${portfolioValues.at(-1)?.date ?? '2020-04-11'}T00:00:00Z`,
    ),
    dataCutoffAt: new Date('2030-01-01T00:00:00Z'),
    benchmarkCode: 'XU100',
    portfolioValues,
    benchmarkValues,
    positions: [
      { instrumentId: 'A', marketValue: '80', sectorId: 'S1' },
      { instrumentId: 'B', marketValue: '10', sectorId: null },
    ],
    cashValue: '10',
  };
}
function service(repository?: RiskSnapshotRepository) {
  return new PortfolioRiskApplicationService({
    ...(repository ? { repository } : {}),
    logger: { info: () => undefined },
  });
}

class MemoryRiskRepository implements RiskSnapshotRepository {
  private snapshots: PortfolioRiskSnapshot[] = [];
  saveCount = 0;
  hitCount = 0;
  find(cacheKey: string) {
    const value =
      this.snapshots.find((snapshot) => snapshot.cacheKey === cacheKey) ?? null;
    if (value) this.hitCount += 1;
    return Promise.resolve(value);
  }
  save(snapshot: PortfolioRiskSnapshot) {
    this.saveCount += 1;
    this.snapshots.push(snapshot);
    return Promise.resolve(snapshot);
  }
  invalidatePortfolio(portfolioId: string, currentLedgerVersion: number) {
    const before = this.snapshots.length;
    this.snapshots = this.snapshots.filter(
      (snapshot) =>
        snapshot.portfolioId !== portfolioId ||
        snapshot.ledgerVersion === currentLedgerVersion,
    );
    return Promise.resolve(before - this.snapshots.length);
  }
}
