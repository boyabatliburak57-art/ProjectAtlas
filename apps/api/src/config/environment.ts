import { z } from 'zod';

const environmentSchema = z.object({
  API_CORS_ORIGIN: z.url().default('http://localhost:3000'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  DATABASE_URL: z
    .url()
    .refine((value) => new URL(value).protocol === 'postgresql:')
    .default('postgresql://atlas:atlas@127.0.0.1:5432/atlas'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'log', 'debug', 'verbose'])
    .default('log'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  REDIS_URL: z
    .url()
    .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol))
    .default('redis://127.0.0.1:6379'),
  SCANNER_PROGRESS_POLL_AFTER_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(30_000)
    .default(1_000),
  SCANNER_PROGRESS_STALE_AFTER_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(15_000),
  WATCHLIST_MARKET_DATA_STALE_AFTER_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(604_800_000)
    .default(129_600_000),
  PORTFOLIO_RECALCULATE_RATE_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(5),
  PORTFOLIO_RECALCULATE_RATE_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  MARKET_PUBLIC_RATE_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(300),
  MARKET_PUBLIC_RATE_WINDOW_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(60_000),
  MARKET_RESPONSE_CACHE_TTL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(5_000),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  environment: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }

  return result.data;
}
