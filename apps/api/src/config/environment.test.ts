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
      MARKET_PUBLIC_RATE_LIMIT: 300,
      MARKET_PUBLIC_RATE_WINDOW_MS: 60_000,
      MARKET_RESPONSE_CACHE_TTL_MS: 5_000,
      NODE_ENV: 'development',
      PORTFOLIO_RECALCULATE_RATE_LIMIT: 5,
      PORTFOLIO_RECALCULATE_RATE_WINDOW_MS: 60_000,
      REDIS_URL: 'redis://127.0.0.1:6379',
      SCANNER_PROGRESS_POLL_AFTER_MS: 1_000,
      SCANNER_PROGRESS_STALE_AFTER_MS: 15_000,
      WATCHLIST_MARKET_DATA_STALE_AFTER_MS: 129_600_000,
    });
  });

  it('fails fast for an invalid port', () => {
    expect(() => parseEnvironment({ API_PORT: 'not-a-port' })).toThrow(
      'Invalid environment configuration: API_PORT',
    );
  });
});
