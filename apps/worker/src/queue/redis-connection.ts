import type { ConnectionOptions } from 'bullmq';

export function createRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const databasePath = url.pathname.replace(/^\//, '');

  return {
    connectionName: 'atlas-worker',
    host: url.hostname,
    maxRetriesPerRequest: null,
    password:
      url.password === '' ? undefined : decodeURIComponent(url.password),
    port: url.port === '' ? 6379 : Number(url.port),
    retryStrategy(attempt): number | null {
      return attempt > 5 ? null : Math.min(attempt * 200, 1_000);
    },
    username:
      url.username === '' ? undefined : decodeURIComponent(url.username),
    ...(databasePath === '' ? {} : { db: Number(databasePath) }),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
