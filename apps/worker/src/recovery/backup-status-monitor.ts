import { createDatabase } from '@atlas/database';

export interface BackupProviderStatus {
  readonly backupCreatedAt: string;
  readonly backupReference: string;
  readonly encrypted: boolean;
  readonly pitrEnabled: boolean;
  readonly retentionDays: number;
  readonly separateFailureDomain: boolean;
  readonly status: 'healthy' | 'failed';
}

export function parseBackupProviderStatus(
  value: unknown,
): BackupProviderStatus {
  if (value === null || typeof value !== 'object')
    throw new Error('BACKUP_STATUS_INVALID');
  const record = value as Record<string, unknown>;
  const status = record['status'];
  const backupCreatedAt = record['backupCreatedAt'];
  const backupReference = record['backupReference'];
  const retentionDays = record['retentionDays'];
  if (
    (status !== 'healthy' && status !== 'failed') ||
    typeof backupCreatedAt !== 'string' ||
    !Number.isFinite(Date.parse(backupCreatedAt)) ||
    typeof backupReference !== 'string' ||
    backupReference.length < 1 ||
    backupReference.length > 256 ||
    typeof retentionDays !== 'number' ||
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 3650 ||
    typeof record['encrypted'] !== 'boolean' ||
    typeof record['pitrEnabled'] !== 'boolean' ||
    typeof record['separateFailureDomain'] !== 'boolean'
  )
    throw new Error('BACKUP_STATUS_INVALID');
  return {
    backupCreatedAt,
    backupReference,
    encrypted: record['encrypted'],
    pitrEnabled: record['pitrEnabled'],
    retentionDays,
    separateFailureDomain: record['separateFailureDomain'],
    status,
  };
}

export async function monitorBackupStatus(input: {
  readonly databaseUrl: string;
  readonly environment: string;
  readonly fetchStatus: () => Promise<unknown>;
  readonly maxAgeSeconds: number;
  readonly now?: Date;
  readonly providerAdapter: string;
}): Promise<BackupProviderStatus> {
  const now = input.now ?? new Date();
  const status = parseBackupProviderStatus(await input.fetchStatus());
  const ageSeconds = Math.max(
    0,
    Math.floor(
      (now.getTime() - new Date(status.backupCreatedAt).getTime()) / 1000,
    ),
  );
  const completeCapabilities =
    status.encrypted && status.pitrEnabled && status.separateFailureDomain;
  const effectiveStatus =
    status.status === 'healthy' && completeCapabilities
      ? ageSeconds <= input.maxAgeSeconds
        ? 'healthy'
        : 'stale'
      : 'failed';
  const { pool } = createDatabase(input.databaseUrl);
  try {
    await pool.query(
      `insert into backup_status_checks
        (environment, provider_adapter, backup_reference, backup_created_at,
         checked_at, encrypted, pitr_enabled, separate_failure_domain,
         retention_days, status, failure_code, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               jsonb_build_object('ageSeconds', $12::integer))
       on conflict (environment, backup_reference) do update
       set checked_at = excluded.checked_at, status = excluded.status,
           failure_code = excluded.failure_code, metadata = excluded.metadata`,
      [
        input.environment,
        input.providerAdapter,
        status.backupReference,
        status.backupCreatedAt,
        now,
        status.encrypted,
        status.pitrEnabled,
        status.separateFailureDomain,
        status.retentionDays,
        effectiveStatus,
        effectiveStatus === 'healthy'
          ? null
          : effectiveStatus === 'stale'
            ? 'BACKUP_STATUS_STALE'
            : 'BACKUP_CAPABILITY_FAILED',
        ageSeconds,
      ],
    );
  } finally {
    await pool.end();
  }
  if (effectiveStatus !== 'healthy') throw new Error('BACKUP_GATE_FAILED');
  return status;
}

async function main(): Promise<void> {
  const endpoint = required('BACKUP_STATUS_ENDPOINT');
  const token = required('BACKUP_STATUS_TOKEN');
  await monitorBackupStatus({
    databaseUrl: required('DATABASE_URL'),
    environment: required('ATLAS_ENV'),
    fetchStatus: async () => {
      const response = await fetch(endpoint, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error('BACKUP_PROVIDER_UNAVAILABLE');
      return response.json() as Promise<unknown>;
    },
    maxAgeSeconds: Number(
      process.env['BACKUP_STATUS_MAX_AGE_SECONDS'] ?? '3600',
    ),
    providerAdapter: process.env['BACKUP_PROVIDER_ADAPTER'] ?? 'managed-v1',
  });
  process.stdout.write(
    JSON.stringify({ eventCode: 'backup.status.healthy', outcome: 'success' }) +
      '\n',
  );
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name}_REQUIRED`);
  return value;
}

if (require.main === module)
  void main().catch((error: unknown) => {
    process.stderr.write(
      JSON.stringify({
        errorCategory:
          error instanceof Error ? error.constructor.name : 'UnknownError',
        eventCode: 'backup.status.failed',
        outcome: 'error',
      }) + '\n',
    );
    process.exitCode = 1;
  });
