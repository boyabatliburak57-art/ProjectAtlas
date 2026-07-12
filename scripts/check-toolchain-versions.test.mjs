import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateToolchainVersions } from './check-toolchain-versions.mjs';

const validPolicy = {
  nvmrc: '22.14.0',
  nodeVersion: '22.14.0',
  packageEngineNode: '22.14.0',
  packageEnginePnpm: '9.15.4',
  packageManager: 'pnpm@9.15.4',
};

test('accepts the repository Node and pnpm targets', () => {
  const errors = validateToolchainVersions({
    actualNodeVersion: '22.14.0',
    actualPnpmVersion: '9.15.4',
    policy: validPolicy,
  });

  assert.deepEqual(errors, []);
});

test('rejects a wrong Node major version', () => {
  const errors = validateToolchainVersions({
    actualNodeVersion: '25.8.1',
    actualPnpmVersion: '9.15.4',
    policy: validPolicy,
  });

  assert.ok(
    errors.some((error) => error.includes('Node major version mismatch')),
  );
});

test('rejects inconsistent repository version sources', () => {
  const errors = validateToolchainVersions({
    actualNodeVersion: '22.14.0',
    actualPnpmVersion: '9.15.4',
    policy: {
      ...validPolicy,
      nodeVersion: '22.13.0',
      packageManager: 'pnpm@9.14.0',
    },
  });

  assert.ok(errors.some((error) => error.startsWith('.node-version must be')));
  assert.ok(
    errors.some((error) => error.startsWith('package.json#packageManager')),
  );
});
