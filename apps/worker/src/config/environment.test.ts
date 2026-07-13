import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment';

describe('parseEnvironment', () => {
  it('parses Redis and applies worker defaults', () => {
    expect(
      parseEnvironment({
        DATABASE_URL: 'postgresql://atlas:local@localhost:5432/atlas',
        REDIS_URL: 'redis://localhost:6379',
      }),
    ).toEqual({
      DATABASE_URL: 'postgresql://atlas:local@localhost:5432/atlas',
      REDIS_URL: 'redis://localhost:6379',
      WORKER_CONCURRENCY: 2,
      WORKER_HEARTBEAT_INTERVAL_MS: 30_000,
      WORKER_LOG_LEVEL: 'info',
      SCANNER_BATCH_SIZE: 100,
      SCANNER_BATCH_TIMEOUT_MS: 30_000,
      SCANNER_RUN_TIMEOUT_MS: 300_000,
      WORKER_STARTUP_TIMEOUT_MS: 10_000,
    });
  });

  it('fails fast for a non-Redis URL', () => {
    expect(() =>
      parseEnvironment({
        DATABASE_URL: 'postgresql://atlas:local@localhost:5432/atlas',
        REDIS_URL: 'https://localhost',
      }),
    ).toThrow('Invalid worker environment: REDIS_URL');
  });
});
