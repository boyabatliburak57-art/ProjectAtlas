import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  AccountDeletionService,
  type AccountDeletionRepository,
  type AccountDeletionRequest,
  RecoveryPolicyError,
  type RetentionCandidate,
  type RetentionRepository,
  type RetentionRunResult,
  RetentionService,
} from './recovery';

class MemoryRetentionRepository implements RetentionRepository {
  readonly audits: string[] = [];
  readonly deleted: string[] = [];
  readonly failed: string[] = [];
  readonly runs = new Map<string, RetentionRunResult>();
  candidatesValue: readonly RetentionCandidate[] = [];
  held = new Set<string>();
  throwOnDelete = false;

  begin(input: { readonly executionKey: string }) {
    const replay = this.runs.get(input.executionKey);
    return Promise.resolve(replay === undefined ? {} : { replay });
  }

  candidates() {
    return Promise.resolve(this.candidatesValue);
  }

  isHeld(candidate: RetentionCandidate) {
    return Promise.resolve(this.held.has(candidate.id));
  }

  deleteCandidate(candidate: RetentionCandidate) {
    if (this.throwOnDelete) throw new Error('fixture failure');
    if (this.deleted.includes(candidate.id)) return Promise.resolve(false);
    this.deleted.push(candidate.id);
    return Promise.resolve(true);
  }

  complete(result: RetentionRunResult) {
    this.runs.set(result.executionKey, result);
    return Promise.resolve();
  }

  fail(executionKey: string) {
    this.failed.push(executionKey);
    return Promise.resolve();
  }

  audit(input: { readonly action: string }) {
    this.audits.push(input.action);
    return Promise.resolve();
  }
}

class MemoryDeletionRepository implements AccountDeletionRepository {
  readonly actions: string[] = [];
  readonly requests = new Map<string, AccountDeletionRequest>();
  dueValue: readonly AccountDeletionRequest[] = [];
  held = new Set<string>();
  failPurge = false;
  sequence: string[] = [];

  findByIdempotencyKey(key: string) {
    return Promise.resolve(this.requests.get(key) ?? null);
  }

  disableAndSchedule(input: {
    readonly graceUntil: Date;
    readonly idempotencyKey: string;
    readonly subjectHash: string;
    readonly userId: string;
  }) {
    const request: AccountDeletionRequest = {
      graceUntil: input.graceUntil,
      id: `deletion-${this.requests.size + 1}`,
      idempotencyKey: input.idempotencyKey,
      status: 'disabled',
      subjectHash: input.subjectHash,
      userId: input.userId,
    };
    this.requests.set(input.idempotencyKey, request);
    this.sequence.push('disable');
    return Promise.resolve(request);
  }

  revokeSessions() {
    this.sequence.push('revoke-sessions');
    return Promise.resolve();
  }

  due() {
    return Promise.resolve(this.dueValue);
  }

  isUserHeld(userId: string) {
    return Promise.resolve(this.held.has(userId));
  }

  claim() {
    this.sequence.push('claim');
    return Promise.resolve(true);
  }

  deleteArtifacts() {
    this.sequence.push('artifacts');
    return Promise.resolve();
  }

  purgePrivateResources() {
    this.sequence.push('resources');
    if (this.failPurge) return Promise.reject(new Error('fixture failure'));
    return Promise.resolve();
  }

  deleteIdentityAndTombstone() {
    this.sequence.push('tombstone');
    return Promise.resolve();
  }

  markFailed() {
    this.sequence.push('failed');
    return Promise.resolve();
  }

  audit(input: { readonly action: string }) {
    this.actions.push(input.action);
    return Promise.resolve();
  }
}

const now = new Date('2026-07-21T12:00:00.000Z');
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

describe('retention service', () => {
  it('deletes an eligible batch and writes an audit result', async () => {
    const repository = new MemoryRetentionRepository();
    repository.candidatesValue = [
      { category: 'notifications', id: 'n-1' },
      { category: 'notifications', id: 'n-2' },
    ];
    const result = await new RetentionService(repository).run(
      'notifications',
      'retention-notifications-076',
      now,
    );
    expect(result).toMatchObject({
      deletedCount: 2,
      scannedCount: 2,
      skippedCount: 0,
    });
    expect(repository.audits).toEqual(['retention.batch.completed']);
  });

  it('does not delete candidates protected by a legal/security hold', async () => {
    const repository = new MemoryRetentionRepository();
    repository.candidatesValue = [
      { category: 'exports', id: 'held-export', ownerUserId: 'user-1' },
      { category: 'exports', id: 'expired-export', ownerUserId: 'user-2' },
    ];
    repository.held.add('held-export');
    const result = await new RetentionService(repository).run(
      'exports',
      'retention-exports-076',
      now,
    );
    expect(result).toMatchObject({ deletedCount: 1, skippedCount: 1 });
    expect(repository.deleted).toEqual(['expired-export']);
  });

  it('returns the persisted result for an idempotent replay', async () => {
    const repository = new MemoryRetentionRepository();
    repository.candidatesValue = [
      { category: 'scan_details', id: 'scan-result-1' },
    ];
    const service = new RetentionService(repository);
    const first = await service.run('scan_details', 'retention-scan-076', now);
    repository.candidatesValue = [
      { category: 'scan_details', id: 'scan-result-2' },
    ];
    expect(
      await service.run('scan_details', 'retention-scan-076', now),
    ).toEqual(first);
    expect(repository.deleted).toEqual(['scan-result-1']);
  });

  it('records a failed run without swallowing the error', async () => {
    const repository = new MemoryRetentionRepository();
    repository.candidatesValue = [
      { category: 'backtest_details', id: 'fill-1' },
    ];
    repository.throwOnDelete = true;
    await expect(
      new RetentionService(repository).run(
        'backtest_details',
        'retention-backtest-076',
        now,
      ),
    ).rejects.toThrow('fixture failure');
    expect(repository.failed).toEqual(['retention-backtest-076']);
  });

  it('rejects unsafe batch and execution key bounds', async () => {
    expect(
      () => new RetentionService(new MemoryRetentionRepository(), 1001),
    ).toThrowError(RecoveryPolicyError);
    await expect(
      new RetentionService(new MemoryRetentionRepository()).run(
        'notifications',
        'short',
        now,
      ),
    ).rejects.toMatchObject({ code: 'RETENTION_EXECUTION_KEY_INVALID' });
  });
});

describe('account deletion service', () => {
  it('denies deletion requests for another user', async () => {
    const service = new AccountDeletionService(
      new MemoryDeletionRepository(),
      hash,
    );
    await expect(
      service.request(
        { isOperationsAdmin: false, userId: 'user-a' },
        'user-b',
        'deletion-user-b-076',
        now,
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_DELETION_ACCESS_DENIED' });
  });

  it('disables the account, establishes grace and revokes sessions', async () => {
    const repository = new MemoryDeletionRepository();
    const request = await new AccountDeletionService(repository, hash).request(
      { isOperationsAdmin: false, userId: 'user-a' },
      'user-a',
      'deletion-user-a-076',
      now,
    );
    expect(request.graceUntil.toISOString()).toBe('2026-08-20T12:00:00.000Z');
    expect(request.subjectHash).toHaveLength(64);
    expect(repository.sequence).toEqual(['disable', 'revoke-sessions']);
  });

  it('replays the same deletion command without a second disable', async () => {
    const repository = new MemoryDeletionRepository();
    const service = new AccountDeletionService(repository, hash);
    const first = await service.request(
      { isOperationsAdmin: false, userId: 'user-a' },
      'user-a',
      'deletion-replay-076',
      now,
    );
    expect(
      await service.request(
        { isOperationsAdmin: false, userId: 'user-a' },
        'user-a',
        'deletion-replay-076',
        now,
      ),
    ).toEqual(first);
    expect(repository.sequence).toEqual(['disable', 'revoke-sessions']);
  });

  it('rejects an idempotency key replayed for a different subject', async () => {
    const repository = new MemoryDeletionRepository();
    const service = new AccountDeletionService(repository, hash);
    await service.request(
      { isOperationsAdmin: true, userId: 'admin' },
      'user-a',
      'deletion-conflict-076',
      now,
    );
    await expect(
      service.request(
        { isOperationsAdmin: true, userId: 'admin' },
        'user-b',
        'deletion-conflict-076',
        now,
      ),
    ).rejects.toMatchObject({
      code: 'ACCOUNT_DELETION_IDEMPOTENCY_CONFLICT',
    });
  });

  it('purges artifacts before resources and preserves a safe tombstone', async () => {
    const repository = new MemoryDeletionRepository();
    const request: AccountDeletionRequest = {
      graceUntil: now,
      id: 'deletion-due-076',
      idempotencyKey: 'req-076-due-a',
      status: 'disabled',
      subjectHash: hash('user-a'),
      userId: 'user-a',
    };
    repository.dueValue = [request];
    const result = await new AccountDeletionService(repository, hash).reconcile(
      now,
    );
    expect(result).toEqual({ completed: 1, failed: 0, held: 0, scanned: 1 });
    expect(repository.sequence).toEqual([
      'claim',
      'artifacts',
      'resources',
      'tombstone',
    ]);
  });

  it('does not purge a held account', async () => {
    const repository = new MemoryDeletionRepository();
    repository.dueValue = [
      {
        graceUntil: now,
        id: 'deletion-held-076',
        idempotencyKey: 'req-076-held-a',
        status: 'disabled',
        subjectHash: hash('held-user'),
        userId: 'held-user',
      },
    ];
    repository.held.add('held-user');
    expect(
      await new AccountDeletionService(repository, hash).reconcile(now),
    ).toEqual({ completed: 0, failed: 0, held: 1, scanned: 1 });
    expect(repository.sequence).toEqual([]);
  });

  it('marks a failed purge for bounded retry and reconciliation', async () => {
    const repository = new MemoryDeletionRepository();
    repository.failPurge = true;
    repository.dueValue = [
      {
        graceUntil: now,
        id: 'deletion-failed-076',
        idempotencyKey: 'deletion-failed-key-076',
        status: 'failed',
        subjectHash: hash('user-failed'),
        userId: 'user-failed',
      },
    ];
    expect(
      await new AccountDeletionService(repository, hash).reconcile(now),
    ).toEqual({ completed: 0, failed: 1, held: 0, scanned: 1 });
    expect(repository.sequence).toEqual([
      'claim',
      'artifacts',
      'resources',
      'failed',
    ]);
  });
});
