import { z } from 'zod';

const redisUrlSchema = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === 'redis:' || protocol === 'rediss:';
  },
  { message: 'REDIS_URL must use redis or rediss protocol' },
);

const databaseUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === 'postgresql:', {
    message: 'DATABASE_URL must use postgresql protocol',
  });

const environmentSchema = z.object({
  DATABASE_URL: databaseUrlSchema,
  REDIS_URL: redisUrlSchema,
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(2),
  WORKER_HEARTBEAT_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .default(30_000),
  WORKER_LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  SCANNER_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  SCANNER_BATCH_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(30_000),
  SCANNER_RUN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(300_000),
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
