import type { IndicatorBatchExecutor } from '@atlas/domain';
import type { Job } from 'bullmq';

import type { StructuredLogger } from '../observability/structured-logger';
import type {
  ScannerBatchCompletion,
  ScannerMarketDataInstrument,
  ScannerMetrics,
  ScannerProgress,
  ScannerResultWrite,
  ScannerRunJobData,
  ScannerRuntimeRepository,
  ScannerMarketDataLoader,
} from './contracts';
import { ScannerRuntimeError } from './errors';
import {
  buildComputedValues,
  buildScannerExplanation,
} from './explanation-builder';
import { evaluateScannerInstrument } from './instrument-evaluator';

interface ScannerRunProcessorDependencies {
  readonly repository: ScannerRuntimeRepository;
  readonly marketDataLoader: ScannerMarketDataLoader;
  readonly indicatorExecutor: IndicatorBatchExecutor;
  readonly metrics: ScannerMetrics;
  readonly logger: StructuredLogger;
  readonly batchSize: number;
  readonly batchTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly now?: (() => Date) | undefined;
}

export class ScannerRunProcessor {
  constructor(private readonly dependencies: ScannerRunProcessorDependencies) {}

  async process(job: Job<ScannerRunJobData>): Promise<ScannerProgress | null> {
    const startedAt = this.now();
    const loaded = await this.dependencies.repository.loadRun(job.data.runId);
    if (loaded === null) {
      throw new ScannerRuntimeError('SCAN_RUN_NOT_FOUND', false);
    }
    if (loaded.status === 'completed' || loaded.status === 'cancelled')
      return null;
    if (loaded.status === 'failed' || loaded.status === 'expired') {
      throw new ScannerRuntimeError('SCAN_RUN_INVALID_STATE', false);
    }
    if (loaded.status === 'cancel_requested') {
      await this.cancel(loaded.id, job);
      return null;
    }
    const run = await this.dependencies.repository.startRun(
      loaded.id,
      startedAt,
    );
    if (run?.status === 'cancel_requested') {
      await this.cancel(loaded.id, job);
      return null;
    }
    if (run === null || run.status !== 'running') {
      throw new ScannerRuntimeError('SCAN_RUN_INVALID_STATE', false);
    }
    const executionStartedAt = run.startedAt ?? startedAt;

    const fields = {
      correlationId: job.data.correlationId,
      dataCutoffAt: run.dataCutoffAt.toISOString(),
      jobId: job.id,
      planVersion: run.plan.planVersion,
      ruleVersion: run.plan.normalizedRule.version,
      runId: run.id,
      userId: run.requestedBy,
    };
    this.dependencies.logger.info('worker.scanner.run.started', fields);
    this.dependencies.metrics.observe(
      'scanner.queue.wait.ms',
      Math.max(0, startedAt.getTime() - run.queuedAt.getTime()),
    );

    let latest: ScannerProgress | null = null;
    const batches = chunk(run.instrumentIds, this.dependencies.batchSize);
    for (const [batchIndex, instrumentIds] of batches.entries()) {
      this.assertRunTimeout(executionStartedAt);
      if (await this.dependencies.repository.isCancellationRequested(run.id)) {
        await this.cancel(run.id, job);
        return latest;
      }
      const batchId = `${run.id}:${batchIndex}:${run.plan.planVersion}`;
      const batchStartedAt = this.now();
      const state = await this.dependencies.repository.beginBatch({
        runId: run.id,
        batchIndex,
        planVersion: run.plan.planVersion,
        instrumentIds,
        occurredAt: batchStartedAt,
      });
      if (state === 'completed') {
        const durable = await this.dependencies.repository.loadRun(run.id);
        if (durable !== null)
          latest = progressFromRun(durable, 'persisting', this.now());
        continue;
      }

      this.dependencies.logger.info('worker.scanner.batch.started', {
        ...fields,
        batchId,
        batchIndex,
        instrumentCount: instrumentIds.length,
      });
      await this.publish(
        job,
        progressPhase(latest, run.instrumentIds.length, 'loading', this.now()),
      );
      const evaluated = await withTimeout(
        this.evaluateBatch(run.plan, run.dataCutoffAt, instrumentIds),
        this.dependencies.batchTimeoutMs,
        'SCANNER_BATCH_TIMEOUT',
      );
      await this.publish(
        job,
        progressPhase(
          latest,
          run.instrumentIds.length,
          'evaluating',
          this.now(),
        ),
      );
      latest = await this.dependencies.repository.completeBatch({
        runId: run.id,
        batchIndex,
        results: evaluated.results,
        counts: evaluated.counts,
        dataCutoffAt: run.dataCutoffAt,
        occurredAt: this.now(),
      });
      await this.publish(job, latest);
      const duration = this.now().getTime() - batchStartedAt.getTime();
      this.dependencies.metrics.observe('scanner.batch.duration.ms', duration);
      this.dependencies.metrics.increment(
        'scanner.instruments.processed',
        evaluated.counts.processed,
      );
      this.dependencies.metrics.increment(
        'scanner.results.matched',
        evaluated.counts.matched,
      );
      this.dependencies.metrics.increment(
        'scanner.results.not_evaluable',
        evaluated.counts.notEvaluable,
      );
      this.dependencies.logger.info('worker.scanner.batch.completed', {
        ...fields,
        batchId,
        batchIndex,
        durationMs: duration,
        ...evaluated.counts,
      });
    }

    if (await this.dependencies.repository.isCancellationRequested(run.id)) {
      await this.cancel(run.id, job);
      return latest;
    }
    const completedAt = this.now();
    await this.dependencies.repository.completeRun(run.id, completedAt);
    const durable = await this.dependencies.repository.loadRun(run.id);
    latest =
      durable === null
        ? progressPhase(
            latest,
            run.instrumentIds.length,
            'completed',
            completedAt,
          )
        : progressFromRun(durable, 'completed', completedAt);
    await this.publish(job, latest);
    const duration = completedAt.getTime() - executionStartedAt.getTime();
    this.dependencies.metrics.observe('scanner.run.duration.ms', duration);
    this.dependencies.logger.info('worker.scanner.run.completed', {
      ...fields,
      durationMs: duration,
      processed: latest.processed,
    });
    return latest;
  }

  private async evaluateBatch(
    plan: import('@atlas/domain').ScanExecutionPlan,
    dataCutoffAt: Date,
    instrumentIds: readonly string[],
  ): Promise<{
    readonly results: readonly ScannerResultWrite[];
    readonly counts: ScannerBatchCompletion;
  }> {
    const loaded = await this.dependencies.marketDataLoader.load({
      instrumentIds,
      plan,
      dataCutoffAt,
    });
    const byId = new Map(
      loaded.map(
        (instrument) => [instrument.instrumentId, instrument] as const,
      ),
    );
    const results: ScannerResultWrite[] = [];
    let matched = 0;
    let notEvaluable = 0;
    let warningCount = 0;
    for (const instrumentId of instrumentIds) {
      const instrument =
        byId.get(instrumentId) ?? missingInstrument(instrumentId);
      const result = await evaluateScannerInstrument(
        instrument,
        plan,
        this.dependencies.indicatorExecutor,
      );
      warningCount += result.warnings.length;
      if (result.evaluation.status === 'matched') matched += 1;
      if (result.evaluation.status === 'notEvaluable') notEvaluable += 1;
      if (result.evaluation.status !== 'notMatched') {
        results.push({
          instrumentId,
          status:
            result.evaluation.status === 'matched'
              ? 'matched'
              : 'not_evaluable',
          computedValues: buildComputedValues(
            plan.normalizedRule,
            result.values,
          ),
          explanation: buildScannerExplanation(
            plan.normalizedRule,
            result.evaluation,
            result.values,
            result.warnings,
          ),
          warnings: result.warnings,
        });
      }
    }
    return {
      results,
      counts: {
        processed: instrumentIds.length,
        matched,
        notEvaluable,
        warnings: warningCount,
      },
    };
  }

  private async publish(
    job: Job<ScannerRunJobData>,
    progress: ScannerProgress,
  ): Promise<void> {
    try {
      await job.updateProgress(progress);
    } catch (error: unknown) {
      this.dependencies.metrics.increment('scanner.progress.publish.failure');
      this.dependencies.logger.warn('worker.scanner.progress.publish-failed', {
        correlationId: job.data.correlationId,
        errorType:
          error instanceof Error ? error.constructor.name : 'UnknownError',
        jobId: job.id,
        runId: job.data.runId,
      });
    }
  }

  private async cancel(
    runId: string,
    job: Job<ScannerRunJobData>,
  ): Promise<void> {
    await this.dependencies.repository.cancelRun(runId, this.now());
    this.dependencies.metrics.increment('scanner.run.cancelled');
    this.dependencies.logger.info('worker.scanner.run.cancelled', {
      correlationId: job.data.correlationId,
      jobId: job.id,
      runId,
    });
  }

  private assertRunTimeout(startedAt: Date): void {
    if (
      this.now().getTime() - startedAt.getTime() >=
      this.dependencies.runTimeoutMs
    ) {
      this.dependencies.metrics.increment('scanner.run.timeout');
      throw new ScannerRuntimeError('SCANNER_RUN_TIMEOUT', false);
    }
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}

function chunk<T>(
  values: readonly T[],
  size: number,
): readonly (readonly T[])[] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function missingInstrument(instrumentId: string): ScannerMarketDataInstrument {
  return {
    instrumentId,
    inputs: new Map(),
    marketFields: {},
    warnings: [
      {
        code: 'MARKET_DATA_UNAVAILABLE',
        message: 'No market data was loaded for the instrument',
      },
    ],
  };
}

function progressPhase(
  current: ScannerProgress | null,
  total: number,
  phase: ScannerProgress['phase'],
  occurredAt: Date,
): ScannerProgress {
  return {
    total,
    processed: current?.processed ?? 0,
    matched: current?.matched ?? 0,
    notEvaluable: current?.notEvaluable ?? 0,
    warnings: current?.warnings ?? 0,
    phase,
    percent: current?.percent ?? 0,
    updatedAt: occurredAt.toISOString(),
  };
}

function progressFromRun(
  run: import('./contracts').ScannerRunRecord,
  phase: ScannerProgress['phase'],
  occurredAt: Date,
): ScannerProgress {
  return {
    total: run.progressTotal,
    processed: run.progressProcessed,
    matched: run.matchedCount,
    notEvaluable: run.notEvaluableCount,
    warnings: run.warningCount,
    phase,
    percent:
      run.progressTotal === 0
        ? 100
        : Math.min(
            100,
            Math.floor((run.progressProcessed / run.progressTotal) * 100),
          ),
    updatedAt: occurredAt.toISOString(),
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: 'SCANNER_BATCH_TIMEOUT',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new ScannerRuntimeError(code, true)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
