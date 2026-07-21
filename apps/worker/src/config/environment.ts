import { z } from 'zod';

export const workerRoles = [
  'all',
  'market-data',
  'scanner',
  'alert',
  'notification',
  'backtest',
  'experiment',
  'scheduled',
] as const;

const atlasEnvironmentSchema = z.enum([
  'local',
  'test',
  'staging',
  'production',
]);
const booleanEnvironmentSchema = z
  .union([
    z.boolean(),
    z.enum(['true', 'false']).transform((value) => value === 'true'),
  ])
  .default(false);

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
  ATLAS_ENV: atlasEnvironmentSchema,
  CONFIG_SCHEMA_VERSION: z.literal('1').default('1'),
  DATABASE_URL: databaseUrlSchema,
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_TRACE_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(0.1),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  OBJECT_STORAGE_BUCKET: z.string().min(1).optional(),
  OBJECT_STORAGE_ENDPOINT: z.url().optional(),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  REDIS_URL: redisUrlSchema,
  RELEASE_COMMIT_SHA: z.string().min(7).max(64).default('development'),
  RELEASE_VERSION: z.string().min(1).max(128).default('development'),
  TELEMETRY_POLICY_VERSION: z.literal('telemetry-v1').default('telemetry-v1'),
  WORKER_DEBUG: booleanEnvironmentSchema,
  WORKER_HEALTH_FILE: z.string().default(''),
  WORKER_ROLE: z.enum(workerRoles).default('all'),
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
  BACKTEST_EVENT_BATCH_SIZE: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(250),
  BACKTEST_RUN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(3_600_000)
    .default(600_000),
  WORKER_STARTUP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(60_000)
    .default(10_000),
});

type ParsedWorkerEnvironment = z.infer<typeof environmentSchema>;
type DeploymentEnvironmentKeys =
  | 'ATLAS_ENV'
  | 'CONFIG_SCHEMA_VERSION'
  | 'NODE_ENV'
  | 'OTEL_EXPORTER_OTLP_ENDPOINT'
  | 'OTEL_TRACE_SAMPLE_RATIO'
  | 'OBJECT_STORAGE_ACCESS_KEY_ID'
  | 'OBJECT_STORAGE_BUCKET'
  | 'OBJECT_STORAGE_ENDPOINT'
  | 'OBJECT_STORAGE_SECRET_ACCESS_KEY'
  | 'RELEASE_COMMIT_SHA'
  | 'RELEASE_VERSION'
  | 'TELEMETRY_POLICY_VERSION'
  | 'WORKER_DEBUG'
  | 'WORKER_HEALTH_FILE'
  | 'WORKER_ROLE';

// Optional deployment keys keep injected test compositions source-compatible;
// parseEnvironment always materializes defaults for the production composition root.
export type WorkerEnvironment = Omit<
  ParsedWorkerEnvironment,
  DeploymentEnvironmentKeys
> &
  Partial<Pick<ParsedWorkerEnvironment, DeploymentEnvironmentKeys>>;

export function parseEnvironment(
  environment: Record<string, unknown>,
): WorkerEnvironment {
  const atlasEnvironment = resolveAtlasEnvironment(environment);
  const result = environmentSchema.safeParse({
    ...environment,
    ATLAS_ENV: atlasEnvironment,
  });

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid worker environment: ${fields.join(', ')}`);
  }

  if (atlasEnvironment === 'staging' || atlasEnvironment === 'production') {
    const requiredFields = [
      'DATABASE_URL',
      'OBJECT_STORAGE_ACCESS_KEY_ID',
      'OBJECT_STORAGE_BUCKET',
      'OBJECT_STORAGE_ENDPOINT',
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
      'REDIS_URL',
      'RELEASE_COMMIT_SHA',
      'RELEASE_VERSION',
      'TELEMETRY_POLICY_VERSION',
      'WORKER_HEALTH_FILE',
    ] as const;
    const missingFields = requiredFields.filter(
      (field) =>
        typeof environment[field] !== 'string' ||
        environment[field].trim() === '',
    );
    if (missingFields.length > 0) {
      throw new Error(
        `Invalid worker environment: ${missingFields.join(', ')}`,
      );
    }
    if (result.data.WORKER_DEBUG) {
      throw new Error('Invalid worker environment: WORKER_DEBUG');
    }
  }

  return result.data;
}

function resolveAtlasEnvironment(
  environment: Record<string, unknown>,
): z.infer<typeof atlasEnvironmentSchema> {
  if (environment['ATLAS_ENV'] !== undefined) {
    return atlasEnvironmentSchema.parse(environment['ATLAS_ENV']);
  }
  if (environment['NODE_ENV'] === 'production') return 'production';
  if (environment['NODE_ENV'] === 'test') return 'test';
  return 'local';
}
