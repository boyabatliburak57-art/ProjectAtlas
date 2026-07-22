import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertStagingTarget,
  LatencyHistogram,
  percentile,
  ratioGrowth,
  statistics,
  substitute,
  validateAdapter,
} from './resilience-core.mjs';

const digest = `sha256:${'a'.repeat(64)}`;

test('staging guard accepts staging and rejects production', () => {
  assert.doesNotThrow(() =>
    assertStagingTarget({
      baseUrl: 'https://api.staging.atlas.example',
      environment: 'staging',
      imageDigest: digest,
    }),
  );
  assert.throws(
    () =>
      assertStagingTarget({
        baseUrl: 'https://api.production.atlas.example',
        environment: 'staging',
        imageDigest: digest,
      }),
    /STAGING_HOST_REQUIRED|PRODUCTION_TARGET_FORBIDDEN/u,
  );
  assert.throws(
    () =>
      assertStagingTarget({
        baseUrl: 'https://api.staging.atlas.example',
        environment: 'production',
        imageDigest: digest,
      }),
    /STAGING_ENVIRONMENT_REQUIRED/u,
  );
});

test('statistics use nearest-rank percentiles', () => {
  assert.equal(percentile([1, 2, 3, 4, 100], 0.95), 100);
  assert.deepEqual(statistics([1, 2, 3, 4]), {
    count: 4,
    maxMs: 4,
    p50Ms: 2,
    p95Ms: 4,
    p99Ms: 4,
  });
  assert.equal(ratioGrowth(100, 110), 0.1);
});

test('bounded histogram reports load percentiles without retaining requests', () => {
  const histogram = new LatencyHistogram();
  for (const value of [1.1, 2.1, 3.1, 4.1, 99.1]) histogram.add(value);
  assert.deepEqual(histogram.snapshot(), {
    count: 5,
    maxMs: 99.1,
    p50Ms: 4,
    p95Ms: 100,
    p99Ms: 100,
  });
});

test('fixture substitution encodes values and rejects missing context', () => {
  assert.equal(
    substitute('/symbols/{symbol}', { symbol: 'ABC/DEF' }),
    '/symbols/ABC%2FDEF',
  );
  assert.throws(
    () => substitute('/runs/{runId}', {}),
    /MISSING_FIXTURE_VALUE/u,
  );
});

test('chaos adapter rejects shells, production contexts, and unresolved commands', () => {
  const valid = {
    adapterVersion: 'atlas-staging-chaos-v1',
    allowedExecutables: ['kubectl'],
    context: 'atlas-staging',
    environment: 'staging',
    namespace: 'atlas-staging',
    scenarios: {
      'redis-restart': {
        fault: ['kubectl', 'delete', 'pod/example'],
        recovery: ['kubectl', 'wait', 'pod/example'],
      },
    },
  };
  assert.doesNotThrow(() => validateAdapter(valid, ['redis-restart']));
  assert.throws(
    () =>
      validateAdapter({ ...valid, context: 'atlas-production' }, [
        'redis-restart',
      ]),
    /SAFE_STAGING_CONTEXT_REQUIRED/u,
  );
  assert.throws(
    () =>
      validateAdapter(
        {
          ...valid,
          scenarios: {
            'redis-restart': {
              fault: ['sh', '-c', 'kubectl delete pod'],
              recovery: ['kubectl', 'wait', 'pod/example'],
            },
          },
        },
        ['redis-restart'],
      ),
    /SHELL_CHAOS_COMMAND_FORBIDDEN/u,
  );
  assert.throws(
    () =>
      validateAdapter(
        {
          ...valid,
          scenarios: {
            'redis-restart': {
              fault: ['unapproved-adapter', 'restart'],
              recovery: ['kubectl', 'wait', 'pod/example'],
            },
          },
        },
        ['redis-restart'],
      ),
    /CHAOS_EXECUTABLE_NOT_ALLOWED/u,
  );
});
