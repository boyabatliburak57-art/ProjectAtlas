import type { Job } from 'bullmq';
import { z } from 'zod';

import { InstrumentImportService } from './instrument-import-service';

const instrumentImportJobDataSchema = z.strictObject({
  correlationId: z.string().trim().min(1).max(128).optional(),
  providerCode: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  dryRun: z.boolean().default(false),
});

export type InstrumentImportJobData = z.input<
  typeof instrumentImportJobDataSchema
>;

export function processInstrumentImportJob(
  job: Pick<Job, 'data'>,
  service: InstrumentImportService,
) {
  const data = instrumentImportJobDataSchema.parse(job.data);
  return service.execute({
    providerCode: data.providerCode,
    dryRun: data.dryRun,
  });
}
