import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { EncryptedArtifactStore } from './encrypted-artifact-store';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'atlas-object-restore-'));
  try {
    const store = new EncryptedArtifactStore(
      root,
      randomBytes(32),
      'kms://recovery-drill/task-076',
    );
    const objectKey = 'recovery/backtests/series.json';
    const firstValue = Buffer.from('{"series":[1,2,3]}');
    const secondValue = Buffer.from('{"series":[1,2,3,4]}');
    const first = await store.put(objectKey, firstValue);
    const second = await store.put(objectKey, secondValue);
    const restored = await store.restore(objectKey, first.version);
    const encryptedPayload = await readFile(
      join(root, objectKey, `v${first.version}`, 'payload.enc'),
    );
    const orphanKey = 'recovery/orphans/export.csv';
    await store.put(orphanKey, Buffer.from('safe,export'));
    const orphanCount = await store.cleanupOrphans(
      [objectKey, orphanKey],
      (key) => Promise.resolve(key === objectKey),
    );
    const versions = await store.list(objectKey);
    const passed =
      Buffer.from(restored).equals(firstValue) &&
      !encryptedPayload.includes(firstValue) &&
      versions.length === 2 &&
      second.version === 2 &&
      orphanCount === 1;
    process.stdout.write(
      `${JSON.stringify({
        checksum: first.checksumSha256,
        encryption: 'AES-256-GCM',
        lifecycle: orphanCount === 1 ? 'PASS' : 'FAIL',
        restore: Buffer.from(restored).equals(firstValue) ? 'PASS' : 'FAIL',
        status: passed ? 'PASS' : 'FAIL',
        versioning: versions.length === 2 ? 'PASS' : 'FAIL',
      })}\n`,
    );
    if (!passed) process.exitCode = 1;
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      errorCategory:
        error instanceof Error ? error.constructor.name : 'UnknownError',
      eventCode: 'recovery.object_restore.failed',
    })}\n`,
  );
  process.exitCode = 1;
});
