import type { JobsOptions } from 'bullmq';

export const QUEUE_NAMES = {
  deadLetter: 'atlas.system.dead-letter.v1',
  system: 'atlas.system.v1',
} as const;

export const JOB_NAMES = {
  deadLetter: 'system.dead-letter.v1',
  heartbeat: 'system.heartbeat.v1',
} as const;

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    delay: 1_000,
    jitter: 0.5,
    type: 'exponential',
  },
  removeOnComplete: 100,
  removeOnFail: false,
} satisfies JobsOptions;

export function createHeartbeatJobId(
  timestampMs: number,
  intervalMs: number,
): string {
  const bucket = Math.floor(timestampMs / intervalMs);
  return `worker-heartbeat-${bucket}`;
}
