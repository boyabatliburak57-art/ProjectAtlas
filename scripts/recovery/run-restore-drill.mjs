import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, '../..');
const container = process.env.POSTGRES_CONTAINER ?? 'atlas-local-postgres-1';
const sourceDatabase = process.env.RECOVERY_SOURCE_DATABASE ?? 'atlas_test';
const recoveryDatabase =
  process.env.RECOVERY_TARGET_DATABASE ?? 'atlas_recovery_076';
const postgresUser = process.env.RECOVERY_POSTGRES_USER ?? 'atlas';
const host = process.env.RECOVERY_DATABASE_HOST ?? '127.0.0.1';
const port = process.env.RECOVERY_DATABASE_PORT ?? '5432';
const password =
  process.env.RECOVERY_DATABASE_PASSWORD ?? 'atlas-local-dev-2026';
const apiPort = process.env.RECOVERY_API_PORT ?? '43276';

assertSafeDatabaseNames();

const drillId = randomUUID();
const startedAt = new Date();
const backupReference = `local-encrypted-${startedAt.toISOString()}`;
const workspace = await mkdtemp(join(tmpdir(), 'atlas-recovery-drill-'));
const dumpInContainer = `/tmp/atlas-${drillId}.dump`;
const restoreDumpInContainer = `/tmp/atlas-${drillId}-restore.dump`;
const plainDump = join(workspace, 'source.dump');
const encryptedDump = join(workspace, 'source.dump.enc');
const restoredDump = join(workspace, 'restore.dump');
const controlUrl = databaseUrl(sourceDatabase);
const restoredUrl = databaseUrl(recoveryDatabase);
let api;
let terminalEvidence;

try {
  await dockerPsql(sourceDatabase, 'select 1');
  const sourceCutoffAt = (
    await dockerPsql(
      sourceDatabase,
      "select clock_timestamp() at time zone 'UTC'",
    )
  ).trim();
  await execFile('docker', [
    'exec',
    container,
    'pg_dump',
    '-U',
    postgresUser,
    '-d',
    sourceDatabase,
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--file',
    dumpInContainer,
  ]);
  await execFile('docker', [
    'cp',
    `${container}:${dumpInContainer}`,
    plainDump,
  ]);
  const plaintext = await readFile(plainDump);
  const plaintextChecksum = sha256(plaintext);
  const key = resolveEncryptionKey();
  await writeFile(encryptedDump, encrypt(plaintext, key), { mode: 0o600 });
  await rm(plainDump, { force: true });
  const encrypted = await readFile(encryptedDump);
  const decrypted = decrypt(encrypted, key);
  if (sha256(decrypted) !== plaintextChecksum)
    throw new Error('BACKUP_CHECKSUM_MISMATCH');
  await writeFile(restoredDump, decrypted, { mode: 0o600 });

  await terminateAndDropRecoveryDatabase();
  await dockerPsql(
    'postgres',
    `create database ${quoteIdentifier(recoveryDatabase)}`,
  );
  await execFile('docker', [
    'cp',
    restoredDump,
    `${container}:${restoreDumpInContainer}`,
  ]);
  await execFile('docker', [
    'exec',
    container,
    'pg_restore',
    '-U',
    postgresUser,
    '-d',
    recoveryDatabase,
    '--no-owner',
    '--no-privileges',
    restoreDumpInContainer,
  ]);

  api = spawn('node', ['apps/api/dist/main.js'], {
    cwd: root,
    env: {
      ...process.env,
      API_CORS_ORIGIN: 'http://127.0.0.1:3000',
      API_HOST: '127.0.0.1',
      API_PORT: apiPort,
      ATLAS_ENV: 'test',
      AUTH_SESSION_HMAC_KEY: 'restore-drill-auth-key-32-bytes-minimum',
      DATABASE_URL: restoredUrl,
      HEALTH_CHECK_DATABASE: 'true',
      NODE_ENV: 'test',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  await waitForReady(`http://127.0.0.1:${apiPort}/health/ready`, api);

  const drill = await execFile(
    'pnpm',
    ['--filter', '@atlas/database', 'exec', 'tsx', 'src/cli/restore-drill.ts'],
    {
      cwd: root,
      env: {
        ...process.env,
        DATABASE_URL: controlUrl,
        RECOVERY_BACKUP_REFERENCE: backupReference,
        RECOVERY_DATABASE_URL: restoredUrl,
        RECOVERY_DRILL_ID: drillId,
        RECOVERY_DRILL_STARTED_AT: startedAt.toISOString(),
        RECOVERY_RPO_TARGET_SECONDS: '900',
        RECOVERY_RTO_TARGET_SECONDS: '7200',
        RECOVERY_SMOKE_URL: `http://127.0.0.1:${apiPort}/health/ready`,
        RECOVERY_SOURCE_CUTOFF_AT: `${sourceCutoffAt}Z`,
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  terminalEvidence = JSON.parse(drill.stdout.trim());
  if (terminalEvidence.status !== 'PASS')
    throw new Error('RESTORE_DRILL_FAILED');
  await shutdownApi();
  await dockerPsql(
    sourceDatabase,
    `update recovery_drills set cleanup_completed_at = now() where id = '${drillId}'::uuid`,
  );
  await terminateAndDropRecoveryDatabase();
  await writeReports({
    ...terminalEvidence,
    backup: {
      encrypted: true,
      encryption: 'AES-256-GCM',
      plaintextChecksum,
      reference: backupReference,
      separateFailureDomain:
        'local isolated host artifact (production adapter: managed KMS replica domain)',
    },
    cleanup: 'PASS',
    environment: 'local isolated recovery database',
  });
  process.stdout.write(`${JSON.stringify(terminalEvidence)}\n`);
} catch (error) {
  await writeReports({
    drillId,
    errorCategory:
      error instanceof Error ? error.constructor.name : 'UnknownError',
    status: 'FAIL',
  });
  throw error;
} finally {
  await shutdownApi();
  await terminateAndDropRecoveryDatabase().catch(() => undefined);
  await execFile('docker', [
    'exec',
    container,
    'rm',
    '-f',
    dumpInContainer,
    restoreDumpInContainer,
  ]).catch(() => undefined);
  await rm(workspace, { force: true, recursive: true });
}

function assertSafeDatabaseNames() {
  if (!sourceDatabase.endsWith('_test'))
    throw new Error('RECOVERY_SOURCE_DATABASE_MUST_END_WITH_TEST');
  if (!recoveryDatabase.startsWith('atlas_recovery_'))
    throw new Error('RECOVERY_TARGET_DATABASE_INVALID');
}

function databaseUrl(database) {
  return `postgresql://${encodeURIComponent(postgresUser)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

async function dockerPsql(database, statement) {
  const result = await execFile('docker', [
    'exec',
    container,
    'psql',
    '-U',
    postgresUser,
    '-d',
    database,
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ]);
  return result.stdout;
}

async function terminateAndDropRecoveryDatabase() {
  await dockerPsql(
    'postgres',
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${recoveryDatabase.replaceAll("'", "''")}' and pid <> pg_backend_pid()`,
  );
  await dockerPsql(
    'postgres',
    `drop database if exists ${quoteIdentifier(recoveryDatabase)}`,
  );
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function resolveEncryptionKey() {
  const configured = process.env.RECOVERY_BACKUP_KEY_BASE64;
  if (configured === undefined) return randomBytes(32);
  const key = Buffer.from(configured, 'base64');
  if (key.byteLength !== 32) throw new Error('RECOVERY_BACKUP_KEY_INVALID');
  return key;
}

function encrypt(value, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
}

function decrypt(value, key) {
  if (value.byteLength < 29) throw new Error('BACKUP_CIPHERTEXT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function waitForReady(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('RESTORED_API_EXITED');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error('RESTORED_API_READINESS_TIMEOUT');
}

async function shutdownApi() {
  if (api === undefined || api.exitCode !== null) return;
  api.kill('SIGTERM');
  await Promise.race([
    new Promise((resolvePromise) => api.once('exit', resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000)),
  ]);
  if (api.exitCode === null) api.kill('SIGKILL');
}

async function writeReports(result) {
  const directory = join(root, 'reports', 'recovery');
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(directory, { recursive: true }),
  );
  await writeFile(
    join(directory, 'restore-drill.json'),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  const validation = result.validation ?? {};
  await writeFile(
    join(directory, 'restore-drill.md'),
    `# TASK-076 Restore Drill\n\n` +
      `**${result.status ?? 'FAIL'}**\n\n` +
      `- Drill ID: \`${result.drillId ?? drillId}\`\n` +
      `- Achieved RPO: ${result.achievedRpoSeconds ?? 'not measured'} seconds\n` +
      `- Achieved RTO: ${result.achievedRtoSeconds ?? 'not measured'} seconds\n` +
      `- Application smoke: ${validation.applicationSmoke ?? 'FAIL'}\n` +
      `- Migration version: ${validation.migrationVersion ?? 'FAIL'}\n` +
      `- Row-count mismatch: ${validation.rowCountMismatchCount ?? 'not measured'}\n` +
      `- Business invariant failures: ${validation.businessInvariantFailures ?? 'not measured'}\n` +
      `- Cleanup: ${result.cleanup ?? 'FAIL'}\n`,
  );
}
