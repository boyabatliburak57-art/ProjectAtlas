import { describe, expect, it } from 'vitest';

import {
  evaluateFeatureFlag,
  FeatureFlagEvaluator,
  stableRolloutBucket,
  type FeatureFlagCache,
  type FeatureFlagSnapshot,
  type FeatureFlagStore,
} from './feature-flags';

const snapshot: FeatureFlagSnapshot = {
  definition: {
    defaultEnabled: false,
    key: 'scanner.new-runs.disabled',
    type: 'kill_switch',
  },
  version: {
    enabled: true,
    environment: 'test',
    rolloutPercentage: 50,
    targetingRules: {},
    version: 3,
  },
};

describe('feature flag evaluation', () => {
  it('uses deterministic stable percentage rollout', () => {
    const input = {
      environment: 'test',
      flagKey: snapshot.definition.key,
      flagVersion: 3,
      subjectKey: 'user-076',
    };
    expect(stableRolloutBucket(input)).toBe(stableRolloutBucket(input));
    expect(stableRolloutBucket(input)).toBeGreaterThanOrEqual(0);
    expect(stableRolloutBucket(input)).toBeLessThan(100);
  });

  it('honors zero and one-hundred percent boundaries', () => {
    const evaluate = (rolloutPercentage: number) =>
      evaluateFeatureFlag(
        { ...snapshot, version: { ...snapshot.version, rolloutPercentage } },
        { userId: 'stable-user' },
        'postgresql',
      ).enabled;
    expect(evaluate(0)).toBe(false);
    expect(evaluate(100)).toBe(true);
  });

  it('rejects a targeting context mismatch', () => {
    const result = evaluateFeatureFlag(
      {
        ...snapshot,
        version: {
          ...snapshot.version,
          targetingRules: { cohort: ['beta'] },
        },
      },
      { attributes: { cohort: 'stable' }, userId: 'user' },
      'postgresql',
    );
    expect(result).toMatchObject({
      enabled: false,
      reasonCode: 'TARGET_MISMATCH',
    });
  });

  it('invalidates cache and falls back to PostgreSQL', async () => {
    let cached: FeatureFlagSnapshot | null = snapshot;
    const cache: FeatureFlagCache = {
      delete: () => {
        cached = null;
        return Promise.resolve();
      },
      get: () => Promise.resolve(cached),
      set: (_key, value) => {
        cached = value;
        return Promise.resolve();
      },
    };
    const store: FeatureFlagStore = { load: () => Promise.resolve(snapshot) };
    const evaluator = new FeatureFlagEvaluator(store, cache, 'test', {
      [snapshot.definition.key]: 'kill_switch',
    });
    await evaluator.invalidate(snapshot.definition.key);
    await expect(
      evaluator.evaluate(snapshot.definition.key, { userId: 'user' }),
    ).resolves.toMatchObject({ source: 'postgresql' });
  });

  it('uses fail-safe defaults when config is unavailable', async () => {
    const evaluator = new FeatureFlagEvaluator(
      { load: () => Promise.reject(new Error('db unavailable')) },
      {
        delete: () => Promise.resolve(),
        get: () => Promise.reject(new Error('cache unavailable')),
        set: () => Promise.resolve(),
      },
      'test',
      { 'scanner.new-runs.disabled': 'kill_switch' },
    );
    await expect(
      evaluator.evaluate('scanner.new-runs.disabled', { userId: 'user' }),
    ).resolves.toMatchObject({
      enabled: true,
      reasonCode: 'SAFE_DEFAULT',
      source: 'safe_default',
    });
  });
});
