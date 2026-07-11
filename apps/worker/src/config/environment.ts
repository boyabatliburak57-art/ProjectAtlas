import { z } from 'zod';

const redisUrlSchema = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'redis:' || protocol === 'rediss:';
  },
  { message: 'REDIS_URL must use redis or rediss protocol' },
);

const environmentSchema = z.object({
  REDIS_URL: redisUrlSchema,
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(30_000),
  WORKER_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  WORKER_STARTUP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(60_000)
    .default(10_000),
});

export type WorkerEnvironment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  environment: Record<string, unknown>,
): WorkerEnvironment {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid worker environment: ${fields.join(', ')}`);
  }

  return result.data;
}
