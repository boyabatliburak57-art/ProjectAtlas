export type RetentionCategory =
  | 'notifications'
  | 'scan_details'
  | 'backtest_details'
  | 'exports'
  | 'import_files'
  | 'operational_logs'
  | 'audit_records'
  | 'incidents'
  | 'deleted_accounts';

export interface RetentionPolicy {
  readonly category: RetentionCategory;
  readonly retentionDays: number;
}

export const RETENTION_POLICY_VERSION = 'retention-v1';

export const DEFAULT_RETENTION_POLICIES: Readonly<
  Record<RetentionCategory, RetentionPolicy>
> = {
  audit_records: { category: 'audit_records', retentionDays: 2555 },
  backtest_details: { category: 'backtest_details', retentionDays: 365 },
  deleted_accounts: { category: 'deleted_accounts', retentionDays: 30 },
  exports: { category: 'exports', retentionDays: 7 },
  import_files: { category: 'import_files', retentionDays: 30 },
  incidents: { category: 'incidents', retentionDays: 2555 },
  notifications: { category: 'notifications', retentionDays: 365 },
  operational_logs: { category: 'operational_logs', retentionDays: 30 },
  scan_details: { category: 'scan_details', retentionDays: 90 },
};

export interface RetentionCandidate {
  readonly category: RetentionCategory;
  readonly id: string;
  readonly ownerUserId?: string;
}

export interface RetentionRunResult {
  readonly deletedCount: number;
  readonly executionKey: string;
  readonly policyCode: RetentionCategory;
  readonly scannedCount: number;
  readonly skippedCount: number;
  readonly status: 'completed';
}

export interface RetentionRepository {
  begin(input: {
    readonly executionKey: string;
    readonly policyCode: RetentionCategory;
    readonly policyVersion: string;
    readonly startedAt: Date;
  }): Promise<{ readonly replay?: RetentionRunResult }>;
  candidates(input: {
    readonly category: RetentionCategory;
    readonly cutoff: Date;
    readonly limit: number;
  }): Promise<readonly RetentionCandidate[]>;
  isHeld(candidate: RetentionCandidate, now: Date): Promise<boolean>;
  deleteCandidate(candidate: RetentionCandidate, now: Date): Promise<boolean>;
  complete(result: RetentionRunResult, completedAt: Date): Promise<void>;
  fail(executionKey: string, errorCode: string, failedAt: Date): Promise<void>;
  audit(input: {
    readonly action: string;
    readonly resourceId: string;
    readonly result: Readonly<Record<string, unknown>>;
    readonly occurredAt: Date;
  }): Promise<void>;
}

export class RecoveryPolicyError extends Error {
  override readonly name = 'RecoveryPolicyError';

  constructor(readonly code: string) {
    super(code);
  }
}

export class RetentionService {
  constructor(
    private readonly repository: RetentionRepository,
    private readonly batchLimit = 500,
    private readonly policies = DEFAULT_RETENTION_POLICIES,
  ) {
    if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 1000)
      throw new RecoveryPolicyError('RETENTION_BATCH_LIMIT_INVALID');
  }

  async run(
    category: RetentionCategory,
    executionKey: string,
    now = new Date(),
  ): Promise<RetentionRunResult> {
    const policy = this.policies[category];
    if (executionKey.length < 8 || executionKey.length > 160)
      throw new RecoveryPolicyError('RETENTION_EXECUTION_KEY_INVALID');
    const begun = await this.repository.begin({
      executionKey,
      policyCode: category,
      policyVersion: RETENTION_POLICY_VERSION,
      startedAt: now,
    });
    if (begun.replay !== undefined) return begun.replay;

    try {
      const cutoff = new Date(
        now.getTime() - policy.retentionDays * 86_400_000,
      );
      const candidates = await this.repository.candidates({
        category,
        cutoff,
        limit: this.batchLimit,
      });
      let deletedCount = 0;
      let skippedCount = 0;
      for (const candidate of candidates) {
        if (await this.repository.isHeld(candidate, now)) {
          skippedCount += 1;
          continue;
        }
        if (await this.repository.deleteCandidate(candidate, now))
          deletedCount += 1;
      }
      const result: RetentionRunResult = {
        deletedCount,
        executionKey,
        policyCode: category,
        scannedCount: candidates.length,
        skippedCount,
        status: 'completed',
      };
      await this.repository.complete(result, now);
      await this.repository.audit({
        action: 'retention.batch.completed',
        occurredAt: now,
        resourceId: executionKey,
        result: {
          deletedCount: result.deletedCount,
          executionKey: result.executionKey,
          policyCode: result.policyCode,
          scannedCount: result.scannedCount,
          skippedCount: result.skippedCount,
          status: result.status,
        },
      });
      return result;
    } catch (error: unknown) {
      const errorCode =
        error instanceof RecoveryPolicyError
          ? error.code
          : 'RETENTION_BATCH_FAILED';
      await this.repository.fail(executionKey, errorCode, now);
      throw error;
    }
  }
}

export interface AccountDeletionRequest {
  readonly graceUntil: Date;
  readonly id: string;
  readonly idempotencyKey: string;
  readonly status: 'disabled' | 'pending' | 'purging' | 'completed' | 'failed';
  readonly subjectHash: string;
  readonly userId?: string;
}

export interface DeletionActor {
  readonly isOperationsAdmin: boolean;
  readonly userId: string;
}

export interface AccountDeletionRepository {
  findByIdempotencyKey(key: string): Promise<AccountDeletionRequest | null>;
  disableAndSchedule(input: {
    readonly graceUntil: Date;
    readonly idempotencyKey: string;
    readonly requestedAt: Date;
    readonly subjectHash: string;
    readonly userId: string;
  }): Promise<AccountDeletionRequest>;
  revokeSessions(userId: string, now: Date): Promise<void>;
  due(now: Date, limit: number): Promise<readonly AccountDeletionRequest[]>;
  isUserHeld(userId: string, now: Date): Promise<boolean>;
  claim(requestId: string, now: Date): Promise<boolean>;
  deleteArtifacts(userId: string, now: Date): Promise<void>;
  purgePrivateResources(userId: string, now: Date): Promise<void>;
  deleteIdentityAndTombstone(
    requestId: string,
    userId: string,
    now: Date,
  ): Promise<void>;
  markFailed(requestId: string, errorCode: string, now: Date): Promise<void>;
  audit(input: {
    readonly action: string;
    readonly actorUserId?: string;
    readonly resourceId: string;
    readonly occurredAt: Date;
  }): Promise<void>;
}

export class AccountDeletionService {
  constructor(
    private readonly repository: AccountDeletionRepository,
    private readonly subjectHasher: (value: string) => string,
    private readonly graceDays = 30,
    private readonly batchLimit = 50,
  ) {}

  async request(
    actor: DeletionActor,
    targetUserId: string,
    idempotencyKey: string,
    now = new Date(),
  ): Promise<AccountDeletionRequest> {
    if (actor.userId !== targetUserId && !actor.isOperationsAdmin)
      throw new RecoveryPolicyError('ACCOUNT_DELETION_ACCESS_DENIED');
    const replay = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (replay !== null) {
      if (replay.userId !== targetUserId)
        throw new RecoveryPolicyError('ACCOUNT_DELETION_IDEMPOTENCY_CONFLICT');
      return replay;
    }
    const request = await this.repository.disableAndSchedule({
      graceUntil: new Date(now.getTime() + this.graceDays * 86_400_000),
      idempotencyKey,
      requestedAt: now,
      subjectHash: this.subjectHasher(targetUserId),
      userId: targetUserId,
    });
    await this.repository.revokeSessions(targetUserId, now);
    await this.repository.audit({
      action: 'account.deletion.requested',
      actorUserId: actor.userId,
      occurredAt: now,
      resourceId: request.id,
    });
    return request;
  }

  async reconcile(now = new Date()): Promise<{
    readonly completed: number;
    readonly failed: number;
    readonly held: number;
    readonly scanned: number;
  }> {
    const requests = await this.repository.due(now, this.batchLimit);
    let completed = 0;
    let failed = 0;
    let held = 0;
    for (const request of requests) {
      if (request.userId === undefined) continue;
      if (await this.repository.isUserHeld(request.userId, now)) {
        held += 1;
        continue;
      }
      if (!(await this.repository.claim(request.id, now))) continue;
      try {
        await this.repository.deleteArtifacts(request.userId, now);
        await this.repository.purgePrivateResources(request.userId, now);
        await this.repository.deleteIdentityAndTombstone(
          request.id,
          request.userId,
          now,
        );
        await this.repository.audit({
          action: 'account.deletion.completed',
          occurredAt: now,
          resourceId: request.id,
        });
        completed += 1;
      } catch {
        await this.repository.markFailed(
          request.id,
          'ACCOUNT_PURGE_FAILED',
          now,
        );
        failed += 1;
      }
    }
    return { completed, failed, held, scanned: requests.length };
  }
}
