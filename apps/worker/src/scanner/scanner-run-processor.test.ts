import type { ScanExecutionPlan } from '@atlas/domain';
import { describe, expect, it, vi } from 'vitest';

import { StructuredLogger } from '../observability/structured-logger';
import type { ScannerRunRecord, ScannerRuntimeRepository } from './contracts';
import { InMemoryScannerMetrics } from './metrics';
import { ScannerRunProcessor } from './scanner-run-processor';

const plan = {
  planVersion: 1,
  normalizedRule: {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: [],
      sectorIds: [],
    },
    root: { type: 'group', nodeId: 'root', operator: 'AND', children: [] },
  },
  indicatorRequests: [],
  dataRequirements: [],
} as unknown as ScanExecutionPlan;

function run(status: ScannerRunRecord['status'] = 'queued'): ScannerRunRecord {
  return {
    id: 'run-1',
    requestedBy: 'user-1',
    status,
    plan,
    instrumentIds: ['instrument-1'],
    dataCutoffAt: new Date('2026-07-13T10:00:00.000Z'),
    queuedAt: new Date('2026-07-13T09:59:00.000Z'),
    startedAt: null,
    progressTotal: 1,
    progressProcessed: 0,
    matchedCount: 0,
    notEvaluableCount: 0,
    warningCount: 0,
  };
}

function repository(record = run()): ScannerRuntimeRepository {
  return {
    loadRun: vi.fn(() => Promise.resolve(record)),
    startRun: vi.fn(() =>
      Promise.resolve({ ...record, status: 'running' as const }),
    ),
    isCancellationRequested: vi.fn(() => Promise.resolve(false)),
    beginBatch: vi.fn(() => Promise.resolve('started' as const)),
    completeBatch: vi.fn(),
    completeRun: vi.fn(),
    cancelRun: vi.fn(),
    failRun: vi.fn(),
  };
}

describe('ScannerRunProcessor guards', () => {
  it('fails a batch with a retryable timeout code', async () => {
    const processor = new ScannerRunProcessor({
      repository: repository(),
      marketDataLoader: { load: () => new Promise(() => undefined) },
      indicatorExecutor: { execute: vi.fn() } as never,
      metrics: new InMemoryScannerMetrics(),
      logger: new StructuredLogger('error', { write: vi.fn() }),
      batchSize: 1,
      batchTimeoutMs: 10,
      runTimeoutMs: 1_000,
    });

    await expect(
      processor.process({
        data: { runId: 'run-1', correlationId: 'correlation-1' },
        id: 'job-1',
        updateProgress: vi.fn(),
      } as never),
    ).rejects.toMatchObject({
      code: 'SCANNER_BATCH_TIMEOUT',
      retryable: true,
    });
  });

  it('cooperatively cancels before loading the next batch', async () => {
    const cancelRun = vi.fn(() => Promise.resolve());
    const repo: ScannerRuntimeRepository = {
      ...repository(run('cancel_requested')),
      cancelRun,
    };
    const processor = new ScannerRunProcessor({
      repository: repo,
      marketDataLoader: { load: vi.fn() },
      indicatorExecutor: { execute: vi.fn() } as never,
      metrics: new InMemoryScannerMetrics(),
      logger: new StructuredLogger('error', { write: vi.fn() }),
      batchSize: 1,
      batchTimeoutMs: 100,
      runTimeoutMs: 1_000,
    });

    await expect(
      processor.process({
        data: { runId: 'run-1', correlationId: 'correlation-1' },
        id: 'job-1',
      } as never),
    ).resolves.toBeNull();
    expect(cancelRun).toHaveBeenCalledOnce();
  });
});
