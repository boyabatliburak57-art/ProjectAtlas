import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import {
  AdminOperationsService,
  ADMIN_QUEUE_ALLOWLIST,
} from './admin-operations.service';

describe('admin operational command policy', () => {
  const service = new AdminOperationsService(
    { database: {}, pool: {} } as never,
    new ConfigService({
      ATLAS_ENV: 'test',
      REDIS_URL: 'redis://127.0.0.1:6379',
    }),
  );

  it('exposes a closed queue allowlist without arbitrary names', () => {
    expect(Object.keys(ADMIN_QUEUE_ALLOWLIST)).toEqual([
      'alerts',
      'backtests',
      'experiments',
      'market-data',
      'notifications',
      'scanner',
      'system',
    ]);
    return expect(
      service.setQueuePaused(
        { userId: 'admin' },
        'arbitrary-user-queue',
        true,
        {
          confirmation: 'PAUSE_ARBITRARY_USER_QUEUE_QUEUE',
          expectedVersion: 0,
          reason: 'Security policy validation',
        },
      ),
    ).rejects.toMatchObject({ response: { code: 'QUEUE_NOT_ALLOWLISTED' } });
  });

  it('rejects a dangerous action without exact confirmation', async () => {
    await expect(
      service.setQueuePaused({ userId: 'admin' }, 'scanner', true, {
        confirmation: 'yes',
        expectedVersion: 0,
        reason: 'Security policy validation',
      }),
    ).rejects.toMatchObject({
      response: { code: 'DANGEROUS_CONFIRMATION_INVALID' },
    });
  });
});
