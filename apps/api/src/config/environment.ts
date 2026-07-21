import { z } from 'zod';

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

const corsOriginAllowlistSchema = z.string().refine((value) => {
  const origins = value.split(',');
  if (origins.length === 0 || origins.some((origin) => origin === '*'))
    return false;
  return origins.every((origin) => {
    try {
      const url = new URL(origin);
      return (
        url.origin === origin && ['http:', 'https:'].includes(url.protocol)
      );
    } catch {
      return false;
    }
  });
}, 'API_CORS_ORIGIN must be an explicit comma-separated origin allowlist');

const environmentSchema = z.object({
  ATLAS_ENV: atlasEnvironmentSchema,
  CONFIG_SCHEMA_VERSION: z.literal('1').default('1'),
  API_CORS_ORIGIN: corsOriginAllowlistSchema.default('http://localhost:3000'),
  AUTH_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u)
    .default('atlas_session'),
  AUTH_CSRF_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/u)
    .default('atlas_csrf'),
  AUTH_IDLE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(3_600),
  AUTH_MAX_CONCURRENT_SESSIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5),
  AUTH_PASSWORD_RESET_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(3_600)
    .default(900),
  AUTH_REAUTH_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3_600)
    .default(900),
  AUTH_SESSION_HMAC_KEY: z
    .string()
    .min(32)
    .max(512)
    .default('local-only-auth-hmac-key-32-bytes'),
  AUTH_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(900)
    .max(2_592_000)
    .default(86_400),
  API_DEBUG: booleanEnvironmentSchema,
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
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_TRACE_SAMPLE_RATIO: z.coerce.number().min(0).max(1).default(0.1),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  OBJECT_STORAGE_BUCKET: z.string().min(1).optional(),
  OBJECT_STORAGE_ENDPOINT: z.url().optional(),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  HEALTH_CHECK_DATABASE: booleanEnvironmentSchema,
  RELEASE_COMMIT_SHA: z.string().min(7).max(64).default('development'),
  RELEASE_VERSION: z.string().min(1).max(128).default('development'),
  TELEMETRY_POLICY_VERSION: z.literal('telemetry-v1').default('telemetry-v1'),
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
  SECURITY_RATE_LIMIT_ENABLED: booleanEnvironmentSchema,
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
  METRICS_BEARER_TOKEN: z.string().min(32).max(512).optional(),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(
  environment: Record<string, unknown>,
): Environment {
  const atlasEnvironment = resolveAtlasEnvironment(environment);
  const result = environmentSchema.safeParse({
    ...environment,
    ATLAS_ENV: atlasEnvironment,
  });

  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.'));
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}`);
  }

  if (atlasEnvironment === 'staging' || atlasEnvironment === 'production') {
    const requiredFields = [
      'API_CORS_ORIGIN',
      'AUTH_SESSION_HMAC_KEY',
      'DATABASE_URL',
      'METRICS_BEARER_TOKEN',
      'OBJECT_STORAGE_ACCESS_KEY_ID',
      'OBJECT_STORAGE_BUCKET',
      'OBJECT_STORAGE_ENDPOINT',
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
      'REDIS_URL',
      'RELEASE_COMMIT_SHA',
      'RELEASE_VERSION',
      'TELEMETRY_POLICY_VERSION',
    ] as const;
    const missingFields = requiredFields.filter(
      (field) =>
        typeof environment[field] !== 'string' ||
        environment[field].trim() === '',
    );
    if (missingFields.length > 0) {
      throw new Error(
        `Invalid environment configuration: ${missingFields.join(', ')}`,
      );
    }
    if (result.data.API_DEBUG) {
      throw new Error('Invalid environment configuration: API_DEBUG');
    }
    if (result.data.API_CORS_ORIGIN.split(',').includes('*')) {
      throw new Error('Invalid environment configuration: API_CORS_ORIGIN');
    }
    if (!result.data.HEALTH_CHECK_DATABASE) {
      throw new Error(
        'Invalid environment configuration: HEALTH_CHECK_DATABASE',
      );
    }
    if (!result.data.SECURITY_RATE_LIMIT_ENABLED) {
      throw new Error(
        'Invalid environment configuration: SECURITY_RATE_LIMIT_ENABLED',
      );
    }
  }

  return result.data;
}

export function maskSensitiveValue(value: string): string {
  try {
    const url = new URL(value);
    if (url.password !== '') url.password = '***';
    if (url.username !== '') url.username = '***';
    for (const key of ['access_token', 'key', 'password', 'secret', 'token']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '***');
    }
    return url.toString();
  } catch {
    if (value.length <= 8) return '***';
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }
}

export function safeConfigurationSummary(environment: Environment) {
  return {
    atlasEnvironment: environment.ATLAS_ENV,
    configSchemaVersion: environment.CONFIG_SCHEMA_VERSION,
    databaseUrl: maskSensitiveValue(environment.DATABASE_URL),
    debug: environment.API_DEBUG,
    objectStorageEndpoint:
      environment.OBJECT_STORAGE_ENDPOINT === undefined
        ? 'not-configured'
        : maskSensitiveValue(environment.OBJECT_STORAGE_ENDPOINT),
    redisUrl: maskSensitiveValue(environment.REDIS_URL),
    releaseCommitSha: environment.RELEASE_COMMIT_SHA,
    releaseVersion: environment.RELEASE_VERSION,
  } as const;
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
