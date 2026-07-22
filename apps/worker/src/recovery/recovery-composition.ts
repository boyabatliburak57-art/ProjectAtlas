import { createHash } from 'node:crypto';

import { createDatabase, PostgresRecoveryRepository } from '@atlas/database';
import {
  AccountDeletionService,
  DEFAULT_RETENTION_POLICIES,
  RetentionService,
  type RetentionCategory,
} from '@atlas/domain';
import type { Job } from 'bullmq';

import type { WorkerEnvironment } from '../config/environment';
import type { StructuredLogger } from '../observability/structured-logger';
import { JOB_NAMES } from '../queue/queue-contracts';

export class RecoveryComposition {
  private readonly accountDeletion: AccountDeletionService;
  private readonly database: ReturnType<typeof createDatabase>;
  private readonly retention: RetentionService;

  constructor(
    environment: WorkerEnvironment,
    private readonly logger: StructuredLogger,
  ) {
    this.database = createDatabase(environment.DATABASE_URL);
    const repository = new PostgresRecoveryRepository(
      this.database.pool,
      environment.ATLAS_ENV ?? environment.NODE_ENV ?? 'production',
    );
    this.retention = new RetentionService(repository);
    this.accountDeletion = new AccountDeletionService(repository, (value) =>
      createHash('sha256').update(value).digest('hex'),
    );
  }

  async process(job: Job): Promise<Readonly<Record<string, unknown>>> {
    if (job.name === JOB_NAMES.retentionRun) {
      const payload = retentionPayload(job.data);
      const result = await this.retention.run(
        payload.category,
        payload.executionKey,
      );
      const output = retentionResultRecord(result);
      this.logger.info('retention.batch.completed', output);
      return output;
    }
    if (job.name === JOB_NAMES.accountDeletionReconcile) {
      const result = await this.accountDeletion.reconcile();
      this.logger.info('account.deletion.reconciled', result);
      return result;
    }
    throw new Error('UNSUPPORTED_RECOVERY_JOB');
  }

  scheduledJobs(now = new Date()): readonly {
    readonly data: Readonly<Record<string, unknown>>;
    readonly id: string;
    readonly name: string;
  }[] {
    const day = now.toISOString().slice(0, 10);
    return [
      ...Object.keys(DEFAULT_RETENTION_POLICIES).map((category) => ({
        data: {
          category,
          executionKey: `${day}:${category}`,
        },
        id: `retention-${day}-${category.replaceAll('_', '-')}`,
        name: JOB_NAMES.retentionRun,
      })),
      {
        data: {},
        id: `account-deletion-reconcile-${day}`,
        name: JOB_NAMES.accountDeletionReconcile,
      },
    ];
  }

  close(): Promise<void> {
    return this.database.pool.end();
  }
}

function retentionResultRecord(result: {
  readonly deletedCount: number;
  readonly executionKey: string;
  readonly policyCode: string;
  readonly scannedCount: number;
  readonly skippedCount: number;
  readonly status: string;
}): Readonly<Record<string, unknown>> {
  return {
    deletedCount: result.deletedCount,
    executionKey: result.executionKey,
    policyCode: result.policyCode,
    scannedCount: result.scannedCount,
    skippedCount: result.skippedCount,
    status: result.status,
  };
}

function retentionPayload(value: unknown): {
  readonly category: RetentionCategory;
  readonly executionKey: string;
} {
  if (value === null || typeof value !== 'object')
    throw new Error('RETENTION_PAYLOAD_INVALID');
  const record = value as Record<string, unknown>;
  const category = record['category'];
  const executionKey = record['executionKey'];
  if (
    typeof category !== 'string' ||
    !(category in DEFAULT_RETENTION_POLICIES) ||
    typeof executionKey !== 'string'
  )
    throw new Error('RETENTION_PAYLOAD_INVALID');
  return { category: category as RetentionCategory, executionKey };
}
