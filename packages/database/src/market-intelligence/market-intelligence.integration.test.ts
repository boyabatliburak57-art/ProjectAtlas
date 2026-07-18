import { randomUUID } from 'node:crypto';

import type {
  ClosedBarSnapshotEvent,
  MarketSnapshotGenerationInput,
  MarketSnapshotRebuildPort,
} from '@atlas/domain';
import { MarketSnapshotGenerationService } from '@atlas/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../client';
import { runMigrations } from '../migration';
import { PostgresMarketSnapshotRepository } from './postgres-market-snapshot-repository';

function requireTestDatabaseUrl(): string {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  if (!databaseUrl)
    throw new Error('TEST_DATABASE_URL is required for integration tests');
  if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test'))
    throw new Error('TEST_DATABASE_URL database name must end with _test');
  return databaseUrl;
}

const tables = [
  'market_overview_snapshots',
  'sector_market_snapshots',
  'market_rank_snapshots',
  'fundamental_statement_snapshots',
  'fundamental_metric_snapshots',
  'fundamental_ratio_snapshots',
  'pattern_definitions',
  'pattern_instances',
] as const;

describe('PostgreSQL market intelligence persistence and read models', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  const rebuild = new RecordingRebuildPort();
  const repository = new PostgresMarketSnapshotRepository(db);
  const service = new MarketSnapshotGenerationService(repository, rebuild);
  let providerId = '';
  let sectorA = '';
  let sectorB = '';
  let sectorC = '';
  let instrumentA = '';
  let instrumentB = '';

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);

    providerId = (
      await pool.query<{ id: string }>(`
        insert into data_providers (code, name, status)
        values ('market-intelligence-fixture', 'Market Intelligence Fixture', 'active')
        returning id
      `)
    ).rows[0]!.id;
    sectorA = (
      await pool.query<{ id: string }>(`
        insert into sectors (code, name) values ('MI-A', 'Market Intelligence A') returning id
      `)
    ).rows[0]!.id;
    sectorB = (
      await pool.query<{ id: string }>(`
        insert into sectors (code, name) values ('MI-B', 'Market Intelligence B') returning id
      `)
    ).rows[0]!.id;
    sectorC = (
      await pool.query<{ id: string }>(`
        insert into sectors (code, name) values ('MI-C', 'Market Intelligence C') returning id
      `)
    ).rows[0]!.id;
    instrumentA = await insertInstrument('MIA', sectorA);
    instrumentB = await insertInstrument('MIB', sectorB);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('clean-migrates the eight DB-007 tables with timestamptz time columns', async () => {
    const migrated = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name = any($1::text[])
       order by table_name`,
      [tables],
    );
    expect(migrated.rows.map(({ table_name }) => table_name)).toEqual(
      [...tables].sort(),
    );

    const timeColumns = await pool.query<{ data_type: string }>(
      `select data_type from information_schema.columns
       where table_schema = 'public' and table_name = any($1::text[])
         and (column_name like '%\\_at' escape '\\'
           or column_name like '%\\_time' escape '\\'
           or column_name in ('period_start', 'period_end'))`,
      [tables],
    );
    expect(timeColumns.rows.length).toBeGreaterThan(0);
    expect(new Set(timeColumns.rows.map(({ data_type }) => data_type))).toEqual(
      new Set(['timestamp with time zone']),
    );
  });

  it('upserts one generation idempotently with consistent sector and ranking rows', async () => {
    const input = generationFixture('2026-07-17T15:00:00.000Z');
    const first = await service.generate(input);
    const replay = await service.generate(input);

    expect(first).toEqual({
      generationId: input.generationId,
      created: true,
      sectorCount: 2,
      rankingCount: 2,
    });
    expect(replay).toEqual({ ...first, created: false });
    const counts = await pool.query<{
      overview_count: string;
      sector_count: string;
      rank_count: string;
    }>(
      `select
         (select count(*) from market_overview_snapshots where generation_id = $1)::text as overview_count,
         (select count(*) from sector_market_snapshots where generation_id = $1)::text as sector_count,
         (select count(*) from market_rank_snapshots where generation_id = $1)::text as rank_count`,
      [input.generationId],
    );
    expect(counts.rows[0]).toEqual({
      overview_count: '1',
      sector_count: '2',
      rank_count: '2',
    });
  });

  it('enforces snapshot identity and generation context constraints', async () => {
    const input = generationFixture('2026-07-16T15:00:00.000Z');
    await service.generate(input);
    await expect(
      pool.query(
        `insert into market_overview_snapshots
          (market_code, timeframe, universe_version, generation_id,
           policy_version, data_cutoff_at, status)
         values ('BIST', '1d', 'bist-active-v1', $1, 'market-overview-v1', $2, 'complete')`,
        [randomUUID(), input.dataCutoffAt],
      ),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      pool.query(
        `insert into sector_market_snapshots
          (market_code, timeframe, generation_id, policy_version,
           data_cutoff_at, sector_id, status)
         values ('BIST', '1d', $1, 'wrong-policy', $2, $3, 'complete')`,
        [input.generationId, input.dataCutoffAt, sectorC],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects duplicate ranking positions and instruments', async () => {
    const input = generationFixture('2026-07-15T15:00:00.000Z');
    await service.generate(input);
    const values = [input.generationId, input.dataCutoffAt, instrumentB];
    await expect(
      pool.query(
        `insert into market_rank_snapshots
          (market_code, timeframe, generation_id, policy_version,
           data_cutoff_at, ranking_type, instrument_id, rank, sort_value, status)
         values ('BIST', '1d', $1, 'market-overview-v1', $2,
                 'gainers', $3, 1, '1.0', 'complete')`,
        values,
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('preserves provider restatements as immutable revisions', async () => {
    const context = statementContext();
    const revisionOne = await insertStatement(context, 'provider-rev-1');
    const revisionTwo = await insertStatement(
      { ...context, generationId: randomUUID() },
      'provider-rev-2',
    );
    expect(revisionOne.id).not.toBe(revisionTwo.id);
    const revisions = await pool.query<{ provider_revision: string }>(
      `select provider_revision from fundamental_statement_snapshots
       where instrument_id = $1 and statement_type = 'income'
         and fiscal_year = 2025 and fiscal_period = 'FY'
       order by provider_revision`,
      [instrumentA],
    );
    expect(
      revisions.rows.map(({ provider_revision }) => provider_revision),
    ).toEqual(['provider-rev-1', 'provider-rev-2']);
    await expect(
      pool.query(
        `update fundamental_statement_snapshots
         set provider_revision = 'overwritten' where id = $1`,
        [revisionOne.id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      insertStatement(context, 'provider-rev-1'),
    ).rejects.toMatchObject({
      code: '23505',
    });
  });

  it('stores a missing fundamental metric as null and rejects numeric zero', async () => {
    const context = statementContext();
    const statement = await insertStatement(context, `missing-${randomUUID()}`);
    await pool.query(
      `insert into fundamental_metric_snapshots
        (statement_snapshot_id, generation_id, policy_version, data_cutoff_at,
         metric_code, value, status, reason_code)
       values ($1, $2, $3, $4, 'ebitda', null, 'missing', 'SOURCE_FIELD_MISSING')`,
      [
        statement.id,
        context.generationId,
        context.policyVersion,
        context.dataCutoffAt,
      ],
    );
    const metric = await pool.query<{ value: string | null }>(
      `select value from fundamental_metric_snapshots
       where statement_snapshot_id = $1 and metric_code = 'ebitda'`,
      [statement.id],
    );
    expect(metric.rows[0]?.value).toBeNull();
    await expect(
      pool.query(
        `insert into fundamental_metric_snapshots
          (statement_snapshot_id, generation_id, policy_version, data_cutoff_at,
           metric_code, value, status, reason_code)
         values ($1, $2, $3, $4, 'free_cash_flow', '0', 'missing', 'SOURCE_FIELD_MISSING')`,
        [
          statement.id,
          context.generationId,
          context.policyVersion,
          context.dataCutoffAt,
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('versions ratio formula identity without overwriting prior results', async () => {
    const values = [instrumentA, randomUUID(), '2026-07-17T15:00:00.000Z'];
    const insert = `insert into fundamental_ratio_snapshots
      (instrument_id, generation_id, policy_version, data_cutoff_at,
       ratio_code, formula_version, fiscal_period_reference, value, status)
      values ($1, $2, 'fundamentals-v1', $3, 'pe', $4, '2025-FY', '8.25', 'complete')`;
    await pool.query(insert, [...values, 'pe-v1']);
    await expect(
      pool.query(insert, [...values, 'pe-v1']),
    ).rejects.toMatchObject({
      code: '23505',
    });
    await pool.query(insert, [instrumentA, randomUUID(), values[2], 'pe-v2']);
    const versions = await pool.query<{ count: string }>(
      `select count(*)::text as count from fundamental_ratio_snapshots
       where instrument_id = $1 and ratio_code = 'pe'`,
      [instrumentA],
    );
    expect(versions.rows[0]?.count).toBe('2');
  });

  it('deduplicates pattern instances while keeping algorithm versions distinct', async () => {
    await pool.query(
      `insert into pattern_definitions
        (code, version, algorithm_version, category, evidence_schema_version, status)
       values ('double_top', 1, 'double-top-v1', 'geometric', 1, 'active'),
              ('double_top', 2, 'double-top-v2', 'geometric', 2, 'active')`,
    );
    const insert = `insert into pattern_instances
      (instrument_id, timeframe, adjustment_mode, pattern_code,
       pattern_version, algorithm_version, state, direction, start_time,
       end_time, detected_at, data_cutoff_at, evidence_version, evidence,
       deduplication_key)
      values ($1, '1d', 'split_adjusted', 'double_top', $2, $3,
              'candidate', 'bearish', '2026-07-01T15:00:00Z',
              '2026-07-10T15:00:00Z', '2026-07-10T15:00:00Z',
              '2026-07-10T15:00:00Z', $4, $5::jsonb, $6)`;
    await pool.query(insert, [
      instrumentA,
      1,
      'double-top-v1',
      1,
      JSON.stringify({ schemaVersion: 1, points: [] }),
      'double-top:v1:fixture',
    ]);
    await expect(
      pool.query(insert, [
        instrumentA,
        1,
        'double-top-v1',
        1,
        JSON.stringify({ schemaVersion: 1, points: [] }),
        'double-top:v1:fixture',
      ]),
    ).rejects.toMatchObject({ code: '23505' });
    await pool.query(insert, [
      instrumentA,
      2,
      'double-top-v2',
      2,
      JSON.stringify({ schemaVersion: 2, points: [] }),
      'double-top:v2:fixture',
    ]);
    const versions = await pool.query<{ pattern_version: number }>(
      `select pattern_version from pattern_instances
       where pattern_code = 'double_top' order by pattern_version`,
    );
    expect(versions.rows.map(({ pattern_version }) => pattern_version)).toEqual(
      [1, 2],
    );
  });

  it('invalidates older snapshots and invokes the closed-bar rebuild port', async () => {
    const input = generationFixture('2026-07-14T15:00:00.000Z');
    await service.generate(input);
    const event: ClosedBarSnapshotEvent = {
      eventId: 'closed-bar:BIST:1d:2026-07-18',
      marketCode: 'BIST',
      timeframe: '1d',
      dataCutoffAt: new Date('2026-07-18T15:00:00.000Z'),
    };
    const invalidated = await service.onClosedBar(event);
    expect(invalidated).toBeGreaterThanOrEqual(1);
    expect(rebuild.events).toContainEqual(event);
    const row = await pool.query<{
      status: string;
      invalidated_at: Date | null;
    }>(
      `select status, invalidated_at from market_overview_snapshots
       where generation_id = $1`,
      [input.generationId],
    );
    expect(row.rows[0]).toMatchObject({
      status: 'invalidated',
      invalidated_at: event.dataCutoffAt,
    });
  });

  function generationFixture(cutoff: string): MarketSnapshotGenerationInput {
    const block = {
      status: 'complete' as const,
      payload: { market: 'BIST' },
      evaluatedCount: 2,
      excludedCount: 0,
      qualityMetadata: {
        sourceTimestamp: cutoff,
        stale: false,
        versions: { indicator: '1' },
      },
    };
    return {
      generationId: randomUUID(),
      marketCode: 'BIST',
      timeframe: '1d',
      universeVersion: 'bist-active-v1',
      policyVersion: 'market-overview-v1',
      dataCutoffAt: new Date(cutoff),
      overview: block,
      sectors: [
        { ...block, sectorId: sectorB },
        { ...block, sectorId: sectorA },
      ],
      rankings: [
        {
          ...block,
          rankingType: 'gainers',
          instrumentId: instrumentA,
          rank: 1,
          sortValue: '2.5000000000',
        },
        {
          ...block,
          rankingType: 'gainers',
          instrumentId: instrumentB,
          rank: 2,
          sortValue: '1.2500000000',
        },
      ],
    };
  }

  function statementContext() {
    return {
      generationId: randomUUID(),
      policyVersion: 'fundamentals-normalization-v1',
      dataCutoffAt: new Date('2026-07-17T15:00:00.000Z'),
    };
  }

  async function insertStatement(
    context: ReturnType<typeof statementContext>,
    providerRevision: string,
  ) {
    return (
      await pool.query<{ id: string }>(
        `insert into fundamental_statement_snapshots
          (instrument_id, provider_id, statement_type, fiscal_year,
           fiscal_period, period_start, period_end, currency_code, unit_scale,
           provider_revision, generation_id, policy_version, data_cutoff_at,
           published_at, source_timestamp, quality_status)
         values ($1, $2, 'income', 2025, 'FY', '2025-01-01T00:00:00Z',
                 '2025-12-31T23:59:59Z', 'TRY', '1', $3, $4, $5, $6,
                 '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z', 'complete')
         returning id`,
        [
          instrumentA,
          providerId,
          providerRevision,
          context.generationId,
          context.policyVersion,
          context.dataCutoffAt,
        ],
      )
    ).rows[0]!;
  }

  async function insertInstrument(symbol: string, sectorId: string) {
    return (
      await pool.query<{ id: string }>(
        `insert into instruments
          (symbol, normalized_symbol, name, market_code, currency_code, status, sector_id)
         values ($1, $1, $2, 'BIST', 'TRY', 'active', $3) returning id`,
        [symbol, `${symbol} Fixture`, sectorId],
      )
    ).rows[0]!.id;
  }
});

class RecordingRebuildPort implements MarketSnapshotRebuildPort {
  readonly events: ClosedBarSnapshotEvent[] = [];

  requestRebuild(event: ClosedBarSnapshotEvent) {
    this.events.push(event);
    return Promise.resolve();
  }
}
