import 'dotenv/config';

import { createDatabase } from '../client';

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const drillId = required('RESTORE_DRILL_ID');
  const environment = required('ATLAS_ENV');
  const maximumAgeDays = positiveInteger(
    process.env['RESTORE_DRILL_MAX_AGE_DAYS'] ?? '31',
  );
  const { pool } = createDatabase(databaseUrl);
  try {
    const result = await pool.query<{
      achieved_rpo_seconds: number;
      achieved_rto_seconds: number;
      cleanup_completed_at: Date | null;
      completed_at: Date;
      drill_type: string;
      status: string;
      target_rpo_seconds: number;
      target_rto_seconds: number;
    }>(
      `select drill_type, status, target_rpo_seconds, achieved_rpo_seconds,
              target_rto_seconds, achieved_rto_seconds, completed_at,
              cleanup_completed_at
       from recovery_drills
       where id = $1 and environment in ($2, 'recovery')`,
      [drillId, environment],
    );
    const drill = result.rows[0];
    const oldestAllowed = Date.now() - maximumAgeDays * 86_400_000;
    if (
      drill === undefined ||
      drill.drill_type !== 'full' ||
      drill.status !== 'passed' ||
      drill.cleanup_completed_at === null ||
      drill.completed_at.getTime() < oldestAllowed ||
      drill.achieved_rpo_seconds > drill.target_rpo_seconds ||
      drill.achieved_rto_seconds > drill.target_rto_seconds
    )
      throw new Error('RECOVERY_GATE_FAILED');
    process.stdout.write(
      JSON.stringify({
        drillId,
        eventCode: 'recovery.release-gate.passed',
        outcome: 'success',
      }) + '\n',
    );
  } finally {
    await pool.end();
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name}_REQUIRED`);
  return value;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('INVALID_BOUND');
  return parsed;
}

void main().catch((error: unknown) => {
  process.stderr.write(
    JSON.stringify({
      errorCategory:
        error instanceof Error ? error.constructor.name : 'UnknownError',
      eventCode: 'recovery.release-gate.failed',
      outcome: 'error',
    }) + '\n',
  );
  process.exitCode = 1;
});
