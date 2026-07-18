import type {
  ClosedBarSnapshotEvent,
  MarketSnapshotGenerationInput,
  MarketSnapshotRepository,
  MarketSnapshotStatus,
} from '@atlas/domain';
import { and, eq, lt, ne, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  marketOverviewSnapshots,
  marketRankSnapshots,
  sectorMarketSnapshots,
} from '../schema';

export class PostgresMarketSnapshotRepository implements MarketSnapshotRepository {
  constructor(private readonly database: Database) {}

  async upsertGeneration(input: MarketSnapshotGenerationInput) {
    return this.database.transaction(async (transaction) => {
      const inserted = (
        await transaction
          .insert(marketOverviewSnapshots)
          .values({
            generationId: input.generationId,
            marketCode: input.marketCode,
            timeframe: input.timeframe,
            universeVersion: input.universeVersion,
            policyVersion: input.policyVersion,
            dataCutoffAt: input.dataCutoffAt,
            sourceTimestamp: sourceTimestamp(input.overview.qualityMetadata),
            status: persistedStatus(input.overview.status),
            payload: { ...input.overview.payload },
            evaluatedCount: input.overview.evaluatedCount,
            excludedCount: input.overview.excludedCount,
            qualityMetadata: { ...input.overview.qualityMetadata },
          })
          .onConflictDoNothing({
            target: [
              marketOverviewSnapshots.marketCode,
              marketOverviewSnapshots.timeframe,
              marketOverviewSnapshots.universeVersion,
              marketOverviewSnapshots.dataCutoffAt,
              marketOverviewSnapshots.policyVersion,
            ],
          })
          .returning({ generationId: marketOverviewSnapshots.generationId })
      )[0];

      const existing = inserted
        ? null
        : (
            await transaction
              .select({ generationId: marketOverviewSnapshots.generationId })
              .from(marketOverviewSnapshots)
              .where(
                and(
                  eq(marketOverviewSnapshots.marketCode, input.marketCode),
                  eq(marketOverviewSnapshots.timeframe, input.timeframe),
                  eq(
                    marketOverviewSnapshots.universeVersion,
                    input.universeVersion,
                  ),
                  eq(marketOverviewSnapshots.dataCutoffAt, input.dataCutoffAt),
                  eq(
                    marketOverviewSnapshots.policyVersion,
                    input.policyVersion,
                  ),
                ),
              )
              .limit(1)
          )[0];
      const generationId = inserted?.generationId ?? existing?.generationId;
      if (!generationId)
        throw new Error('Market snapshot upsert invariant failed');

      if (input.sectors.length > 0)
        await transaction
          .insert(sectorMarketSnapshots)
          .values(
            input.sectors.map((sector) => ({
              generationId,
              marketCode: input.marketCode,
              timeframe: input.timeframe,
              policyVersion: input.policyVersion,
              dataCutoffAt: input.dataCutoffAt,
              sectorId: sector.sectorId,
              status: persistedStatus(sector.status),
              payload: { ...sector.payload },
              evaluatedCount: sector.evaluatedCount,
              excludedCount: sector.excludedCount,
              qualityMetadata: { ...sector.qualityMetadata },
            })),
          )
          .onConflictDoNothing();

      if (input.rankings.length > 0)
        await transaction
          .insert(marketRankSnapshots)
          .values(
            input.rankings.map((ranking) => ({
              generationId,
              marketCode: input.marketCode,
              timeframe: input.timeframe,
              policyVersion: input.policyVersion,
              dataCutoffAt: input.dataCutoffAt,
              rankingType: ranking.rankingType,
              instrumentId: ranking.instrumentId,
              rank: ranking.rank,
              sortValue: ranking.sortValue,
              status: persistedStatus(ranking.status),
              payload: { ...ranking.payload },
              evaluatedCount: ranking.evaluatedCount,
              excludedCount: ranking.excludedCount,
              qualityMetadata: { ...ranking.qualityMetadata },
            })),
          )
          .onConflictDoNothing();

      const [sectorCount, rankingCount] = await Promise.all([
        transaction.execute<{ count: string }>(sql`
          select count(*)::text as count
          from ${sectorMarketSnapshots}
          where ${sectorMarketSnapshots.generationId} = ${generationId}
        `),
        transaction.execute<{ count: string }>(sql`
          select count(*)::text as count
          from ${marketRankSnapshots}
          where ${marketRankSnapshots.generationId} = ${generationId}
        `),
      ]);

      return {
        generationId,
        created: inserted !== undefined,
        sectorCount: Number(sectorCount.rows[0]?.count ?? 0),
        rankingCount: Number(rankingCount.rows[0]?.count ?? 0),
      };
    });
  }

  async invalidateForClosedBar(event: ClosedBarSnapshotEvent) {
    const rows = await this.database
      .update(marketOverviewSnapshots)
      .set({ status: 'invalidated', invalidatedAt: event.dataCutoffAt })
      .where(
        and(
          eq(marketOverviewSnapshots.marketCode, event.marketCode),
          eq(marketOverviewSnapshots.timeframe, event.timeframe),
          lt(marketOverviewSnapshots.dataCutoffAt, event.dataCutoffAt),
          ne(marketOverviewSnapshots.status, 'invalidated'),
        ),
      )
      .returning({ id: marketOverviewSnapshots.id });
    return rows.length;
  }
}

function persistedStatus(status: MarketSnapshotStatus) {
  return status === 'notEvaluable' ? 'not_evaluable' : status;
}

function sourceTimestamp(metadata: Readonly<Record<string, unknown>>) {
  const value = metadata['sourceTimestamp'];
  if (typeof value !== 'string') return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}
