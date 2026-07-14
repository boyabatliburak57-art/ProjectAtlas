import { describe, expect, it } from 'vitest';

import { summarizeDurations } from './statistics';

describe('performance statistics', () => {
  it('uses nearest-rank percentiles deterministically', () => {
    expect(summarizeDurations([5, 1, 4, 2, 3])).toEqual({
      p50Ms: 3,
      p95Ms: 5,
      maxMs: 5,
    });
  });
});
