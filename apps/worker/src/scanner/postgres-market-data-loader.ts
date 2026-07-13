import { currentPriceBars, instruments, type Database } from '@atlas/database';
import type { IndicatorPriceBar, IndicatorTimeframe } from '@atlas/domain';
import { and, asc, eq, inArray, lte } from 'drizzle-orm';

import type {
  ScannerMarketDataInstrument,
  ScannerMarketDataLoader,
  ScannerWarning,
} from './contracts';

export class PostgresScannerMarketDataLoader implements ScannerMarketDataLoader {
  constructor(private readonly database: Database) {}

  async load(
    input: Parameters<ScannerMarketDataLoader['load']>[0],
  ): Promise<readonly ScannerMarketDataInstrument[]> {
    if (input.instrumentIds.length === 0) return [];
    const instrumentRows = await this.database
      .select({ id: instruments.id, status: instruments.status })
      .from(instruments)
      .where(inArray(instruments.id, input.instrumentIds));
    const statuses = new Map(
      instrumentRows.map((row) => [row.id, row.status] as const),
    );

    const result: ScannerMarketDataInstrument[] = [];
    for (const instrumentId of input.instrumentIds) {
      const inputs = new Map<
        IndicatorTimeframe,
        import('@atlas/domain').IndicatorInput
      >();
      const warnings: ScannerWarning[] = [];
      for (const requirement of input.plan.dataRequirements) {
        const rows = await this.database
          .select()
          .from(currentPriceBars)
          .where(
            and(
              eq(currentPriceBars.instrumentId, instrumentId),
              eq(currentPriceBars.timeframe, requirement.timeframe),
              lte(currentPriceBars.closeTime, input.dataCutoffAt),
            ),
          )
          .orderBy(asc(currentPriceBars.openTime));
        const selected = rows.slice(-requirement.requiredBars);
        const bars: IndicatorPriceBar[] = selected.map((row) => ({
          timestamp: row.openTime,
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume),
          isClosed: row.isClosed,
        }));
        if (bars.length < requirement.requiredBars) {
          warnings.push({
            code: 'INSUFFICIENT_MARKET_DATA',
            message: `Required ${requirement.requiredBars} ${requirement.timeframe} bars, loaded ${bars.length}`,
          });
        }
        inputs.set(requirement.timeframe, {
          instrumentId,
          timeframe: requirement.timeframe,
          bars,
          adjustmentMode: 'raw',
          dataCutoffAt: input.dataCutoffAt,
        });
      }
      const volumes = [...inputs.values()]
        .flatMap(({ bars }) => bars.map(({ volume }) => volume))
        .filter((value): value is number => value !== null);
      result.push({
        instrumentId,
        inputs,
        marketFields: {
          marketCap: null,
          freeFloatMarketCap: null,
          averageVolume:
            volumes.length === 0
              ? null
              : volumes.reduce((sum, value) => sum + value, 0) / volumes.length,
          isIndexMember: false,
          isActive: statuses.get(instrumentId) === 'active',
        },
        warnings,
      });
    }
    return result;
  }
}
