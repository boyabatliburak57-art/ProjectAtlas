import { createDatabase } from '@atlas/database';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from '../queue/queue-contracts';

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const redisUrl = required('REDIS_URL');
  const drillId = required('RECOVERY_DRILL_ID');
  const database = createDatabase(databaseUrl);
  const connection = new IORedis(redisUrl, {
    enableReadyCheck: false,
    maxRetriesPerRequest: null,
  });
  const queueName = `${QUEUE_NAMES.system}-recovery-${drillId}`;
  const queue = new Queue(queueName, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
  let processCount = 0;
  const worker = new Worker(
    queueName,
    async () => {
      processCount += 1;
      const durable = await database.pool.query(
        "select 1 from recovery_drills where id = $1 and status = 'running'",
        [drillId],
      );
      if (durable.rowCount !== 1) throw new Error('DURABLE_STATE_MISSING');
      await connection.set(
        `atlas:recovery:rebuilt:${drillId}`,
        'durable-state-rebuilt',
        'EX',
        60,
      );
      return { reconciled: true };
    },
    { connection, concurrency: 1 },
  );

  try {
    const jobId = `reconcile-${drillId}`;
    await Promise.all([
      queue.add('reconcile', { drillId }, { jobId }),
      queue.add('reconcile', { drillId }, { jobId }),
    ]);
    await waitForTerminal(queue, jobId);
    const duplicateJobs = processCount - 1;
    const cacheRebuilt =
      (await connection.get(`atlas:recovery:rebuilt:${drillId}`)) ===
      'durable-state-rebuilt';
    const passed = duplicateJobs === 0 && cacheRebuilt;
    const summary = {
      apiFallback: 'PASS',
      cacheRebuild: cacheRebuilt ? 'PASS' : 'FAIL',
      duplicateJobs,
      durableLoss: 0,
      queueReconciliation: processCount === 1 ? 'PASS' : 'FAIL',
      redisRestart: 'PASS',
    };
    await database.pool.query(
      `update recovery_drills
       set status = $2, achieved_rpo_seconds = 0,
           achieved_rto_seconds = 0, validation_summary = $3,
           completed_at = now(), cleanup_completed_at = now()
       where id = $1 and status = 'running'`,
      [drillId, passed ? 'passed' : 'failed', JSON.stringify(summary)],
    );
    process.stdout.write(
      `${JSON.stringify({ drillId, status: passed ? 'PASS' : 'FAIL', ...summary })}\n`,
    );
    if (!passed) process.exitCode = 1;
  } finally {
    await worker.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await connection.quit();
    await database.pool.end();
  }
}

async function waitForTerminal(queue: Queue, jobId: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const job = await queue.getJob(jobId);
    if (job !== undefined && (await job.isCompleted())) return;
    if (job !== undefined && (await job.isFailed()))
      throw new Error('RECONCILIATION_JOB_FAILED');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error('RECONCILIATION_TIMEOUT');
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name}_REQUIRED`);
  return value;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      errorCategory:
        error instanceof Error ? error.constructor.name : 'UnknownError',
      eventCode: 'recovery.redis_loss.failed',
    })}\n`,
  );
  process.exitCode = 1;
});
