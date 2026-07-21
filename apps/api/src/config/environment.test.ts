import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment';

describe('parseEnvironment', () => {
  it('returns safe local defaults', () => {
    expect(parseEnvironment({})).toEqual({
      ATLAS_ENV: 'local',
      CONFIG_SCHEMA_VERSION: '1',
      API_CORS_ORIGIN: 'http://localhost:3000',
      API_DEBUG: false,
      API_HOST: '0.0.0.0',
      API_PORT: 3001,
      AUTH_COOKIE_NAME: 'atlas_session',
      AUTH_CSRF_COOKIE_NAME: 'atlas_csrf',
      AUTH_IDLE_TTL_SECONDS: 3_600,
      AUTH_MAX_CONCURRENT_SESSIONS: 5,
      AUTH_PASSWORD_RESET_TTL_SECONDS: 900,
      AUTH_REAUTH_MAX_AGE_SECONDS: 900,
      AUTH_SESSION_HMAC_KEY: 'local-only-auth-hmac-key-32-bytes',
      AUTH_SESSION_TTL_SECONDS: 86_400,
      DATABASE_URL: 'postgresql://atlas:atlas@127.0.0.1:5432/atlas',
      HEALTH_CHECK_DATABASE: false,
      LOG_LEVEL: 'log',
      MARKET_PUBLIC_RATE_LIMIT: 300,
      MARKET_PUBLIC_RATE_WINDOW_MS: 60_000,
      MARKET_RESPONSE_CACHE_TTL_MS: 5_000,
      NODE_ENV: 'development',
      OTEL_TRACE_SAMPLE_RATIO: 0.1,
      PORTFOLIO_RECALCULATE_RATE_LIMIT: 5,
      PORTFOLIO_RECALCULATE_RATE_WINDOW_MS: 60_000,
      REDIS_URL: 'redis://127.0.0.1:6379',
      RELEASE_COMMIT_SHA: 'development',
      RELEASE_VERSION: 'development',
      TELEMETRY_POLICY_VERSION: 'telemetry-v1',
      SCANNER_PROGRESS_POLL_AFTER_MS: 1_000,
      SCANNER_PROGRESS_STALE_AFTER_MS: 15_000,
      SECURITY_RATE_LIMIT_ENABLED: false,
      WATCHLIST_MARKET_DATA_STALE_AFTER_MS: 129_600_000,
    });
  });

  it('fails fast for an invalid port', () => {
    expect(() => parseEnvironment({ API_PORT: 'not-a-port' })).toThrow(
      'Invalid environment configuration: API_PORT',
    );
  });

  it('fails fast when a production secret is missing', () => {
    expect(() =>
      parseEnvironment({
        API_CORS_ORIGIN: 'https://atlas.example',
        ATLAS_ENV: 'production',
        DATABASE_URL: 'postgresql://atlas:secret@database:5432/atlas',
        HEALTH_CHECK_DATABASE: 'true',
        METRICS_BEARER_TOKEN: 'production-metrics-token-change-me-000000',
        REDIS_URL: 'rediss://redis:6379',
        RELEASE_COMMIT_SHA: '1234567890abcdef',
        RELEASE_VERSION: '1.0.0',
      }),
    ).toThrow('OBJECT_STORAGE_ACCESS_KEY_ID');
  });

  it('rejects credentialed wildcard CORS and a disabled production limiter', () => {
    expect(() => parseEnvironment({ API_CORS_ORIGIN: '*' })).toThrow(
      'API_CORS_ORIGIN',
    );
    expect(() =>
      parseEnvironment({
        API_CORS_ORIGIN: 'https://atlas.example',
        ATLAS_ENV: 'production',
        AUTH_SESSION_HMAC_KEY: 'production-hmac-key-with-at-least-32-bytes',
        DATABASE_URL: 'postgresql://atlas:secret@database:5432/atlas',
        HEALTH_CHECK_DATABASE: 'true',
        METRICS_BEARER_TOKEN: 'production-metrics-token-change-me-000000',
        OBJECT_STORAGE_ACCESS_KEY_ID: 'access',
        OBJECT_STORAGE_BUCKET: 'atlas',
        OBJECT_STORAGE_ENDPOINT: 'https://objects.example',
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
        REDIS_URL: 'rediss://redis:6379',
        RELEASE_COMMIT_SHA: '1234567890abcdef',
        RELEASE_VERSION: '1.0.0',
        SECURITY_RATE_LIMIT_ENABLED: 'false',
        TELEMETRY_POLICY_VERSION: 'telemetry-v1',
      }),
    ).toThrow('SECURITY_RATE_LIMIT_ENABLED');
  });

  it('masks connection credentials and tokens', async () => {
    const { maskSensitiveValue } = await import('./environment');
    const masked = maskSensitiveValue(
      'postgresql://atlas:super-secret@database:5432/atlas?token=private',
    );

    expect(masked).not.toContain('atlas:super-secret');
    expect(masked).not.toContain('private');
    expect(masked).toContain('***');
  });
});
