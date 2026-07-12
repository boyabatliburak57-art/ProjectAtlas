import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateAdrRepository } from './validate-adr-identifiers.mjs';

const temporaryDirectories = [];
const validatorPath = fileURLToPath(
  new URL('./validate-adr-identifiers.mjs', import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createFixture(files, indexRows) {
  const root = await mkdtemp(resolve(tmpdir(), 'atlas-adr-validator-'));
  temporaryDirectories.push(root);
  const architectureDirectory = resolve(root, 'architecture');
  await mkdir(architectureDirectory);

  await Promise.all(
    Object.entries(files).map(([fileName, contents]) =>
      writeFile(resolve(architectureDirectory, fileName), contents, 'utf8'),
    ),
  );
  const indexPath = resolve(architectureDirectory, 'ADR_INDEX.md');
  await writeFile(
    indexPath,
    `# ADR Index\n\n| Kimlik | Başlık | Durum |\n| --- | --- | --- |\n${indexRows.join('\n')}\n`,
    'utf8',
  );

  return { architectureDirectory, indexPath };
}

test('accepts unique ADR files whose filename, H1 and index identifiers match', async () => {
  const fixture = await createFixture(
    {
      'ADR-001-First-Decision.md': '# ADR-001 — First Decision\n',
      'ADR-002-Second-Decision.md': '# ADR-002 — Second Decision\n',
    },
    [
      '| ADR-001 | First Decision | Accepted |',
      '| ADR-002 | Second Decision | Accepted |',
    ],
  );

  const result = await validateAdrRepository(fixture);

  assert.deepEqual(result.errors, []);
});

test('fails a fixture that contains a duplicate ADR identifier', async () => {
  const fixture = await createFixture(
    {
      'ADR-004-First-Decision.md': '# ADR-004 — First Decision\n',
      'ADR-004-Second-Decision.md': '# ADR-004 — Second Decision\n',
    },
    ['| ADR-004 | First Decision | Accepted |'],
  );

  const result = await validateAdrRepository(fixture);
  const cliResult = spawnSync(process.execPath, [validatorPath], {
    cwd: resolve(fixture.architectureDirectory, '..'),
    encoding: 'utf8',
  });

  assert.ok(result.errors.includes('Duplicate ADR file identifier: ADR-004'));
  assert.equal(cliResult.status, 1);
  assert.match(cliResult.stderr, /Duplicate ADR file identifier: ADR-004/);
});

test('fails when an ADR filename, H1 and index are not aligned', async () => {
  const fixture = await createFixture(
    {
      'ADR-006-Database-Decision.md': '# ADR-007 — Database Decision\n',
    },
    ['| ADR-007 | Database Decision | Accepted |'],
  );

  const result = await validateAdrRepository(fixture);

  assert.ok(
    result.errors.some((error) => error.startsWith('ADR identifier mismatch')),
  );
  assert.ok(
    result.errors.includes(
      'ADR-006 exists as a file but is missing from ADR_INDEX.md',
    ),
  );
  assert.ok(
    result.errors.includes(
      'ADR-007 exists in ADR_INDEX.md but has no ADR file',
    ),
  );
});
