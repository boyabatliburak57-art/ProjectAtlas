import type {
  PortfolioPricePort,
  PortfolioValuationSnapshot,
  ValuationSnapshotRepository,
} from '@atlas/domain';
import { and, desc, eq, inArray, lte, ne } from 'drizzle-orm';
import type { Database } from '../client';
import {
  portfolioPositionSnapshots,
  portfolioValuationSnapshots,
  priceBars,
} from '../schema';

type Identity = Parameters<ValuationSnapshotRepository['findByIdentity']>[0];

export class PostgresPortfolioValuationRepository
  implements PortfolioPricePort, ValuationSnapshotRepository
{
  constructor(private readonly database: Database) {}

  async loadPrices(input: Parameters<PortfolioPricePort['loadPrices']>[0]) {
    if (input.instrumentIds.length === 0) return [];
    const rows = await this.database
      .select({
        instrumentId: priceBars.instrumentId,
        timeframe: priceBars.timeframe,
        close: priceBars.close,
        closeTime: priceBars.closeTime,
        isClosed: priceBars.isClosed,
      })
      .from(priceBars)
      .where(
        and(
          inArray(priceBars.instrumentId, [...input.instrumentIds]),
          lte(priceBars.closeTime, input.dataCutoffAt),
          input.mode === 'official' ? eq(priceBars.timeframe, '1d') : undefined,
        ),
      )
      .orderBy(desc(priceBars.closeTime), desc(priceBars.revision));
    return rows;
  }

  async findByIdentity(identity: Identity) {
    const row = (
      await this.database
        .select()
        .from(portfolioValuationSnapshots)
        .where(identityWhere(identity))
        .limit(1)
    )[0];
    if (!row) return null;
    const positions = await this.database
      .select()
      .from(portfolioPositionSnapshots)
      .where(eq(portfolioPositionSnapshots.valuationSnapshotId, row.id));
    return mapSnapshot(row, positions, identity.cacheKey);
  }

  async save(snapshot: PortfolioValuationSnapshot) {
    return this.database.transaction(async (tx) => {
      const existing = (
        await tx
          .select()
          .from(portfolioValuationSnapshots)
          .where(
            identityWhere({
              ...snapshot,
              cacheKey: snapshot.cacheKey,
            }),
          )
          .limit(1)
      )[0];
      if (existing) {
        const positions = await tx
          .select()
          .from(portfolioPositionSnapshots)
          .where(
            eq(portfolioPositionSnapshots.valuationSnapshotId, existing.id),
          );
        return mapSnapshot(existing, positions, snapshot.cacheKey);
      }
      const parent = (
        await tx
          .insert(portfolioValuationSnapshots)
          .values({
            portfolioId: snapshot.portfolioId,
            ledgerVersion: snapshot.ledgerVersion,
            valuationAt: snapshot.valuationAt,
            dataCutoffAt: snapshot.dataCutoffAt,
            pricePolicyVersion: snapshot.pricePolicyVersion,
            status: databaseStatus(snapshot.status),
            cashBalance: snapshot.cashBalance,
            positionsMarketValue: snapshot.positionsMarketValue,
            totalValue: snapshot.totalValue,
            realizedPnl: snapshot.realizedPnl,
            unrealizedPnl: snapshot.unrealizedPnl,
            netContributions: snapshot.netContributions,
            missingPriceCount: snapshot.missingPriceCount,
            warnings: snapshot.warnings,
          })
          .returning()
      )[0];
      if (!parent)
        throw new Error('Valuation snapshot insert invariant failed');
      if (snapshot.positions.length > 0)
        await tx.insert(portfolioPositionSnapshots).values(
          snapshot.positions.map((position) => ({
            valuationSnapshotId: parent.id,
            portfolioId: snapshot.portfolioId,
            instrumentId: position.instrumentId,
            ledgerVersion: snapshot.ledgerVersion,
            dataCutoffAt: snapshot.dataCutoffAt,
            pricePolicyVersion: snapshot.pricePolicyVersion,
            status: position.status,
            quantity: position.quantity,
            averageCost: position.averageCost,
            costBasis: position.costBasis,
            marketPrice: position.marketPrice,
            marketValue: position.marketValue,
            unrealizedPnl: position.unrealizedPnl,
            priceAt: position.priceAt,
            warningCode: position.warningCode,
          })),
        );
      return snapshot;
    });
  }

  async invalidatePortfolio(portfolioId: string, currentLedgerVersion: number) {
    const deleted = await this.database
      .delete(portfolioValuationSnapshots)
      .where(
        and(
          eq(portfolioValuationSnapshots.portfolioId, portfolioId),
          ne(portfolioValuationSnapshots.ledgerVersion, currentLedgerVersion),
        ),
      )
      .returning({ id: portfolioValuationSnapshots.id });
    return deleted.length;
  }
}

function identityWhere(identity: Identity) {
  return and(
    eq(portfolioValuationSnapshots.portfolioId, identity.portfolioId),
    eq(portfolioValuationSnapshots.ledgerVersion, identity.ledgerVersion),
    eq(portfolioValuationSnapshots.valuationAt, identity.valuationAt),
    eq(portfolioValuationSnapshots.dataCutoffAt, identity.dataCutoffAt),
    eq(
      portfolioValuationSnapshots.pricePolicyVersion,
      identity.pricePolicyVersion,
    ),
  );
}

function databaseStatus(status: PortfolioValuationSnapshot['status']) {
  return status === 'notEvaluable' ? 'not_evaluable' : status;
}

function mapSnapshot(
  row: typeof portfolioValuationSnapshots.$inferSelect,
  positions: readonly (typeof portfolioPositionSnapshots.$inferSelect)[],
  cacheKey: string,
): PortfolioValuationSnapshot {
  return {
    portfolioId: row.portfolioId,
    ledgerVersion: row.ledgerVersion,
    valuationAt: row.valuationAt,
    dataCutoffAt: row.dataCutoffAt,
    pricePolicyVersion: row.pricePolicyVersion,
    mode: 'official',
    persistable: true,
    status:
      row.status === 'not_evaluable'
        ? 'notEvaluable'
        : (row.status as 'complete' | 'partial'),
    cashBalance: row.cashBalance,
    positionsMarketValue: row.positionsMarketValue,
    totalValue: row.totalValue,
    realizedPnl: row.realizedPnl,
    unrealizedPnl: row.unrealizedPnl,
    netContributions: row.netContributions,
    missingPriceCount: row.missingPriceCount,
    warnings: row.warnings as PortfolioValuationSnapshot['warnings'],
    positions: positions.map((position) => ({
      instrumentId: position.instrumentId,
      status:
        position.status as PortfolioValuationSnapshot['positions'][number]['status'],
      quantity: position.quantity,
      averageCost: position.averageCost,
      costBasis: position.costBasis,
      marketPrice: position.marketPrice,
      marketValue: position.marketValue,
      unrealizedPnl: position.unrealizedPnl,
      priceAt: position.priceAt,
      warningCode:
        position.warningCode as PortfolioValuationSnapshot['positions'][number]['warningCode'],
    })),
    cacheKey,
  };
}
