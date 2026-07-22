import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const root = resolve(import.meta.dirname, '../..');
const postgresContainer =
  process.env.POSTGRES_CONTAINER ?? 'atlas-local-postgres-1';
const redisContainer = process.env.REDIS_CONTAINER ?? 'atlas-local-redis-1';
const database = process.env.RECOVERY_SOURCE_DATABASE ?? 'atlas_test';
const user = process.env.RECOVERY_POSTGRES_USER ?? 'atlas';
const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgresql://atlas:atlas-local-dev-2026@127.0.0.1:5432/atlas_test';
const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const drillId = randomUUID();

if (!database.endsWith('_test')) throw new Error('TEST_DATABASE_REQUIRED');

const fingerprintBefore = await fingerprint();
await psql(
  `insert into recovery_drills
    (id, drill_type, environment, target_rpo_seconds, target_rto_seconds,
     status, validation_summary, started_at)
   values ('${drillId}'::uuid, 'redis_loss', 'recovery', 0, 60, 'running',
           '{}', now())`,
);
await execFile('docker', ['restart', redisContainer]);
await waitForRedis();
await execFile('docker', ['exec', redisContainer, 'redis-cli', 'flushall']);
const drill = await execFile(
  'pnpm',
  [
    '--filter',
    '@atlas/worker',
    'exec',
    'tsx',
    'src/recovery/redis-loss-drill.ts',
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      RECOVERY_DRILL_ID: drillId,
      REDIS_URL: redisUrl,
    },
  },
);
const result = JSON.parse(drill.stdout.trim());
const fingerprintAfter = await fingerprint();
if (fingerprintAfter !== fingerprintBefore)
  throw new Error('POSTGRES_DURABLE_FINGERPRINT_CHANGED');
const report = {
  ...result,
  durableFingerprintEqual: true,
  environment: 'local PostgreSQL and restarted Redis containers',
};
const directory = resolve(root, 'reports/recovery');
await mkdir(directory, { recursive: true });
await writeFile(
  resolve(directory, 'redis-loss-drill.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
await writeFile(
  resolve(directory, 'redis-loss-drill.md'),
  `# TASK-076 Redis Loss Drill\n\n**${report.status}**\n\n` +
    `- Durable PostgreSQL loss: ${report.durableLoss}\n` +
    `- Duplicate jobs: ${report.duplicateJobs}\n` +
    `- Queue reconciliation: ${report.queueReconciliation}\n` +
    `- Cache rebuild: ${report.cacheRebuild}\n` +
    `- Durable fingerprint equal: ${report.durableFingerprintEqual}\n`,
);
process.stdout.write(`${JSON.stringify(report)}\n`);

async function psql(statement) {
  return execFile('docker', [
    'exec',
    postgresContainer,
    'psql',
    '-U',
    user,
    '-d',
    database,
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ]);
}

async function fingerprint() {
  const result = await psql(
    `select md5(concat_ws('|',
       (select count(*) from scan_runs),
       (select count(*) from scan_results),
       (select count(*) from backtest_runs),
       (select count(*) from backtest_fills),
       (select count(*) from backtest_trades),
       (select count(*) from backtest_summaries)))`,
  );
  return result.stdout.trim();
}

async function waitForRedis() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const result = await execFile('docker', [
        'exec',
        redisContainer,
        'redis-cli',
        'ping',
      ]);
      if (result.stdout.trim() === 'PONG') return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error('REDIS_RESTART_TIMEOUT');
}
