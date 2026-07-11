import { describe, expect, it } from 'vitest';

import {
  createHeartbeatJobId,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
} from './queue-contracts';

describe('queue contracts', () => {
  it('uses namespaced and versioned queue names', () => {
    expect(Object.values(QUEUE_NAMES)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^atlas\.[a-z.-]+\.v\d+$/),
      ]),
    );
  });

  it('creates the same heartbeat job id within one interval', () => {
    expect(createHeartbeatJobId(30_001, 30_000)).toBe(
      createHeartbeatJobId(59_999, 30_000),
    );
  });

  it('keeps failed jobs and uses bounded exponential retry', () => {
    expect(DEFAULT_JOB_OPTIONS).toMatchObject({
      attempts: 5,
      backoff: { delay: 1_000, type: 'exponential' },
      removeOnFail: false,
    });
  });
});
