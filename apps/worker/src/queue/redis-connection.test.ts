import { describe, expect, it } from 'vitest';

import { createRedisConnection } from './redis-connection';

describe('createRedisConnection', () => {
  it('maps a Redis URL without exposing it as configuration metadata', () => {
    expect(
      createRedisConnection('redis://worker:secret@localhost:6380/2'),
    ).toMatchObject({
      db: 2,
      host: 'localhost',
      password: 'secret',
      port: 6380,
      username: 'worker',
    });
  });
});
