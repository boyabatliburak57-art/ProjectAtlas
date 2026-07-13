import type {
  ScanResultPage,
  ScannerFastProgress,
  ScannerProgressFastReader,
  ScannerRuntimeReader,
  ScanRunStatusView,
} from './scanner-runtime.ports';

const terminalStatuses = new Set([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

export class FallbackScannerRuntimeReader implements ScannerRuntimeReader {
  private readonly watermarks = new Map<
    string,
    ScanRunStatusView['progress']
  >();

  constructor(
    private readonly durable: ScannerRuntimeReader,
    private readonly fast: ScannerProgressFastReader,
    private readonly options: {
      readonly staleAfterMs: number;
      readonly pollAfterMs: number;
      readonly now?: (() => Date) | undefined;
      readonly maximumWatermarks?: number | undefined;
    },
  ) {}

  async status(runId: string): Promise<ScanRunStatusView | null> {
    const durable = await this.durable.status(runId);
    if (durable === null) return null;
    const terminal = terminalStatuses.has(durable.status);
    const previous = this.watermarks.get(runId);
    if (terminal && previous?.terminal === true) {
      return { ...durable, progress: previous };
    }

    let fast: ScannerFastProgress | null = null;
    if (!terminal) {
      try {
        fast = await this.fast.read(runId);
      } catch {
        fast = null;
      }
    }
    const candidate = selectProgress(
      durable,
      fast,
      this.now(),
      this.options.staleAfterMs,
      this.options.pollAfterMs,
    );
    const progress = monotonicProgress(candidate, previous);
    this.remember(runId, progress);
    return { ...durable, progress };
  }

  results(
    input: Parameters<ScannerRuntimeReader['results']>[0],
  ): Promise<ScanResultPage> {
    return this.durable.results(input);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private remember(
    runId: string,
    progress: ScanRunStatusView['progress'],
  ): void {
    this.watermarks.delete(runId);
    this.watermarks.set(runId, progress);
    const maximum = this.options.maximumWatermarks ?? 10_000;
    if (this.watermarks.size <= maximum) return;
    const oldest = this.watermarks.keys().next().value;
    if (oldest !== undefined) this.watermarks.delete(oldest);
  }
}

function selectProgress(
  durable: ScanRunStatusView,
  fast: ScannerFastProgress | null,
  now: Date,
  staleAfterMs: number,
  pollAfterMs: number,
): ScanRunStatusView['progress'] {
  const terminal = terminalStatuses.has(durable.status);
  const usableFast =
    !terminal && fast !== null && validFastProgress(fast, durable.progress)
      ? fast
      : null;
  const selected = usableFast ?? durable.progress;
  return {
    total: selected.total,
    processed: selected.processed,
    matched: selected.matched,
    notEvaluable: selected.notEvaluable,
    warnings: selected.warnings,
    phase: terminal ? publicStatus(durable.status) : selected.phase,
    updatedAt: selected.updatedAt,
    source: usableFast === null ? 'postgresql' : 'redis',
    stale:
      !terminal && now.getTime() - selected.updatedAt.getTime() > staleAfterMs,
    terminal,
    pollAfterMs: terminal ? null : pollAfterMs,
  };
}

function validFastProgress(
  fast: ScannerFastProgress,
  durable: ScanRunStatusView['progress'],
): boolean {
  return (
    Number.isInteger(fast.total) &&
    Number.isInteger(fast.processed) &&
    Number.isInteger(fast.matched) &&
    Number.isInteger(fast.notEvaluable) &&
    Number.isInteger(fast.warnings) &&
    fast.total === durable.total &&
    fast.processed >= durable.processed &&
    fast.processed <= fast.total &&
    fast.matched >= durable.matched &&
    fast.matched <= fast.processed &&
    fast.notEvaluable >= durable.notEvaluable &&
    fast.notEvaluable <= fast.processed &&
    fast.warnings >= durable.warnings &&
    fast.updatedAt.getTime() >= durable.updatedAt.getTime()
  );
}

function monotonicProgress(
  candidate: ScanRunStatusView['progress'],
  previous: ScanRunStatusView['progress'] | undefined,
): ScanRunStatusView['progress'] {
  if (previous === undefined) return candidate;
  if (previous.terminal === true) return previous;
  const candidateIsNewer =
    candidate.updatedAt.getTime() >= previous.updatedAt.getTime();
  return {
    ...candidate,
    processed: Math.max(candidate.processed, previous.processed),
    matched: Math.max(candidate.matched, previous.matched),
    notEvaluable: Math.max(candidate.notEvaluable, previous.notEvaluable),
    warnings: Math.max(candidate.warnings, previous.warnings),
    phase: candidateIsNewer ? candidate.phase : previous.phase,
    updatedAt: candidateIsNewer ? candidate.updatedAt : previous.updatedAt,
  };
}

function publicStatus(status: string): string {
  return status === 'cancel_requested' ? 'cancelRequested' : status;
}
