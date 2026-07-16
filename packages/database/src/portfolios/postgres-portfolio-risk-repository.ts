import type {
  PortfolioRiskSnapshot,
  RiskSnapshotRepository,
} from '@atlas/domain';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { portfolioRiskExposures, portfolioRiskSnapshots } from '../schema';

export class PostgresPortfolioRiskRepository implements RiskSnapshotRepository {
  constructor(private readonly database: Database) {}

  async find(cacheKey: string) {
    const row = (
      await this.database
        .select()
        .from(portfolioRiskSnapshots)
        .where(
          sql`${portfolioRiskSnapshots.methodology}->>'cacheKey' = ${cacheKey}`,
        )
        .limit(1)
    )[0];
    return row ? hydrateSnapshot(row.methodology['snapshot']) : null;
  }

  async save(snapshot: PortfolioRiskSnapshot) {
    const existing = await this.find(snapshot.cacheKey);
    if (existing) return existing;
    const exposures = snapshot.concentration.value?.exposures ?? [];
    return this.database.transaction(async (tx) => {
      const row = (
        await tx
          .insert(portfolioRiskSnapshots)
          .values({
            portfolioId: snapshot.portfolioId,
            ledgerVersion: snapshot.ledgerVersion,
            valuationSeriesVersion: snapshot.valuationSeriesVersion,
            rangeStartAt: snapshot.rangeStartAt,
            rangeEndAt: snapshot.rangeEndAt,
            dataCutoffAt: snapshot.dataCutoffAt,
            benchmarkCode: snapshot.benchmarkCode,
            riskPolicyVersion: snapshot.riskPolicyVersion,
            status:
              snapshot.status === 'notEvaluable'
                ? 'not_evaluable'
                : snapshot.status,
            observationCount: snapshot.observationCount,
            volatility: metricValue(snapshot.volatility),
            beta: metricValue(snapshot.beta),
            maximumDrawdown:
              snapshot.drawdown.status === 'complete'
                ? (snapshot.drawdown.value?.maximumDrawdown ?? null)
                : null,
            historicalVar95: metricValue(snapshot.historicalVar95),
            historicalVar99: metricValue(snapshot.historicalVar99),
            expectedShortfall: metricValue(snapshot.expectedShortfall95),
            hhi:
              snapshot.concentration.status === 'complete'
                ? (snapshot.concentration.value?.hhi ?? null)
                : null,
            methodology: {
              cacheKey: snapshot.cacheKey,
              snapshot: serializeSnapshot(snapshot),
            },
            warnings: snapshot.warnings.map((code) => ({ code })),
          })
          .returning({ id: portfolioRiskSnapshots.id })
      )[0];
      if (!row) throw new Error('Risk snapshot insert invariant failed');
      if (snapshot.concentration.status === 'complete' && exposures.length > 0)
        await tx.insert(portfolioRiskExposures).values(
          exposures.map((exposure) => ({
            riskSnapshotId: row.id,
            portfolioId: snapshot.portfolioId,
            riskPolicyVersion: snapshot.riskPolicyVersion,
            exposureType: exposure.type,
            exposureKey: exposure.key,
            weight: exposure.weight,
            marketValue: exposure.marketValue,
            rank: exposure.rank,
          })),
        );
      return snapshot;
    });
  }

  async invalidatePortfolio(portfolioId: string, currentLedgerVersion: number) {
    const deleted = await this.database
      .delete(portfolioRiskSnapshots)
      .where(
        and(
          eq(portfolioRiskSnapshots.portfolioId, portfolioId),
          ne(portfolioRiskSnapshots.ledgerVersion, currentLedgerVersion),
        ),
      )
      .returning({ id: portfolioRiskSnapshots.id });
    return deleted.length;
  }
}

function metricValue(metric: PortfolioRiskSnapshot['volatility']) {
  return metric.status === 'complete' ? metric.value : null;
}

function serializeSnapshot(snapshot: PortfolioRiskSnapshot) {
  return {
    ...snapshot,
    rangeStartAt: snapshot.rangeStartAt.toISOString(),
    rangeEndAt: snapshot.rangeEndAt.toISOString(),
    dataCutoffAt: snapshot.dataCutoffAt.toISOString(),
  };
}

function hydrateSnapshot(value: unknown): PortfolioRiskSnapshot {
  if (!value || typeof value !== 'object')
    throw new Error('Persisted risk snapshot is invalid');
  const snapshot = value as Omit<
    PortfolioRiskSnapshot,
    'rangeStartAt' | 'rangeEndAt' | 'dataCutoffAt'
  > & {
    readonly rangeStartAt: string;
    readonly rangeEndAt: string;
    readonly dataCutoffAt: string;
  };
  return {
    ...snapshot,
    rangeStartAt: new Date(snapshot.rangeStartAt),
    rangeEndAt: new Date(snapshot.rangeEndAt),
    dataCutoffAt: new Date(snapshot.dataCutoffAt),
  };
}
