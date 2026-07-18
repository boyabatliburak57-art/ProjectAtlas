import type {
  ClosedBarSnapshotEvent,
  MarketRankSnapshotInput,
  MarketSnapshotBlock,
  MarketSnapshotGenerationInput,
  MarketSnapshotGenerationResult,
  MarketSnapshotRebuildPort,
  MarketSnapshotRepository,
  SectorMarketSnapshotInput,
} from './contracts.js';

export class MarketSnapshotGenerationError extends Error {
  constructor(
    readonly code:
      | 'MARKET_GENERATION_CONTEXT_INVALID'
      | 'MARKET_GENERATION_COUNTS_INVALID'
      | 'MARKET_GENERATION_PARTIAL_STATUS_REQUIRED'
      | 'MARKET_GENERATION_RANK_DUPLICATE'
      | 'MARKET_GENERATION_INSTRUMENT_DUPLICATE'
      | 'MARKET_GENERATION_SECTOR_DUPLICATE'
      | 'MARKET_GENERATION_SORT_VALUE_INVALID'
      | 'MARKET_CLOSED_BAR_EVENT_INVALID',
  ) {
    super(code);
    this.name = 'MarketSnapshotGenerationError';
  }
}

export class MarketSnapshotGenerationService {
  constructor(
    private readonly repository: MarketSnapshotRepository,
    private readonly rebuildPort: MarketSnapshotRebuildPort,
  ) {}

  generate(
    input: MarketSnapshotGenerationInput,
  ): Promise<MarketSnapshotGenerationResult> {
    validateGeneration(input);
    return this.repository.upsertGeneration({
      ...input,
      sectors: [...input.sectors].sort((left, right) =>
        left.sectorId.localeCompare(right.sectorId),
      ),
      rankings: [...input.rankings].sort(
        (left, right) =>
          left.rankingType.localeCompare(right.rankingType) ||
          left.rank - right.rank ||
          left.instrumentId.localeCompare(right.instrumentId),
      ),
    });
  }

  async onClosedBar(event: ClosedBarSnapshotEvent): Promise<number> {
    validateClosedBarEvent(event);
    const invalidated = await this.repository.invalidateForClosedBar(event);
    await this.rebuildPort.requestRebuild(event);
    return invalidated;
  }
}

function validateGeneration(input: MarketSnapshotGenerationInput): void {
  if (
    !nonBlank(input.generationId) ||
    !nonBlank(input.marketCode) ||
    !nonBlank(input.timeframe) ||
    !nonBlank(input.universeVersion) ||
    !nonBlank(input.policyVersion) ||
    !validDate(input.dataCutoffAt)
  )
    throw new MarketSnapshotGenerationError(
      'MARKET_GENERATION_CONTEXT_INVALID',
    );

  validateBlock(input.overview);
  for (const sector of input.sectors) validateSector(sector);
  for (const ranking of input.rankings) validateRanking(ranking);

  const sectorIds = new Set<string>();
  for (const sector of input.sectors) {
    if (sectorIds.has(sector.sectorId))
      throw new MarketSnapshotGenerationError(
        'MARKET_GENERATION_SECTOR_DUPLICATE',
      );
    sectorIds.add(sector.sectorId);
  }

  const rankingPositions = new Set<string>();
  const rankingInstruments = new Set<string>();
  for (const ranking of input.rankings) {
    const position = `${ranking.rankingType}:${ranking.rank}`;
    if (rankingPositions.has(position))
      throw new MarketSnapshotGenerationError(
        'MARKET_GENERATION_RANK_DUPLICATE',
      );
    rankingPositions.add(position);
    const instrument = `${ranking.rankingType}:${ranking.instrumentId}`;
    if (rankingInstruments.has(instrument))
      throw new MarketSnapshotGenerationError(
        'MARKET_GENERATION_INSTRUMENT_DUPLICATE',
      );
    rankingInstruments.add(instrument);
  }
}

function validateSector(input: SectorMarketSnapshotInput): void {
  if (!nonBlank(input.sectorId))
    throw new MarketSnapshotGenerationError(
      'MARKET_GENERATION_CONTEXT_INVALID',
    );
  validateBlock(input);
}

function validateRanking(input: MarketRankSnapshotInput): void {
  if (
    !nonBlank(input.rankingType) ||
    !nonBlank(input.instrumentId) ||
    !Number.isInteger(input.rank) ||
    input.rank < 1
  )
    throw new MarketSnapshotGenerationError(
      'MARKET_GENERATION_CONTEXT_INVALID',
    );
  if (!decimalString(input.sortValue))
    throw new MarketSnapshotGenerationError(
      'MARKET_GENERATION_SORT_VALUE_INVALID',
    );
  validateBlock(input);
}

function validateBlock(input: MarketSnapshotBlock): void {
  if (
    !Number.isInteger(input.evaluatedCount) ||
    input.evaluatedCount < 0 ||
    !Number.isInteger(input.excludedCount) ||
    input.excludedCount < 0
  )
    throw new MarketSnapshotGenerationError('MARKET_GENERATION_COUNTS_INVALID');
  if (input.excludedCount > 0 && input.status === 'complete')
    throw new MarketSnapshotGenerationError(
      'MARKET_GENERATION_PARTIAL_STATUS_REQUIRED',
    );
}

function validateClosedBarEvent(event: ClosedBarSnapshotEvent): void {
  if (
    !nonBlank(event.eventId) ||
    !nonBlank(event.marketCode) ||
    !nonBlank(event.timeframe) ||
    !validDate(event.dataCutoffAt)
  )
    throw new MarketSnapshotGenerationError('MARKET_CLOSED_BAR_EVENT_INVALID');
}

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function decimalString(value: string): boolean {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
}
