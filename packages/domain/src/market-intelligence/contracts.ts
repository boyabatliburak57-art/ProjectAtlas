export type MarketSnapshotStatus =
  | 'complete'
  | 'partial'
  | 'stale'
  | 'notEvaluable';

export interface MarketSnapshotQualityMetadata {
  readonly sourceTimestamp?: string;
  readonly stale?: boolean;
  readonly partial?: boolean;
  readonly warnings?: readonly string[];
  readonly versions?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface MarketSnapshotGenerationContext {
  readonly generationId: string;
  readonly marketCode: string;
  readonly timeframe: string;
  readonly universeVersion: string;
  readonly policyVersion: string;
  readonly dataCutoffAt: Date;
}

export interface MarketSnapshotBlock {
  readonly status: MarketSnapshotStatus;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly evaluatedCount: number;
  readonly excludedCount: number;
  readonly qualityMetadata: MarketSnapshotQualityMetadata;
}

export interface SectorMarketSnapshotInput extends MarketSnapshotBlock {
  readonly sectorId: string;
}

export interface MarketRankSnapshotInput extends MarketSnapshotBlock {
  readonly rankingType: string;
  readonly instrumentId: string;
  readonly rank: number;
  readonly sortValue: string;
}

export interface MarketSnapshotGenerationInput extends MarketSnapshotGenerationContext {
  readonly overview: MarketSnapshotBlock;
  readonly sectors: readonly SectorMarketSnapshotInput[];
  readonly rankings: readonly MarketRankSnapshotInput[];
}

export interface MarketSnapshotGenerationResult {
  readonly generationId: string;
  readonly created: boolean;
  readonly sectorCount: number;
  readonly rankingCount: number;
}

export interface ClosedBarSnapshotEvent {
  readonly eventId: string;
  readonly marketCode: string;
  readonly timeframe: string;
  readonly dataCutoffAt: Date;
}

export interface MarketSnapshotRepository {
  upsertGeneration(
    input: MarketSnapshotGenerationInput,
  ): Promise<MarketSnapshotGenerationResult>;
  invalidateForClosedBar(event: ClosedBarSnapshotEvent): Promise<number>;
}

export interface MarketSnapshotRebuildPort {
  requestRebuild(event: ClosedBarSnapshotEvent): Promise<void>;
}
