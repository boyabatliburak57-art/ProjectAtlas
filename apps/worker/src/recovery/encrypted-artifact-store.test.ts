import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ArtifactIntegrityError,
  EncryptedArtifactStore,
} from './encrypted-artifact-store';

describe('encrypted versioned artifact store', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined)
      await rm(directory, { force: true, recursive: true });
  });

  async function fixture() {
    directory = await mkdtemp(join(tmpdir(), 'atlas-artifact-'));
    return new EncryptedArtifactStore(
      directory,
      randomBytes(32),
      'kms://atlas/recovery-v1',
      () => new Date('2026-07-21T12:00:00.000Z'),
    );
  }

  it('encrypts, checksums and restores an artifact', async () => {
    const store = await fixture();
    const source = Buffer.from('private backtest series fixture', 'utf8');
    const metadata = await store.put('backtests/run-076/series.json', source);
    expect(metadata).toMatchObject({ byteSize: source.byteLength, version: 1 });
    expect(metadata.checksumSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      Buffer.from(
        await store.restore('backtests/run-076/series.json', 1),
      ).toString('utf8'),
    ).toBe(source.toString('utf8'));
    const ciphertext = await readFile(
      join(directory!, 'backtests/run-076/series.json/v1/payload.enc'),
    );
    expect(ciphertext.includes(source)).toBe(false);
  });

  it('keeps independent immutable versions', async () => {
    const store = await fixture();
    await store.put('exports/user-076/transactions.csv', Buffer.from('v1'));
    await store.put('exports/user-076/transactions.csv', Buffer.from('v2'));
    expect(await store.list('exports/user-076/transactions.csv')).toHaveLength(
      2,
    );
    expect(
      Buffer.from(
        await store.restore('exports/user-076/transactions.csv', 1),
      ).toString(),
    ).toBe('v1');
  });

  it('rejects ciphertext tampering and path traversal', async () => {
    const store = await fixture();
    await store.put('imports/user-076/source.csv', Buffer.from('safe'));
    await writeFile(
      join(directory!, 'imports/user-076/source.csv/v1/payload.enc'),
      Buffer.alloc(40, 1),
    );
    await expect(
      store.restore('imports/user-076/source.csv', 1),
    ).rejects.toBeInstanceOf(ArtifactIntegrityError);
    await expect(
      store.put('../escape', Buffer.from('x')),
    ).rejects.toMatchObject({ message: 'ARTIFACT_OBJECT_KEY_INVALID' });
  });

  it('deletes a selected version and cleans only unreferenced objects', async () => {
    const store = await fixture();
    await store.put('exports/keep.csv', Buffer.from('keep'));
    await store.put('exports/orphan.csv', Buffer.from('orphan'));
    await store.deleteVersion('exports/keep.csv', 1);
    expect(await store.list('exports/keep.csv')).toEqual([]);
    expect(
      await store.cleanupOrphans(
        ['exports/keep.csv', 'exports/orphan.csv'],
        (key) => Promise.resolve(key === 'exports/keep.csv'),
      ),
    ).toBe(1);
    expect(await store.list('exports/orphan.csv')).toEqual([]);
  });
});
