import type { JobsOptions, Queue } from 'bullmq';

import type { ScannerRunJobData } from '../scanner/contracts';
import { createScannerRunJobId, JOB_NAMES } from './queue-contracts';

export function enqueueScannerRun(
  queue: Queue<ScannerRunJobData>,
  data: ScannerRunJobData,
  options: JobsOptions = {},
) {
  return queue.add(JOB_NAMES.scannerRun, data, {
    ...options,
    jobId: createScannerRunJobId(data.runId),
  });
}
