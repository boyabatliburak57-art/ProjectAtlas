import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const EXPECTED_NODE_VERSION = '22.14.0';
const EXPECTED_PNPM_VERSION = '9.15.4';

export async function readToolchainPolicy(repositoryRoot) {
  const [nvmrc, nodeVersion, packageContents] = await Promise.all([
    readFile(resolve(repositoryRoot, '.nvmrc'), 'utf8'),
    readFile(resolve(repositoryRoot, '.node-version'), 'utf8'),
    readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageContents);

  return {
    nvmrc: nvmrc.trim(),
    nodeVersion: nodeVersion.trim(),
    packageEngineNode: packageJson.engines?.node,
    packageEnginePnpm: packageJson.engines?.pnpm,
    packageManager: packageJson.packageManager,
  };
}

export function validateToolchainVersions({
  actualNodeVersion,
  actualPnpmVersion,
  policy,
  validatePnpm = true,
}) {
  const errors = [];
  const nodeSources = [
    ['.nvmrc', policy.nvmrc],
    ['.node-version', policy.nodeVersion],
    ['package.json#engines.node', policy.packageEngineNode],
  ];

  for (const [source, version] of nodeSources) {
    if (version !== EXPECTED_NODE_VERSION) {
      errors.push(
        `${source} must be ${EXPECTED_NODE_VERSION}; received ${version ?? '<missing>'}`,
      );
    }
  }

  if (actualNodeVersion !== EXPECTED_NODE_VERSION) {
    const actualMajor = actualNodeVersion.split('.')[0];
    const expectedMajor = EXPECTED_NODE_VERSION.split('.')[0];
    const reason =
      actualMajor === expectedMajor
        ? 'version mismatch'
        : 'major version mismatch';
    errors.push(
      `Node ${reason}: expected ${EXPECTED_NODE_VERSION}, received ${actualNodeVersion}`,
    );
  }

  if (policy.packageManager !== `pnpm@${EXPECTED_PNPM_VERSION}`) {
    errors.push(
      `package.json#packageManager must be pnpm@${EXPECTED_PNPM_VERSION}; received ${policy.packageManager ?? '<missing>'}`,
    );
  }
  if (policy.packageEnginePnpm !== EXPECTED_PNPM_VERSION) {
    errors.push(
      `package.json#engines.pnpm must be ${EXPECTED_PNPM_VERSION}; received ${policy.packageEnginePnpm ?? '<missing>'}`,
    );
  }
  if (validatePnpm && actualPnpmVersion !== EXPECTED_PNPM_VERSION) {
    errors.push(
      `pnpm version mismatch: expected ${EXPECTED_PNPM_VERSION}, received ${actualPnpmVersion ?? '<unavailable>'}`,
    );
  }

  return errors;
}

function readPnpmVersion() {
  const result = spawnSync('pnpm', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    return undefined;
  }
  return result.stdout.trim();
}

async function runCli() {
  const nodeOnly = process.argv.includes('--node-only');
  const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const policy = await readToolchainPolicy(repositoryRoot);
  const errors = validateToolchainVersions({
    actualNodeVersion: process.versions.node,
    actualPnpmVersion: nodeOnly ? undefined : readPnpmVersion(),
    policy,
    validatePnpm: !nodeOnly,
  });

  if (errors.length > 0) {
    process.stderr.write(
      `Toolchain version check failed:\n${errors.join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Toolchain version check passed (Node ${EXPECTED_NODE_VERSION}${nodeOnly ? '' : `, pnpm ${EXPECTED_PNPM_VERSION}`}).\n`,
  );
}

const invokedPath = process.argv[1];
if (
  invokedPath !== undefined &&
  fileURLToPath(import.meta.url) === resolve(invokedPath)
) {
  await runCli();
}
