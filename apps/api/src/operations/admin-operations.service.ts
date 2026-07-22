import {
  backupStatusChecks,
  incidents,
  operationalAuditEvents,
  recoveryDrills,
  releaseRecords,
} from '@atlas/database';
import { ATLAS_QUEUE_NAMES } from '@atlas/types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { desc } from 'drizzle-orm';
import { z } from 'zod';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';
import type { OperationalActorContext } from './operational-controls.service';

const QUEUE_ALLOWLIST = {
  alerts: ATLAS_QUEUE_NAMES.alerts,
  backtests: ATLAS_QUEUE_NAMES.backtests,
  experiments: ATLAS_QUEUE_NAMES.experiments,
  'market-data': ATLAS_QUEUE_NAMES.marketData,
  notifications: ATLAS_QUEUE_NAMES.notifications,
  scanner: ATLAS_QUEUE_NAMES.scanner,
  system: ATLAS_QUEUE_NAMES.system,
} as const;

type QueueAlias = keyof typeof QUEUE_ALLOWLIST;

const dangerousInput = z.object({
  confirmation: z.string().min(1).max(120),
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(8).max(4_096),
});
const jobInput = dangerousInput.extend({
  queue: z.enum(Object.keys(QUEUE_ALLOWLIST) as [QueueAlias, ...QueueAlias[]]),
});

@Injectable()
export class AdminOperationsService {
  private readonly environment: string;
  private readonly redisUrl: string;

  constructor(
    private readonly connection: ApiDatabase,
    config: ConfigService,
  ) {
    this.environment = config.getOrThrow<string>('ATLAS_ENV');
    this.redisUrl = config.getOrThrow<string>('REDIS_URL');
  }

  async overview() {
    const [queues, releases, incidentRows, drills, backup, freshness] =
      await Promise.all([
        this.queues(),
        this.connection.database
          .select()
          .from(releaseRecords)
          .orderBy(desc(releaseRecords.startedAt))
          .limit(10),
        this.connection.database
          .select()
          .from(incidents)
          .orderBy(desc(incidents.detectedAt))
          .limit(10),
        this.recoveryDrills(),
        this.connection.database
          .select()
          .from(backupStatusChecks)
          .orderBy(desc(backupStatusChecks.checkedAt))
          .limit(1),
        this.dataFreshness(),
      ]);
    return {
      backup: backup[0] ?? null,
      dataFreshness: freshness,
      incidents: incidentRows,
      queues,
      recovery: drills,
      releases,
    };
  }

  async queues() {
    return Promise.all(
      Object.entries(QUEUE_ALLOWLIST).map(async ([alias, name]) =>
        this.withQueue(name, async (queue) => ({
          counts: await queue.getJobCounts(
            'active',
            'completed',
            'delayed',
            'failed',
            'paused',
            'prioritized',
            'waiting',
          ),
          name: alias,
          paused: await queue.isPaused(),
        })),
      ),
    );
  }

  async setQueuePaused(
    actor: OperationalActorContext,
    alias: string,
    paused: boolean,
    body: unknown,
  ) {
    const input = parseAdminInput(dangerousInput, body);
    const expectedConfirmation = `${paused ? 'PAUSE' : 'RESUME'}_${alias.toUpperCase().replaceAll('-', '_')}_QUEUE`;
    if (input.confirmation !== expectedConfirmation)
      throw new BadRequestException({
        code: 'DANGEROUS_CONFIRMATION_INVALID',
        message: 'Confirmation text is invalid',
      });
    const name = this.queueName(alias);
    return this.withQueue(name, async (queue) => {
      const before = { paused: await queue.isPaused() };
      if (input.expectedVersion !== Number(before.paused))
        throw new ConflictException({
          code: 'OPERATION_VERSION_CONFLICT',
          details: { currentVersion: Number(before.paused) },
          message: 'Queue state changed',
        });
      if (paused) await queue.pause();
      else await queue.resume();
      const after = { paused: await queue.isPaused() };
      await this.audit(
        actor,
        paused ? 'queue.pause' : 'queue.resume',
        'queue',
        alias,
        before,
        after,
        input.reason,
      );
      return { name: alias, ...after };
    });
  }

  async retryJob(actor: OperationalActorContext, jobId: string, body: unknown) {
    return this.jobAction(actor, jobId, body, 'retry');
  }

  async cancelJob(
    actor: OperationalActorContext,
    jobId: string,
    body: unknown,
  ) {
    return this.jobAction(actor, jobId, body, 'cancel');
  }

  async dataFreshness() {
    const result = await this.connection.pool.query<{
      latest_closed_bar_at: Date | null;
      latest_financial_at: Date | null;
      latest_pattern_at: Date | null;
    }>(`select
      (select max(bar_time) from price_bars where is_closed = true) latest_closed_bar_at,
      (select max(source_timestamp) from fundamental_statement_snapshots) latest_financial_at,
      (select max(data_cutoff_at) from pattern_instances) latest_pattern_at`);
    return result.rows[0]!;
  }

  releases() {
    return this.connection.database
      .select()
      .from(releaseRecords)
      .orderBy(desc(releaseRecords.startedAt))
      .limit(100);
  }

  incidentSummary() {
    return this.connection.database
      .select()
      .from(incidents)
      .orderBy(desc(incidents.detectedAt))
      .limit(100);
  }

  recoveryDrills() {
    return this.connection.database
      .select()
      .from(recoveryDrills)
      .orderBy(desc(recoveryDrills.startedAt))
      .limit(100);
  }

  async recoveryStatus() {
    const [drills, backup] = await Promise.all([
      this.recoveryDrills(),
      this.connection.database
        .select()
        .from(backupStatusChecks)
        .orderBy(desc(backupStatusChecks.checkedAt))
        .limit(1),
    ]);
    return { latestBackup: backup[0] ?? null, latestDrill: drills[0] ?? null };
  }

  private async jobAction(
    actor: OperationalActorContext,
    jobId: string,
    body: unknown,
    action: 'retry' | 'cancel',
  ) {
    const input = parseAdminInput(jobInput, body);
    const expected = `${action.toUpperCase()}_${input.queue.toUpperCase().replaceAll('-', '_')}_JOB`;
    if (input.confirmation !== expected)
      throw new BadRequestException({
        code: 'DANGEROUS_CONFIRMATION_INVALID',
        message: 'Confirmation text is invalid',
      });
    return this.withQueue(this.queueName(input.queue), async (queue) => {
      const job = await queue.getJob(jobId);
      if (job === undefined)
        throw new BadRequestException({
          code: 'CONTROLLED_JOB_NOT_FOUND',
          message: 'Job was not found in the selected queue',
        });
      const state = await job.getState();
      if (input.expectedVersion !== job.attemptsMade)
        throw new ConflictException({
          code: 'OPERATION_VERSION_CONFLICT',
          details: { currentVersion: job.attemptsMade },
          message: 'Job state changed',
        });
      if (action === 'retry') {
        if (state !== 'failed')
          throw new BadRequestException({
            code: 'CONTROLLED_JOB_RETRY_NOT_ALLOWED',
            message: 'Only failed allowlisted jobs can be retried',
          });
        await job.retry('failed');
      } else {
        if (!['waiting', 'delayed', 'prioritized'].includes(state))
          throw new BadRequestException({
            code: 'CONTROLLED_JOB_CANCEL_NOT_ALLOWED',
            message: 'Only queued jobs can be cancelled',
          });
        await job.remove();
      }
      const after = {
        state: action === 'retry' ? await job.getState() : 'removed',
      };
      await this.audit(
        actor,
        `job.${action}`,
        'job',
        `${input.queue}:${jobId}`,
        { attemptsMade: job.attemptsMade, state },
        after,
        input.reason,
      );
      return { id: jobId, queue: input.queue, ...after };
    });
  }

  private queueName(alias: string): string {
    const name = QUEUE_ALLOWLIST[alias as QueueAlias];
    if (name === undefined)
      throw new BadRequestException({
        code: 'QUEUE_NOT_ALLOWLISTED',
        message: 'Queue is not allowlisted',
      });
    return name;
  }

  private async withQueue<T>(
    name: string,
    operation: (queue: Queue) => Promise<T>,
  ): Promise<T> {
    const queue = new Queue(name, { connection: { url: this.redisUrl } });
    try {
      return await operation(queue);
    } finally {
      await queue.close();
    }
  }

  private async audit(
    actor: OperationalActorContext,
    action: string,
    resourceType: string,
    resourceId: string,
    beforeState: unknown,
    afterState: unknown,
    reason: string,
  ): Promise<void> {
    await this.connection.database.insert(operationalAuditEvents).values({
      action,
      actorType: 'operations_admin',
      actorUserId: actor.userId,
      afterState,
      beforeState,
      correlationId: actor.correlationId,
      environment: this.environment,
      reason,
      requestId: actor.requestId,
      resourceId,
      resourceType,
    });
  }
}

export const ADMIN_QUEUE_ALLOWLIST = Object.freeze({ ...QUEUE_ALLOWLIST });

function parseAdminInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: 'ADMIN_OPERATION_REQUEST_INVALID',
      details: result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
      })),
      message: 'Admin operation request is invalid',
    });
  return result.data;
}
