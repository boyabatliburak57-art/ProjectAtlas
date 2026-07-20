import { DeterministicBacktestEngine } from '@atlas/domain';
import type { Job } from 'bullmq';

import type { StructuredLogger } from '../observability/structured-logger';
import type {
  BacktestProgress,
  BacktestRunJobData,
  BacktestRuntimeMetrics,
  BacktestWorkerRepository,
  BacktestWorkerSnapshotResolver,
} from './contracts';
import { BacktestWorkerError } from './errors';

export interface BacktestRunProcessorDependencies {
  readonly repository: BacktestWorkerRepository;
  readonly snapshotResolver: BacktestWorkerSnapshotResolver;
  readonly engine: DeterministicBacktestEngine;
  readonly metrics: BacktestRuntimeMetrics;
  readonly logger: StructuredLogger;
  readonly eventBatchSize: number;
  readonly runTimeoutMs: number;
  readonly now?: (() => Date) | undefined;
}

export class BacktestRunProcessor {
  constructor(
    private readonly dependencies: BacktestRunProcessorDependencies,
  ) {}

  async process(
    job: Job<BacktestRunJobData>,
  ): Promise<BacktestProgress | null> {
    const receivedAt = this.now();
    let run = await this.dependencies.repository.loadRun(job.data.runId);
    if (run === null)
      throw new BacktestWorkerError('BACKTEST_RUN_NOT_FOUND', false);
    if (run.status === 'completed' || run.status === 'cancelled') return null;
    if (run.status === 'failed' || run.status === 'expired')
      throw new BacktestWorkerError('BACKTEST_RUN_INVALID_STATE', false);
    if (run.status === 'cancelRequested') {
      await this.cancel(run.id, job, 0, 0);
      return null;
    }

    const started = await this.dependencies.repository.transition({
      runId: run.id,
      from: ['queued', 'resolvingData', 'running'],
      to: 'resolvingData',
      occurredAt: receivedAt,
      progressPercent: Math.max(run.progressPercent, 5),
    });
    if (started !== null) run = started;
    const executionStartedAt = run.startedAt ?? receivedAt;
    const fields = {
      correlationId: job.data.correlationId,
      jobId: job.id,
      runId: run.id,
      snapshotHash: run.dataSnapshotHash,
      userId: run.requestedBy,
    };
    this.dependencies.logger.info('worker.backtest.run.started', fields);
    this.dependencies.metrics.observe(
      'backtest.queue.wait.ms',
      Math.max(0, receivedAt.getTime() - run.queuedAt.getTime()),
    );
    await this.publish(job, progress('resolvingData', 5, 0, 0, this.now()));

    const snapshot = await withTimeout(
      this.dependencies.snapshotResolver.resolve({
        snapshotId: run.dataSnapshotId,
        expectedHash: run.dataSnapshotHash,
      }),
      remainingTimeout(
        executionStartedAt,
        this.now(),
        this.dependencies.runTimeoutMs,
      ),
    );
    if (snapshot.hash !== run.dataSnapshotHash)
      throw new BacktestWorkerError('BACKTEST_SNAPSHOT_MISMATCH', false);
    if (await this.dependencies.repository.isCancellationRequested(run.id)) {
      await this.cancel(run.id, job, 0, snapshot.events.length);
      return null;
    }
    const running = await this.dependencies.repository.transition({
      runId: run.id,
      from: ['resolvingData', 'running'],
      to: 'running',
      occurredAt: this.now(),
      progressPercent: Math.max(run.progressPercent, 10),
    });
    if (running !== null) run = running;

    let checkpoint = run.checkpoint;
    let finalResult: ReturnType<DeterministicBacktestEngine['run']> | null =
      null;
    for (;;) {
      this.assertTimeout(executionStartedAt);
      if (await this.dependencies.repository.isCancellationRequested(run.id)) {
        await this.cancel(
          run.id,
          job,
          checkpoint?.processedEventIds.length ?? 0,
          snapshot.events.length,
        );
        return null;
      }
      const batchStartedAt = this.now();
      const result = this.dependencies.engine.run(
        run.executionPlan,
        snapshot.events,
        {
          ...(checkpoint === null ? {} : { checkpoint }),
          stopAfterTimestampBuckets: this.dependencies.eventBatchSize,
        },
      );
      checkpoint = result.checkpoint;
      const processed = checkpoint.processedEventIds.length;
      const percent =
        result.status === 'completed'
          ? 90
          : Math.max(
              run.progressPercent,
              10 +
                Math.floor(
                  (processed / Math.max(1, snapshot.events.length)) * 75,
                ),
            );
      // A completed result is persisted atomically immediately below. Writing its
      // full processed-event set into the run JSONB first adds a large, redundant
      // database write and cannot be used for resume. Durable checkpoints are only
      // required while more timestamp buckets remain.
      if (result.status !== 'completed') {
        await this.dependencies.repository.saveCheckpoint({
          runId: run.id,
          checkpoint,
          progressPercent: percent,
          occurredAt: this.now(),
        });
      }
      await this.publish(
        job,
        progress(
          'running',
          percent,
          processed,
          snapshot.events.length,
          this.now(),
        ),
      );
      this.dependencies.metrics.observe(
        'backtest.batch.duration.ms',
        this.now().getTime() - batchStartedAt.getTime(),
      );
      this.dependencies.metrics.increment(
        'backtest.events.processed',
        processed,
      );
      if (result.status === 'completed') {
        finalResult = result;
        break;
      }
    }
    if (finalResult === null)
      throw new BacktestWorkerError(
        'BACKTEST_DETERMINISTIC_VALIDATION_FAILED',
        false,
      );
    if (await this.dependencies.repository.isCancellationRequested(run.id)) {
      await this.cancel(
        run.id,
        job,
        snapshot.events.length,
        snapshot.events.length,
      );
      return null;
    }
    await this.dependencies.repository.transition({
      runId: run.id,
      from: ['running'],
      to: 'calculatingMetrics',
      occurredAt: this.now(),
      progressPercent: 95,
    });
    await this.publish(
      job,
      progress(
        'calculatingMetrics',
        95,
        snapshot.events.length,
        snapshot.events.length,
        this.now(),
      ),
    );
    const completedAt = this.now();
    await this.dependencies.repository.persistCompletedResult({
      run,
      result: finalResult,
      completedAt,
    });
    await this.publish(
      job,
      progress(
        'completed',
        100,
        snapshot.events.length,
        snapshot.events.length,
        completedAt,
      ),
    );
    this.dependencies.metrics.increment('backtest.run.completed');
    this.dependencies.metrics.observe(
      'backtest.run.duration.ms',
      completedAt.getTime() - executionStartedAt.getTime(),
    );
    this.dependencies.logger.info('worker.backtest.run.completed', {
      ...fields,
      fillCount: finalResult.fills.length,
      resultHash: finalResult.resultHash,
      tradeCount: finalResult.trades.length,
    });
    return progress(
      'completed',
      100,
      snapshot.events.length,
      snapshot.events.length,
      completedAt,
    );
  }

  private async cancel(
    runId: string,
    job: Job<BacktestRunJobData>,
    processed: number,
    total: number,
  ): Promise<void> {
    await this.dependencies.repository.transition({
      runId,
      from: [
        'queued',
        'resolvingData',
        'running',
        'calculatingMetrics',
        'cancelRequested',
      ],
      to: 'cancelled',
      occurredAt: this.now(),
    });
    await this.publish(
      job,
      progress('cancelled', 100, processed, total, this.now()),
    );
    this.dependencies.metrics.increment('backtest.run.cancelled');
  }

  private async publish(
    job: Job<BacktestRunJobData>,
    value: BacktestProgress,
  ): Promise<void> {
    try {
      await job.updateProgress(value);
    } catch (error: unknown) {
      this.dependencies.metrics.increment('backtest.progress.publish.failure');
      this.dependencies.logger.warn('worker.backtest.progress.publish-failed', {
        errorType:
          error instanceof Error ? error.constructor.name : 'UnknownError',
        jobId: job.id,
        runId: job.data.runId,
      });
    }
  }

  private assertTimeout(startedAt: Date): void {
    if (
      this.now().getTime() - startedAt.getTime() >=
      this.dependencies.runTimeoutMs
    )
      throw new BacktestWorkerError('BACKTEST_RUN_TIMEOUT', false);
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}

function progress(
  phase: BacktestProgress['phase'],
  percent: number,
  processedEvents: number,
  totalEvents: number,
  at: Date,
): BacktestProgress {
  return {
    phase,
    percent: Math.max(0, Math.min(100, percent)),
    processedEvents,
    totalEvents,
    updatedAt: at.toISOString(),
  };
}

function remainingTimeout(
  startedAt: Date,
  now: Date,
  timeoutMs: number,
): number {
  return Math.max(1, timeoutMs - (now.getTime() - startedAt.getTime()));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new BacktestWorkerError('BACKTEST_RUN_TIMEOUT', false)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
