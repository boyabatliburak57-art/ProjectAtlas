import { createDatabase, type Database } from '@atlas/database';
import { type Job, UnrecoverableError } from 'bullmq';
import { ZodError } from 'zod';

import type { StructuredLogger } from '../observability/structured-logger';
import { JOB_NAMES } from '../queue/queue-contracts';
import { BarIngestionError } from './bars/bar-ingestion-service';
import { processBarIngestionJob } from './bars/bar-ingestion-job';
import { BarIngestionService } from './bars/bar-ingestion-service';
import { DatabaseBarIngestionStore } from './bars/database-bar-ingestion-store';
import { DatabaseInstrumentImportStore } from './instruments/database-instrument-import-store';
import { processInstrumentImportJob } from './instruments/instrument-import-job';
import {
  InstrumentImportError,
  InstrumentImportService,
} from './instruments/instrument-import-service';
import {
  ProviderError,
  ProviderRegistry,
  type RawMarketDataProviderAdapter,
} from './providers';
import { FakeMarketDataProviderAdapter } from './providers/testing/fake-market-data-provider';

export interface MarketDataComposition {
  readonly process: (job: Job) => Promise<unknown>;
  readonly close: () => Promise<void>;
}

interface CompositionOptions {
  readonly database: Database;
  readonly logger: StructuredLogger;
  readonly providerAdapters: readonly RawMarketDataProviderAdapter[];
  readonly close?: (() => Promise<void>) | undefined;
}

export function createMarketDataComposition(
  options: CompositionOptions,
): MarketDataComposition {
  const registry = new ProviderRegistry();
  for (const adapter of options.providerAdapters) {
    registry.register(adapter);
  }

  const instrumentService = new InstrumentImportService({
    store: new DatabaseInstrumentImportStore(options.database),
    logger: options.logger,
    listInstruments: (providerCode) =>
      registry.resolve(providerCode).listInstruments(),
  });
  const barService = new BarIngestionService({
    store: new DatabaseBarIngestionStore(options.database),
    logger: options.logger,
    fetchBars: (providerCode, request) =>
      registry.resolve(providerCode).fetchBars(request),
  });

  return {
    async process(job) {
      const correlationId = readCorrelationId(job);
      options.logger.info('worker.market-data.job.started', {
        correlationId,
        jobId: job.id,
        jobName: job.name,
      });

      try {
        const result =
          job.name === JOB_NAMES.instrumentSync
            ? await processInstrumentImportJob(job, instrumentService)
            : job.name === JOB_NAMES.barIngestion
              ? await processBarIngestionJob(job, barService)
              : rejectUnknownJob(job.name);
        options.logger.info('worker.market-data.job.completed', {
          correlationId,
          jobId: job.id,
          jobName: job.name,
        });
        return result;
      } catch (error: unknown) {
        const retryable = isRetryable(error);
        options.logger.error('worker.market-data.job.failed', {
          correlationId,
          errorCode: readErrorCode(error),
          jobId: job.id,
          jobName: job.name,
          retryable,
        });
        if (!retryable && !(error instanceof UnrecoverableError)) {
          throw new UnrecoverableError(readErrorCode(error));
        }
        throw error;
      }
    },
    close: options.close ?? (() => Promise.resolve()),
  };
}

export function createDefaultMarketDataComposition(
  databaseUrl: string,
  logger: StructuredLogger,
): MarketDataComposition {
  const { db, pool } = createDatabase(databaseUrl);
  return createMarketDataComposition({
    database: db,
    logger,
    providerAdapters: [
      new FakeMarketDataProviderAdapter({
        capabilities: {
          supportedTimeframes: ['1d'],
          dataMode: 'end-of-day',
          historicalDepthDays: null,
          supportsCorporateActions: false,
          supportsFundamentals: false,
          supportsPagination: false,
          rateLimit: null,
        },
        instruments: [],
        barBatch: { bars: [] },
      }),
    ],
    close: () => pool.end(),
  });
}

function readCorrelationId(job: Job): string {
  const value = (job.data as { correlationId?: unknown }).correlationId;
  return typeof value === 'string' && value.length > 0
    ? value
    : (job.id ?? 'job-id-unavailable');
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return error.retryable;
  }
  return !(
    error instanceof InstrumentImportError ||
    error instanceof BarIngestionError ||
    error instanceof ZodError ||
    error instanceof UnrecoverableError
  );
}

function readErrorCode(error: unknown): string {
  if (error instanceof ProviderError) return error.code;
  if (
    error instanceof InstrumentImportError ||
    error instanceof BarIngestionError
  )
    return error.code;
  if (error instanceof ZodError) return 'INVALID_JOB_DATA';
  if (error instanceof UnrecoverableError) return 'UNSUPPORTED_JOB_NAME';
  return 'MARKET_DATA_JOB_FAILED';
}

function rejectUnknownJob(jobName: string): never {
  throw new UnrecoverableError(`Unsupported market-data job: ${jobName}`);
}
