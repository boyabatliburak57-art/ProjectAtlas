import { describe, expect, it } from 'vitest';

import {
  createAlertEvaluationJobId,
  createBacktestRunJobId,
  createExperimentJobId,
  createHeartbeatJobId,
  createNotificationDeliveryJobId,
  createMarketIntelligenceReconciliationJobId,
  createScannerRunJobId,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
} from './queue-contracts';

describe('queue contracts', () => {
  it('uses namespaced and versioned queue names', () => {
    expect(Object.values(QUEUE_NAMES)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^atlas\.[a-z.-]+\.v\d+$/),
      ]),
    );
  });

  it('creates the same heartbeat job id within one interval', () => {
    expect(createHeartbeatJobId(30_001, 30_000)).toBe(
      createHeartbeatJobId(59_999, 30_000),
    );
  });

  it('keeps failed jobs and uses bounded exponential retry', () => {
    expect(DEFAULT_JOB_OPTIONS).toMatchObject({
      attempts: 5,
      backoff: { delay: 1_000, type: 'exponential' },
      removeOnFail: false,
    });
  });

  it('creates stable scanner run job identities', () => {
    expect(createScannerRunJobId('run-1')).toBe(createScannerRunJobId('run-1'));
    expect(createScannerRunJobId('run-1')).not.toBe(
      createScannerRunJobId('run-2'),
    );
  });

  it('creates stable backtest run job identities', () => {
    expect(createBacktestRunJobId('run-1')).toBe(
      createBacktestRunJobId('run-1'),
    );
    expect(createBacktestRunJobId('run-1')).not.toBe(
      createBacktestRunJobId('run-2'),
    );
  });

  it('creates stable experiment identities with an isolated production queue', () => {
    expect(QUEUE_NAMES.experiments).toMatch(/^atlas\.experiments\.v\d+$/);
    expect(createExperimentJobId('experiment-1')).toBe(
      createExperimentJobId('experiment-1'),
    );
    expect(createExperimentJobId('experiment-1')).not.toBe(
      createExperimentJobId('experiment-2'),
    );
  });

  it('creates stable alert event identities including the cutoff', () => {
    const event = {
      type: 'scan_completed' as const,
      eventId: 'scan-run:1:completed',
      scanRunId: '00000000-0000-4000-8000-000000000001',
      dataCutoffAt: '2026-07-15T15:00:00.000Z',
    };
    expect(createAlertEvaluationJobId(event)).toBe(
      createAlertEvaluationJobId({ ...event }),
    );
    expect(createAlertEvaluationJobId(event)).not.toBe(
      createAlertEvaluationJobId({
        ...event,
        dataCutoffAt: '2026-07-16T15:00:00.000Z',
      }),
    );
  });

  it('uses a distinct delivery job identity for every retry attempt', () => {
    expect(
      createNotificationDeliveryJobId({ outboxId: 12, attempt: 1 }),
    ).not.toBe(createNotificationDeliveryJobId({ outboxId: 12, attempt: 2 }));
  });

  it('deduplicates reconciliation jobs while preserving revision context', () => {
    const input = {
      market: 'BIST',
      timeframe: '1d',
      staleAfterMs: 86_400_000,
      invalidations: [
        {
          eventId: 'closed-bar-1',
          type: 'new_closed_bar' as const,
          version: 'r1',
          occurredAt: '2026-07-18T15:00:00.000Z',
        },
      ],
    };
    expect(createMarketIntelligenceReconciliationJobId(input)).toBe(
      createMarketIntelligenceReconciliationJobId({ ...input }),
    );
    expect(createMarketIntelligenceReconciliationJobId(input)).not.toBe(
      createMarketIntelligenceReconciliationJobId({
        ...input,
        invalidations: [{ ...input.invalidations[0]!, version: 'r2' }],
      }),
    );
  });
});
