import type { ExperimentQueuePayload } from '@atlas/types';
import type { Queue } from 'bullmq';

import {
  createExperimentJobId,
  DEFAULT_JOB_OPTIONS,
  JOB_NAMES,
} from '../queue/queue-contracts';

export class BullMqExperimentDispatcher {
  constructor(private readonly queue: Queue<ExperimentQueuePayload>) {}

  async dispatch(experimentId: string): Promise<void> {
    await this.queue.add(
      JOB_NAMES.backtestExperiment,
      { experimentId },
      {
        ...DEFAULT_JOB_OPTIONS,
        jobId: createExperimentJobId(experimentId),
      },
    );
  }
}
