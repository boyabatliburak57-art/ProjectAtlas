import { describe, expect, it } from 'vitest';

import { parseBackupProviderStatus } from './backup-status-monitor';

describe('backup status provider boundary', () => {
  it('accepts a capability-complete safe status payload', () => {
    expect(
      parseBackupProviderStatus({
        backupCreatedAt: '2026-07-21T12:00:00.000Z',
        backupReference: 'managed-backup-076',
        encrypted: true,
        pitrEnabled: true,
        retentionDays: 35,
        separateFailureDomain: true,
        status: 'healthy',
      }),
    ).toMatchObject({ backupReference: 'managed-backup-076' });
  });

  it('rejects malformed/provider-secret-shaped payloads', () => {
    expect(() =>
      parseBackupProviderStatus({
        backupCreatedAt: 'invalid',
        backupReference: '',
        connectionString: 'postgresql://secret',
        encrypted: 'yes',
        pitrEnabled: true,
        retentionDays: 0,
        separateFailureDomain: true,
        status: 'healthy',
      }),
    ).toThrow('BACKUP_STATUS_INVALID');
  });
});
