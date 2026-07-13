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
