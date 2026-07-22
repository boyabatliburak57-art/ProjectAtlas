import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const checks = [
  [
    'deploy/recovery/capabilities.yaml',
    [
      'pitr:',
      'encryptionAtRest: required',
      'failureDomain: separate-from-primary',
      'retentionDays: 35',
      'runtimeCredential:',
      'restoreCredential:',
    ],
  ],
  [
    'deploy/kubernetes/base/recovery.yaml',
    [
      'atlas-backup-status-monitor',
      'atlas-recovery-gate-template',
      'atlas-restore-drill-template',
      'atlas-restore-secrets',
    ],
  ],
  [
    'observability/alerts/prometheus-rules.yaml',
    [
      'AtlasPostgresBackupFailed',
      'AtlasRecoveryDrillExpired',
      'runbook_url',
      'recovery_notification',
    ],
  ],
  [
    '.github/workflows/production-release.yml',
    [
      'Verify persisted restore rehearsal gate',
      'render-recovery-gate-job.mjs',
      'restore_drill_id',
    ],
  ],
  [
    'packages/database/drizzle/0012_recovery_retention.sql',
    [
      'CREATE TABLE "recovery_drills"',
      'CREATE TABLE "legal_holds"',
      'CREATE TABLE "account_deletion_requests"',
    ],
  ],
  [
    'guides/BACKUP_RESTORE_AND_RETENTION_RUNBOOK.md',
    ['RPO', 'RTO', 'Legal hold', 'Forward-fix'],
  ],
];

const failures = [];
for (const [path, required] of checks) {
  const contents = await readFile(resolve(root, path), 'utf8');
  for (const value of required) {
    if (!contents.includes(value)) failures.push(`${path}: missing ${value}`);
  }
}

const capability = await readFile(
  resolve(root, 'deploy/recovery/capabilities.yaml'),
  'utf8',
);
const runtimeSecret = /runtimeCredential:\s*([^\s]+)/u.exec(capability)?.[1];
const restoreSecret = /restoreCredential:\s*([^\s]+)/u.exec(capability)?.[1];
if (runtimeSecret === undefined || runtimeSecret === restoreSecret)
  failures.push(
    'restore credentials are not separated from runtime credentials',
  );

process.stdout.write(
  `${JSON.stringify({ checks: checks.length + 1, failures, status: failures.length === 0 ? 'PASS' : 'FAIL' })}\n`,
);
if (failures.length > 0) process.exitCode = 1;
