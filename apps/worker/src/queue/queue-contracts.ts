import type { JobsOptions } from 'bullmq';
import { createHash } from 'node:crypto';

import type { BarIngestionJobData } from '../market-data/bars/bar-ingestion-job';

export const QUEUE_NAMES = {
  deadLetter: 'atlas.system.dead-letter.v1',
  marketData: 'atlas.market-data.v1',
  system: 'atlas.system.v1',
} as const;

export const JOB_NAMES = {
  barIngestion: 'market-data.bar-ingestion.v1',
  deadLetter: 'system.dead-letter.v1',
  heartbeat: 'system.heartbeat.v1',
  instrumentSync: 'market-data.instrument-sync.v1',
} as const;

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    delay: 1_000,
    jitter: 0.5,
    type: 'exponential',
  },
  removeOnComplete: 100,
  removeOnFail: false,
} satisfies JobsOptions;

export function createHeartbeatJobId(
  timestampMs: number,
  intervalMs: number,
): string {
  const bucket = Math.floor(timestampMs / intervalMs);
  return `worker-heartbeat-${bucket}`;
}

function stableJobId(prefix: string, parts: readonly string[]): string {
  const digest = createHash('sha256')
    .update(parts.join('\u0000'))
    .digest('hex');
  return `${prefix}-${digest.slice(0, 32)}`;
}

export function createInstrumentSyncJobId(
  providerCode: string,
  idempotencyKey: string,
): string {
  return stableJobId('instrument-sync', [providerCode, idempotencyKey]);
}

export function createBarIngestionJobId(data: BarIngestionJobData): string {
  return stableJobId('bar-ingestion', [
    data.providerCode,
    data.providerSymbol,
    data.timeframe,
    data.from,
    data.to,
  ]);
}
