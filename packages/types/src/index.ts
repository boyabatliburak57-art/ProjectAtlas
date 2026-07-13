export const ATLAS_QUEUE_NAMES = {
  deadLetter: 'atlas.system.dead-letter.v1',
  marketData: 'atlas.market-data.v1',
  scanner: 'atlas.scanner.v1',
  system: 'atlas.system.v1',
} as const;

export const ATLAS_JOB_NAMES = {
  barIngestion: 'market-data.bar-ingestion.v1',
  deadLetter: 'system.dead-letter.v1',
  heartbeat: 'system.heartbeat.v1',
  instrumentSync: 'market-data.instrument-sync.v1',
  scannerRun: 'scanner.run.v1',
} as const;

export interface ScannerRunQueuePayload {
  readonly runId: string;
  readonly correlationId: string;
}
