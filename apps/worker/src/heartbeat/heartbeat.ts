import type { Job } from 'bullmq';
import { z } from 'zod';

const heartbeatDataSchema = z.object({
  sentAt: z.iso.datetime(),
  workerId: z.string().uuid(),
});

export type HeartbeatData = z.infer<typeof heartbeatDataSchema>;

export interface HeartbeatResult {
  readonly processedAt: string;
  readonly status: 'ok';
}

export function processHeartbeat(
  job: Pick<Job, 'data'>,
  now: Date = new Date(),
): HeartbeatResult {
  heartbeatDataSchema.parse(job.data);

  return {
    processedAt: now.toISOString(),
    status: 'ok',
  };
}
