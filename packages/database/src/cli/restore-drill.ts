import 'dotenv/config';

import { randomUUID } from 'node:crypto';

import { createDatabase } from '../client';
import { validateRestoredDatabase } from '../recovery/restore-validation';

async function main(): Promise<void> {
  const drillId = process.env['RECOVERY_DRILL_ID'] ?? randomUUID();
  const control = createDatabase(required('DATABASE_URL'));
  const restored = createDatabase(required('RECOVERY_DATABASE_URL'));
  const startedAt = new Date(required('RECOVERY_DRILL_STARTED_AT'));
  const sourceCutoffAt = new Date(required('RECOVERY_SOURCE_CUTOFF_AT'));
  const targetRpoSeconds = positiveInteger(
    process.env['RECOVERY_RPO_TARGET_SECONDS'] ?? '900',
  );
  const targetRtoSeconds = positiveInteger(
    process.env['RECOVERY_RTO_TARGET_SECONDS'] ?? '7200',
  );
  const achievedRpoSeconds = Math.max(
    0,
    Math.ceil((startedAt.getTime() - sourceCutoffAt.getTime()) / 1000),
  );
  let drillRecorded = false;
  try {
    const sourceValidation = await validateRestoredDatabase(control.pool);
    await control.pool.query(
      `insert into recovery_drills
        (id, drill_type, environment, backup_reference, source_cutoff_at,
         target_rpo_seconds, target_rto_seconds, status, started_at)
       values ($1, 'full', 'recovery', $2, $3, $4, $5, 'running', $6)
       on conflict (id) do nothing`,
      [
        drillId,
        required('RECOVERY_BACKUP_REFERENCE'),
        sourceCutoffAt,
        targetRpoSeconds,
        targetRtoSeconds,
        startedAt,
      ],
    );
    drillRecorded = true;
    const validation = await validateRestoredDatabase(restored.pool);
    const rowCountMismatchCount = countRowMismatches(
      sourceValidation.rowCounts,
      validation.rowCounts,
    );
    const migrationVersionMatches =
      sourceValidation.migrationCount === validation.migrationCount;
    const smoke = await applicationSmoke(required('RECOVERY_SMOKE_URL'));
    const completedAt = new Date();
    const achievedRtoSeconds = Math.max(
      0,
      Math.ceil((completedAt.getTime() - startedAt.getTime()) / 1000),
    );
    const passed =
      validation.businessInvariantFailures === 0 &&
      rowCountMismatchCount === 0 &&
      migrationVersionMatches &&
      validation.migrationCount >= 12 &&
      smoke &&
      achievedRpoSeconds <= targetRpoSeconds &&
      achievedRtoSeconds <= targetRtoSeconds;
    const summary = {
      ...validation,
      applicationSmoke: smoke ? 'PASS' : 'FAIL',
      migrationVersion: migrationVersionMatches ? 'PASS' : 'FAIL',
      rowCountMismatchCount,
      rpo: achievedRpoSeconds <= targetRpoSeconds ? 'PASS' : 'FAIL',
      rto: achievedRtoSeconds <= targetRtoSeconds ? 'PASS' : 'FAIL',
    };
    await control.pool.query(
      `update recovery_drills
       set status = $2, achieved_rpo_seconds = $3, achieved_rto_seconds = $4,
           validation_summary = $5, completed_at = $6
       where id = $1 and status = 'running'`,
      [
        drillId,
        passed ? 'passed' : 'failed',
        achievedRpoSeconds,
        achievedRtoSeconds,
        JSON.stringify(summary),
        completedAt,
      ],
    );
    process.stdout.write(
      JSON.stringify({
        achievedRpoSeconds,
        achievedRtoSeconds,
        drillId,
        status: passed ? 'PASS' : 'FAIL',
        validation: summary,
      }) + '\n',
    );
    if (!passed) process.exitCode = 1;
  } catch (error) {
    if (drillRecorded) {
      await control.pool.query(
        `update recovery_drills
         set status = 'failed', validation_summary = $2, completed_at = now()
         where id = $1 and status = 'running'`,
        [
          drillId,
          JSON.stringify({
            errorCode: 'RESTORE_DRILL_EXECUTION_FAILED',
            errorCategory:
              error instanceof Error ? error.constructor.name : 'UnknownError',
          }),
        ],
      );
    }
    throw error;
  } finally {
    await Promise.allSettled([control.pool.end(), restored.pool.end()]);
  }
}

async function applicationSmoke(url: string): Promise<boolean> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) return false;
  const value = (await response.json()) as unknown;
  if (value === null || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (record['status'] === 'ok') return true;
  const data = record['data'];
  return (
    data !== null &&
    typeof data === 'object' &&
    ['ok', 'ready', 'started'].includes(
      String((data as Record<string, unknown>)['status']),
    )
  );
}

const RECOVERY_BOOKKEEPING_TABLES = new Set([
  'account_deletion_requests',
  'backup_status_checks',
  'recovery_drills',
  'retention_job_runs',
]);

function countRowMismatches(
  source: Readonly<Record<string, number>>,
  restored: Readonly<Record<string, number>>,
): number {
  const names = new Set([...Object.keys(source), ...Object.keys(restored)]);
  let mismatches = 0;
  for (const name of names) {
    if (RECOVERY_BOOKKEEPING_TABLES.has(name)) continue;
    if (source[name] !== restored[name]) mismatches += 1;
  }
  return mismatches;
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
      eventCode: 'recovery.drill.failed',
      outcome: 'error',
    }) + '\n',
  );
  process.exitCode = 1;
});
