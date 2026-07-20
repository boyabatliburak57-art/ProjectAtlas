import type { JobsOptions } from 'bullmq';
import { createHash } from 'node:crypto';
import {
  ATLAS_JOB_NAMES,
  ATLAS_QUEUE_NAMES,
  type NotificationDeliveryQueuePayload,
  type MarketIntelligenceReconciliationQueuePayload,
} from '@atlas/types';

import type { BarIngestionJobData } from '../market-data/bars/bar-ingestion-job';
import type { FundamentalsIngestionJobData } from '../market-data/fundamentals/fundamentals-ingestion-job';
import type { PatternDetectionJobData } from '../market-data/patterns/pattern-detection-job';
import type { AlertEvaluationQueuePayload } from '@atlas/types';

export const QUEUE_NAMES = ATLAS_QUEUE_NAMES;
export const JOB_NAMES = ATLAS_JOB_NAMES;

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

export function createFundamentalsIngestionJobId(
  data: FundamentalsIngestionJobData,
): string {
  return stableJobId('fundamentals-ingestion', [
    data.providerCode,
    data.providerSymbol,
  ]);
}

export function createPatternDetectionJobId(
  data: PatternDetectionJobData,
): string {
  return stableJobId('pattern-detection', [
    [...data.instrumentIds].sort().join(','),
    data.timeframe,
    data.adjustmentMode,
    data.dataCutoffAt,
  ]);
}

export function createMarketIntelligenceReconciliationJobId(
  data: MarketIntelligenceReconciliationQueuePayload,
): string {
  return stableJobId('market-intelligence-reconcile', [
    data.market,
    data.timeframe,
    [...data.invalidations]
      .map((event) => `${event.type}:${event.eventId}:${event.version}`)
      .sort()
      .join(','),
  ]);
}

export function createScannerRunJobId(runId: string): string {
  return stableJobId('scanner-run', [runId]);
}

export function createBacktestRunJobId(runId: string): string {
  return stableJobId('backtest-run', [runId]);
}

export function createExperimentJobId(experimentId: string): string {
  return stableJobId('backtest-experiment', [experimentId]);
}

export function createAlertEvaluationJobId(
  data: AlertEvaluationQueuePayload,
): string {
  return stableJobId('alert-evaluation', [
    data.type,
    data.eventId,
    data.dataCutoffAt,
  ]);
}

export function createNotificationDeliveryJobId(
  data: NotificationDeliveryQueuePayload,
): string {
  return stableJobId('notification-delivery', [
    String(data.outboxId),
    String(data.attempt),
  ]);
}
