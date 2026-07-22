import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export interface StoredArtifactVersion {
  readonly byteSize: number;
  readonly checksumSha256: string;
  readonly createdAt: string;
  readonly encryptionKeyReference: string;
  readonly objectKey: string;
  readonly version: number;
}

interface ArtifactManifest extends StoredArtifactVersion {
  readonly format: 'atlas-aes-256-gcm-v1';
}

export class ArtifactIntegrityError extends Error {
  override readonly name = 'ArtifactIntegrityError';
}

export class EncryptedArtifactStore {
  constructor(
    private readonly rootDirectory: string,
    private readonly encryptionKey: Uint8Array,
    private readonly encryptionKeyReference: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (encryptionKey.byteLength !== 32)
      throw new ArtifactIntegrityError('ARTIFACT_KEY_LENGTH_INVALID');
    if (encryptionKeyReference.length < 8)
      throw new ArtifactIntegrityError('ARTIFACT_KEY_REFERENCE_INVALID');
  }

  async put(
    objectKey: string,
    value: Uint8Array,
  ): Promise<StoredArtifactVersion> {
    const key = safeObjectKey(objectKey);
    const versions = await this.list(key);
    const version = (versions.at(-1)?.version ?? 0) + 1;
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.encryptionKey),
      nonce,
    );
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(value)),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([nonce, tag, encrypted]);
    const manifest: ArtifactManifest = {
      byteSize: value.byteLength,
      checksumSha256: checksum(value),
      createdAt: this.now().toISOString(),
      encryptionKeyReference: this.encryptionKeyReference,
      format: 'atlas-aes-256-gcm-v1',
      objectKey: key,
      version,
    };
    const directory = this.versionDirectory(key, version);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'payload.enc'), payload, { mode: 0o600 });
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify(manifest),
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    );
    return manifest;
  }

  async restore(objectKey: string, version: number): Promise<Uint8Array> {
    const key = safeObjectKey(objectKey);
    if (!Number.isInteger(version) || version < 1)
      throw new ArtifactIntegrityError('ARTIFACT_VERSION_INVALID');
    const directory = this.versionDirectory(key, version);
    const manifest = JSON.parse(
      await readFile(join(directory, 'manifest.json'), 'utf8'),
    ) as ArtifactManifest;
    if (
      manifest.format !== 'atlas-aes-256-gcm-v1' ||
      manifest.objectKey !== key ||
      manifest.version !== version ||
      manifest.encryptionKeyReference !== this.encryptionKeyReference
    )
      throw new ArtifactIntegrityError('ARTIFACT_MANIFEST_MISMATCH');
    const payload = await readFile(join(directory, 'payload.enc'));
    if (payload.byteLength < 29)
      throw new ArtifactIntegrityError('ARTIFACT_CIPHERTEXT_INVALID');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.encryptionKey),
      payload.subarray(0, 12),
    );
    decipher.setAuthTag(payload.subarray(12, 28));
    let plaintext: Buffer;
    try {
      plaintext = Buffer.concat([
        decipher.update(payload.subarray(28)),
        decipher.final(),
      ]);
    } catch {
      throw new ArtifactIntegrityError('ARTIFACT_AUTHENTICATION_FAILED');
    }
    if (
      plaintext.byteLength !== manifest.byteSize ||
      checksum(plaintext) !== manifest.checksumSha256
    )
      throw new ArtifactIntegrityError('ARTIFACT_CHECKSUM_MISMATCH');
    return plaintext;
  }

  async list(objectKey: string): Promise<readonly StoredArtifactVersion[]> {
    const key = safeObjectKey(objectKey);
    const directory = this.objectDirectory(key);
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (isMissing(error)) return [];
        throw error;
      },
    );
    const manifests: StoredArtifactVersion[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^v\d+$/u.test(entry.name)) continue;
      const manifest = JSON.parse(
        await readFile(join(directory, entry.name, 'manifest.json'), 'utf8'),
      ) as ArtifactManifest;
      manifests.push(manifest);
    }
    return manifests.sort((left, right) => left.version - right.version);
  }

  async deleteVersion(objectKey: string, version: number): Promise<void> {
    const key = safeObjectKey(objectKey);
    await rm(this.versionDirectory(key, version), {
      force: true,
      recursive: true,
    });
  }

  async cleanupOrphans(
    objectKeys: readonly string[],
    isReferenced: (objectKey: string) => Promise<boolean>,
  ): Promise<number> {
    let deleted = 0;
    for (const objectKey of objectKeys) {
      const key = safeObjectKey(objectKey);
      if (await isReferenced(key)) continue;
      await rm(this.objectDirectory(key), { force: true, recursive: true });
      deleted += 1;
    }
    return deleted;
  }

  private objectDirectory(objectKey: string): string {
    const candidate = resolve(this.rootDirectory, objectKey);
    const root = `${resolve(this.rootDirectory)}/`;
    if (!`${candidate}/`.startsWith(root))
      throw new ArtifactIntegrityError('ARTIFACT_PATH_INVALID');
    return candidate;
  }

  private versionDirectory(objectKey: string, version: number): string {
    const candidate = join(this.objectDirectory(objectKey), `v${version}`);
    if (dirname(candidate) !== this.objectDirectory(objectKey))
      throw new ArtifactIntegrityError('ARTIFACT_PATH_INVALID');
    return candidate;
  }
}

function safeObjectKey(value: string): string {
  if (
    value.length < 1 ||
    value.length > 512 ||
    value.startsWith('/') ||
    value.includes('..') ||
    !/^[a-zA-Z0-9/_\-.]+$/u.test(value)
  )
    throw new ArtifactIntegrityError('ARTIFACT_OBJECT_KEY_INVALID');
  return value;
}

function checksum(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
