import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './environment';

describe('parseEnvironment', () => {
  it('returns safe local defaults', () => {
    expect(parseEnvironment({})).toEqual({
      API_CORS_ORIGIN: 'http://localhost:3000',
      API_HOST: '0.0.0.0',
      API_PORT: 3001,
      LOG_LEVEL: 'log',
      NODE_ENV: 'development',
    });
  });

  it('fails fast for an invalid port', () => {
    expect(() => parseEnvironment({ API_PORT: 'not-a-port' })).toThrow(
      'Invalid environment configuration: API_PORT',
    );
  });
});
