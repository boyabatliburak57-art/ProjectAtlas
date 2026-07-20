import { backtestDataSnapshots, type Database } from '@atlas/database';
import type { BacktestTimelineEvent } from '@atlas/domain';
import { eq, sql } from 'drizzle-orm';

import type {
  BacktestResolvedDataSnapshot,
  BacktestWorkerSnapshotResolver,
} from './contracts';
import { BacktestWorkerError } from './errors';

export class PostgresBacktestSnapshotResolver implements BacktestWorkerSnapshotResolver {
  private readonly eventCache = new Map<
    string,
    Promise<readonly BacktestTimelineEvent[]>
  >();

  constructor(
    private readonly database: Database,
    private readonly maximumCachedSnapshots = 2,
  ) {}

  async resolve(input: {
    readonly snapshotId: string;
    readonly expectedHash: string;
  }): Promise<BacktestResolvedDataSnapshot> {
    const rows = await this.database
      .select()
      .from(backtestDataSnapshots)
      .where(eq(backtestDataSnapshots.id, input.snapshotId))
      .limit(1);
    const row = rows[0];
    if (row === undefined)
      throw new BacktestWorkerError('BACKTEST_SNAPSHOT_NOT_FOUND', false);
    if (row.snapshotHash !== input.expectedHash)
      throw new BacktestWorkerError('BACKTEST_SNAPSHOT_MISMATCH', false);
    if (row.coverageStatus === 'not_evaluable')
      throw new BacktestWorkerError('BACKTEST_SNAPSHOT_NOT_EVALUABLE', false);
    const events = await this.cachedEvents(
      `${row.id}:${row.snapshotHash}`,
      row.revisionManifest,
      row.dataCutoffAt,
    );
    return {
      id: row.id,
      hash: row.snapshotHash,
      dataCutoffAt: row.dataCutoffAt,
      events,
      qualityMetadata: row.qualityMetadata,
    };
  }

  private async cachedEvents(
    key: string,
    manifest: Readonly<Record<string, unknown>>,
    dataCutoffAt: Date,
  ): Promise<readonly BacktestTimelineEvent[]> {
    const cached = this.eventCache.get(key);
    if (cached !== undefined) {
      this.eventCache.delete(key);
      this.eventCache.set(key, cached);
      return cached;
    }
    const pending = this.resolveEvents(manifest, dataCutoffAt);
    this.eventCache.set(key, pending);
    while (this.eventCache.size > this.maximumCachedSnapshots) {
      const oldest = this.eventCache.keys().next().value;
      if (oldest === undefined) break;
      this.eventCache.delete(oldest);
    }
    try {
      return await pending;
    } catch (error: unknown) {
      if (this.eventCache.get(key) === pending) this.eventCache.delete(key);
      throw error;
    }
  }

  private async resolveEvents(
    manifest: Readonly<Record<string, unknown>>,
    dataCutoffAt: Date,
  ): Promise<readonly BacktestTimelineEvent[]> {
    if (Array.isArray(manifest.events))
      return manifest.events as readonly BacktestTimelineEvent[];
    if (manifest.kind !== 'price-bars-v1')
      throw new BacktestWorkerError('BACKTEST_SNAPSHOT_INVALID', false);
    const providerId = stringField(manifest, 'providerId');
    const timeframe = stringField(manifest, 'timeframe');
    const from = dateField(manifest, 'from');
    const to = dateField(manifest, 'to');
    const result = (await this.database.execute(sql`
      select
        selected.id,
        selected.instrument_id,
        selected.symbol,
        selected.close_time,
        selected.open,
        selected.high,
        selected.low,
        selected.close,
        selected.volume,
        selected.is_closed,
        selected.revision,
        selected.ingested_at
      from (
        select distinct on (pb.instrument_id, pb.open_time)
          pb.id,
          pb.instrument_id,
          instrument.symbol,
          pb.open_time,
          pb.close_time,
          pb.open,
          pb.high,
          pb.low,
          pb.close,
          pb.volume,
          pb.is_closed,
          pb.revision,
          pb.ingested_at
        from price_bars pb
        inner join instruments instrument on instrument.id = pb.instrument_id
        where pb.provider_id = ${providerId}::uuid
          and pb.timeframe = ${timeframe}
          and pb.open_time >= ${from}
          and pb.close_time <= ${to}
          and pb.ingested_at <= ${dataCutoffAt}
        order by pb.instrument_id, pb.open_time, pb.revision desc
      ) selected
      order by selected.close_time, selected.instrument_id
    `)) as unknown as { readonly rows: readonly PriceBarSnapshotRow[] };
    return result.rows.map((bar) => ({
      eventId: `price-bar-${bar.id}`,
      type: 'bar' as const,
      instrumentId: bar.instrument_id,
      symbol: bar.symbol,
      timestamp: timestamp(bar.close_time),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      isClosed: bar.is_closed,
      revision: String(bar.revision),
      revisionAvailableAt: timestamp(bar.ingested_at),
    }));
  }
}

interface PriceBarSnapshotRow {
  readonly id: string;
  readonly instrument_id: string;
  readonly symbol: string;
  readonly close_time: Date | string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  readonly is_closed: boolean;
  readonly revision: number;
  readonly ingested_at: Date | string;
}

function stringField(
  value: Readonly<Record<string, unknown>>,
  field: string,
): string {
  const result = value[field];
  if (typeof result !== 'string' || result.length === 0)
    throw new BacktestWorkerError('BACKTEST_SNAPSHOT_INVALID', false);
  return result;
}

function dateField(
  value: Readonly<Record<string, unknown>>,
  field: string,
): Date {
  const result = new Date(stringField(value, field));
  if (Number.isNaN(result.getTime()))
    throw new BacktestWorkerError('BACKTEST_SNAPSHOT_INVALID', false);
  return result;
}

function timestamp(value: Date | string): string {
  if (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  )
    return value;
  const result = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(result.getTime()))
    throw new BacktestWorkerError('BACKTEST_SNAPSHOT_INVALID', false);
  return result.toISOString();
}
