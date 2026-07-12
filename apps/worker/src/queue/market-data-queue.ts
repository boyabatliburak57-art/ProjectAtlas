import type { JobsOptions, Queue } from 'bullmq';

import type { BarIngestionJobData } from '../market-data/bars/bar-ingestion-job';
import type { InstrumentImportJobData } from '../market-data/instruments/instrument-import-job';
import {
  createBarIngestionJobId,
  createInstrumentSyncJobId,
  JOB_NAMES,
} from './queue-contracts';

export function enqueueInstrumentSync(
  queue: Queue,
  data: InstrumentImportJobData,
  idempotencyKey: string,
  options: JobsOptions = {},
) {
  return queue.add(JOB_NAMES.instrumentSync, data, {
    ...options,
    jobId: createInstrumentSyncJobId(data.providerCode, idempotencyKey),
  });
}

export function enqueueBarIngestion(
  queue: Queue,
  data: BarIngestionJobData,
  options: JobsOptions = {},
) {
  return queue.add(JOB_NAMES.barIngestion, data, {
    ...options,
    jobId: createBarIngestionJobId(data),
  });
}
