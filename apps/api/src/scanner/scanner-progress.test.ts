import { describe, expect, it, vi } from 'vitest';

import type {
  ScannerFastProgress,
  ScannerProgressFastReader,
  ScannerRuntimeReader,
  ScanRunStatusView,
} from './scanner-runtime.ports';
import { FallbackScannerRuntimeReader } from './scanner-progress';

const runId = '00000000-0000-4000-8000-000000000701';
const now = new Date('2026-07-13T12:00:20.000Z');

function status(
  processed = 5,
  runStatus: ScanRunStatusView['status'] = 'running',
  updatedAt = new Date('2026-07-13T12:00:10.000Z'),
): ScanRunStatusView {
  return {
    id: runId,
    status: runStatus,
    executionMode: 'async',
    planVersion: 1,
    ruleVersion: 1,
    dataCutoffAt: new Date('2026-07-13T11:59:00.000Z'),
    queuedAt: new Date('2026-07-13T12:00:00.000Z'),
    startedAt: new Date('2026-07-13T12:00:01.000Z'),
    completedAt: runStatus === 'completed' ? updatedAt : null,
    cancelRequestedAt: null,
    cancelledAt: null,
    timeoutAt: null,
    updatedAt,
    progress: {
      total: 10,
      processed,
      matched: Math.min(2, processed),
      notEvaluable: Math.min(1, processed),
      warnings: 0,
      phase: runStatus,
      updatedAt,
    },
    errorCode: null,
  };
}

function fast(
  processed = 5,
  updatedAt = new Date('2026-07-13T12:00:15.000Z'),
): ScannerFastProgress {
  return {
    total: 10,
    processed,
    matched: Math.min(2, processed),
    notEvaluable: Math.min(1, processed),
    warnings: 0,
    phase: 'evaluating',
    updatedAt,
  };
}

function setup(
  durableStatus: ScanRunStatusView,
  fastRead: ScannerProgressFastReader['read'],
) {
  let current = durableStatus;
  const durable: ScannerRuntimeReader = {
    status: () => Promise.resolve(current),
    results: () => Promise.resolve({ items: [], nextCursor: null }),
  };
  const read = vi.fn(fastRead);
  const reader = new FallbackScannerRuntimeReader(
    durable,
    { read },
    {
      staleAfterMs: 15_000,
      pollAfterMs: 1_000,
      now: () => new Date(now),
    },
  );
  return {
    reader,
    read,
    setDurable(value: ScanRunStatusView) {
      current = value;
    },
  };
}

describe('FallbackScannerRuntimeReader', () => {
  it('uses Redis as the fast path when its progress is valid and current', async () => {
    const runtime = setup(status(), () => Promise.resolve(fast(6)));

    await expect(runtime.reader.status(runId)).resolves.toMatchObject({
      progress: {
        processed: 6,
        phase: 'evaluating',
        source: 'redis',
        stale: false,
        terminal: false,
        pollAfterMs: 1_000,
      },
    });
  });

  it('falls back to PostgreSQL when Redis is unavailable', async () => {
    const runtime = setup(status(), () =>
      Promise.reject(new Error('redis unavailable')),
    );

    await expect(runtime.reader.status(runId)).resolves.toMatchObject({
      progress: { processed: 5, source: 'postgresql' },
    });
  });

  it('detects stale progress snapshots', async () => {
    const old = new Date('2026-07-13T11:59:00.000Z');
    const runtime = setup(status(5, 'running', old), () =>
      Promise.resolve(null),
    );

    await expect(runtime.reader.status(runId)).resolves.toMatchObject({
      progress: { stale: true, source: 'postgresql' },
    });
  });

  it('never moves progress backwards when the fast path disappears', async () => {
    let available = true;
    const runtime = setup(status(5), () =>
      available
        ? Promise.resolve(fast(8))
        : Promise.reject(new Error('redis unavailable')),
    );
    const first = await runtime.reader.status(runId);
    available = false;
    const fallback = await runtime.reader.status(runId);

    expect(first?.progress.processed).toBe(8);
    expect(fallback?.progress).toMatchObject({
      processed: 8,
      source: 'postgresql',
    });
    expect(fallback!.progress.updatedAt.getTime()).toBeGreaterThanOrEqual(
      first!.progress.updatedAt.getTime(),
    );
  });

  it('freezes terminal polling and does not consult Redis', async () => {
    const terminal = status(10, 'completed');
    const runtime = setup(terminal, () => Promise.resolve(fast(10)));
    const first = await runtime.reader.status(runId);
    runtime.setDurable({
      ...terminal,
      progress: {
        ...terminal.progress,
        phase: 'unexpected-change',
        updatedAt: new Date('2026-07-13T12:00:19.000Z'),
      },
    });
    const second = await runtime.reader.status(runId);

    expect(first?.progress).toEqual(second?.progress);
    expect(second?.progress).toMatchObject({
      processed: 10,
      phase: 'completed',
      terminal: true,
      pollAfterMs: null,
      source: 'postgresql',
    });
    expect(runtime.read).not.toHaveBeenCalled();
  });
});
