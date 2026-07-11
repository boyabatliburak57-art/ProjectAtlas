import { describe, expect, it } from 'vitest';

import { processHeartbeat } from './heartbeat';

describe('processHeartbeat', () => {
  it('validates the internal payload and returns a deterministic result', () => {
    expect(
      processHeartbeat(
        {
          data: {
            sentAt: '2026-07-11T12:00:00.000Z',
            workerId: '123e4567-e89b-42d3-a456-426614174000',
          },
        },
        new Date('2026-07-11T12:00:01.000Z'),
      ),
    ).toEqual({
      processedAt: '2026-07-11T12:00:01.000Z',
      status: 'ok',
    });
  });
});
