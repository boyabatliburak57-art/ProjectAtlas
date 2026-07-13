import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment';

describe('parseEnvironment', () => {
  it('returns safe local defaults', () => {
    expect(parseEnvironment({})).toEqual({
      API_CORS_ORIGIN: 'http://localhost:3000',
      API_HOST: '0.0.0.0',
      API_PORT: 3001,
      DATABASE_URL: 'postgresql://atlas:atlas@127.0.0.1:5432/atlas',
      LOG_LEVEL: 'log',
      NODE_ENV: 'development',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SCANNER_PROGRESS_POLL_AFTER_MS: 1_000,
      SCANNER_PROGRESS_STALE_AFTER_MS: 15_000,
    });
  });

  it('fails fast for an invalid port', () => {
    expect(() => parseEnvironment({ API_PORT: 'not-a-port' })).toThrow(
      'Invalid environment configuration: API_PORT',
    );
  });
});
