import { createDatabase, type Database } from '@atlas/database';
import {
  createCoreIndicatorRegistry,
  IndicatorBatchExecutor,
  MemoryIndicatorResultCache,
} from '@atlas/domain';
import { type Job, UnrecoverableError } from 'bullmq';

import type { StructuredLogger } from '../observability/structured-logger';
import { JOB_NAMES } from '../queue/queue-contracts';
import type { WorkerEnvironment } from '../config/environment';
import type {
  ScannerMarketDataLoader,
  ScannerMetrics,
  ScannerRunJobData,
  ScannerRuntimeRepository,
} from './contracts';
import {
  isScannerErrorRetryable,
  ScannerRuntimeError,
  scannerErrorCode,
} from './errors';
import { InMemoryScannerMetrics } from './metrics';
import { PostgresScannerMarketDataLoader } from './postgres-market-data-loader';
import { PostgresScannerRuntimeRepository } from './postgres-scanner-runtime-repository';
import { ScannerRunProcessor } from './scanner-run-processor';

export interface ScannerComposition {
  readonly process: (job: Job<ScannerRunJobData>) => Promise<unknown>;
  readonly close: () => Promise<void>;
}

interface ScannerCompositionOptions {
  readonly database: Database;
  readonly logger: StructuredLogger;
  readonly repository?: ScannerRuntimeRepository | undefined;
  readonly marketDataLoader?: ScannerMarketDataLoader | undefined;
  readonly metrics?: ScannerMetrics | undefined;
  readonly batchSize: number;
  readonly batchTimeoutMs: number;
  readonly runTimeoutMs: number;
  readonly close?: (() => Promise<void>) | undefined;
}

export function createScannerComposition(
  options: ScannerCompositionOptions,
): ScannerComposition {
  const metrics = options.metrics ?? new InMemoryScannerMetrics();
  const indicatorExecutor = new IndicatorBatchExecutor(
    createCoreIndicatorRegistry(),
    {
      cache: new MemoryIndicatorResultCache(),
      metrics,
    },
  );
  const processor = new ScannerRunProcessor({
    repository:
      options.repository ??
      new PostgresScannerRuntimeRepository(options.database),
    marketDataLoader:
      options.marketDataLoader ??
      new PostgresScannerMarketDataLoader(options.database),
    indicatorExecutor,
    metrics,
    logger: options.logger,
    batchSize: options.batchSize,
    batchTimeoutMs: options.batchTimeoutMs,
    runTimeoutMs: options.runTimeoutMs,
  });

  return {
    async process(job) {
      if (job.name !== JOB_NAMES.scannerRun) {
        throw new UnrecoverableError(`Unsupported scanner job: ${job.name}`);
      }
      try {
        return await processor.process(job);
      } catch (error: unknown) {
        const retryable = isScannerErrorRetryable(error);
        const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
        const errorCode = scannerErrorCode(error);
        options.logger.error('worker.scanner.job.failed', {
          correlationId: job.data.correlationId,
          errorCode,
          jobId: job.id,
          jobName: job.name,
          retryable,
          runId: job.data.runId,
        });
        if (!retryable || finalAttempt) {
          await (
            options.repository ??
            new PostgresScannerRuntimeRepository(options.database)
          )
            .failRun(job.data.runId, errorCode, new Date())
            .catch(() => undefined);
        }
        if (!retryable && !(error instanceof UnrecoverableError)) {
          throw new UnrecoverableError(errorCode);
        }
        throw error;
      }
    },
    close: options.close ?? (() => Promise.resolve()),
  };
}

export function createDefaultScannerComposition(
  environment: WorkerEnvironment,
  logger: StructuredLogger,
): ScannerComposition {
  const { db, pool } = createDatabase(environment.DATABASE_URL);
  return createScannerComposition({
    database: db,
    logger,
    batchSize: environment.SCANNER_BATCH_SIZE,
    batchTimeoutMs: environment.SCANNER_BATCH_TIMEOUT_MS,
    runTimeoutMs: environment.SCANNER_RUN_TIMEOUT_MS,
    close: () => pool.end(),
  });
}

export function deterministicScannerFailure(
  cause: unknown,
): ScannerRuntimeError {
  return new ScannerRuntimeError('SCANNER_DETERMINISTIC_FAILURE', false, {
    cause,
  });
}
