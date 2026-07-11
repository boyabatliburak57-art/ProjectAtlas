import { describe, expect, it } from 'vitest';

import { parsePublicEnvironment } from './env';

describe('parsePublicEnvironment', () => {
  it('normalizes a valid API URL', () => {
    expect(
      parsePublicEnvironment({
        NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1/',
      }),
    ).toEqual({
      NEXT_PUBLIC_API_URL: 'https://api.example.com/api/v1',
    });
  });

  it('rejects a missing API URL', () => {
    expect(() => parsePublicEnvironment({})).toThrow();
  });
});
