import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type {
  ClosedBarSnapshotEvent,
  MarketSnapshotGenerationInput,
  MarketSnapshotRepository,
  MarketSnapshotRebuildPort,
} from './contracts.js';
import {
  MarketSnapshotGenerationError,
  MarketSnapshotGenerationService,
} from './market-snapshot-generation-service.js';

describe('market snapshot generation service', () => {
  it('sorts a consistent generation and delegates idempotent persistence', async () => {
    const repository = new MemoryRepository();
    const rebuild = new RecordingRebuildPort();
    const service = new MarketSnapshotGenerationService(repository, rebuild);

    const first = await service.generate(fixture());
    const replay = await service.generate(fixture());

    expect(first).toMatchObject({
      created: true,
      sectorCount: 2,
      rankingCount: 2,
    });
    expect(replay).toMatchObject({
      created: false,
      sectorCount: 2,
      rankingCount: 2,
    });
    expect(
      repository.saved[0]?.sectors.map(({ sectorId }) => sectorId),
    ).toEqual([SECTOR_A, SECTOR_B]);
    expect(repository.saved[0]?.rankings.map(({ rank }) => rank)).toEqual([
      1, 2,
    ]);
  });

  it('requires partial status when a block excludes instruments', () => {
    const service = serviceFixture();
    expect(() =>
      service.generate({
        ...fixture(),
        overview: { ...fixture().overview, excludedCount: 1 },
      }),
    ).toThrowError(
      new MarketSnapshotGenerationError(
        'MARKET_GENERATION_PARTIAL_STATUS_REQUIRED',
      ),
    );
  });

  it('rejects duplicate rank, instrument and sector identities', () => {
    const service = serviceFixture();
    const input = fixture();
    expect(() =>
      service.generate({
        ...input,
        sectors: [input.sectors[0]!, input.sectors[0]!],
      }),
    ).toThrowError('MARKET_GENERATION_SECTOR_DUPLICATE');
    expect(() =>
      service.generate({
        ...input,
        rankings: [
          input.rankings[0]!,
          { ...input.rankings[1]!, rank: input.rankings[0]!.rank },
        ],
      }),
    ).toThrowError('MARKET_GENERATION_RANK_DUPLICATE');
    expect(() =>
      service.generate({
        ...input,
        rankings: [
          input.rankings[0]!,
          {
            ...input.rankings[1]!,
            instrumentId: input.rankings[0]!.instrumentId,
          },
        ],
      }),
    ).toThrowError('MARKET_GENERATION_INSTRUMENT_DUPLICATE');
  });

  it('invalidates and requests rebuild for a new closed bar', async () => {
    const repository = new MemoryRepository();
    repository.invalidated = 3;
    const rebuild = new RecordingRebuildPort();
    const service = new MarketSnapshotGenerationService(repository, rebuild);
    const event: ClosedBarSnapshotEvent = {
      eventId: 'bar:THYAO:1d:2026-07-18',
      marketCode: 'BIST',
      timeframe: '1d',
      dataCutoffAt: new Date('2026-07-18T15:00:00.000Z'),
    };

    await expect(service.onClosedBar(event)).resolves.toBe(3);
    expect(repository.invalidations).toEqual([event]);
    expect(rebuild.events).toEqual([event]);
  });
});

const GENERATION_ID = '10000000-0000-4000-8000-000000000001';
const SECTOR_A = '20000000-0000-4000-8000-000000000001';
const SECTOR_B = '20000000-0000-4000-8000-000000000002';

function fixture(): MarketSnapshotGenerationInput {
  const block = {
    status: 'complete' as const,
    payload: { value: '1' },
    evaluatedCount: 2,
    excludedCount: 0,
    qualityMetadata: { stale: false, versions: { indicator: '1' } },
  };
  return {
    generationId: GENERATION_ID,
    marketCode: 'BIST',
    timeframe: '1d',
    universeVersion: 'bist-active-v1',
    policyVersion: 'market-overview-v1',
    dataCutoffAt: new Date('2026-07-17T15:00:00.000Z'),
    overview: block,
    sectors: [
      { ...block, sectorId: SECTOR_B },
      { ...block, sectorId: SECTOR_A },
    ],
    rankings: [
      {
        ...block,
        rankingType: 'gainers',
        instrumentId: randomUUID(),
        rank: 2,
        sortValue: '1.2',
      },
      {
        ...block,
        rankingType: 'gainers',
        instrumentId: randomUUID(),
        rank: 1,
        sortValue: '2.3',
      },
    ],
  };
}

function serviceFixture() {
  return new MarketSnapshotGenerationService(
    new MemoryRepository(),
    new RecordingRebuildPort(),
  );
}

class MemoryRepository implements MarketSnapshotRepository {
  readonly saved: MarketSnapshotGenerationInput[] = [];
  readonly identities = new Set<string>();
  readonly invalidations: ClosedBarSnapshotEvent[] = [];
  invalidated = 0;

  upsertGeneration(input: MarketSnapshotGenerationInput) {
    this.saved.push(input);
    const created = !this.identities.has(input.generationId);
    this.identities.add(input.generationId);
    return Promise.resolve({
      generationId: input.generationId,
      created,
      sectorCount: input.sectors.length,
      rankingCount: input.rankings.length,
    });
  }

  invalidateForClosedBar(event: ClosedBarSnapshotEvent) {
    this.invalidations.push(event);
    return Promise.resolve(this.invalidated);
  }
}

class RecordingRebuildPort implements MarketSnapshotRebuildPort {
  readonly events: ClosedBarSnapshotEvent[] = [];

  requestRebuild(event: ClosedBarSnapshotEvent) {
    this.events.push(event);
    return Promise.resolve();
  }
}
