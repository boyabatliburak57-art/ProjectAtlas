import { randomUUID } from 'node:crypto';

import { createDatabase, type Database } from '@atlas/database';
import type {
  NotificationDeliveryQueuePayload,
  SafeTraceContext,
} from '@atlas/types';
import { type Job, type Queue, UnrecoverableError } from 'bullmq';

import type { WorkerEnvironment } from '../config/environment';
import type { StructuredLogger } from '../observability/structured-logger';
import { enqueueNotificationDelivery } from '../queue/notification-queue';
import { JOB_NAMES } from '../queue/queue-contracts';
import type {
  EmailAdapter,
  EmailRecipientResolver,
  NotificationPreferenceResolver,
  NotificationStore,
} from './contracts';
import { UnconfiguredEmailAdapter } from './email-adapter';
import { NotificationDeliveryProcessor } from './notification-delivery-processor';
import { NotificationOrchestrator } from './notification-orchestrator';
import { PostgresNotificationPreferenceResolver } from './postgres-notification-preference-resolver';
import { PostgresNotificationStore } from './postgres-notification-store';

export interface NotificationComposition {
  readonly process: (
    job: Job<NotificationDeliveryQueuePayload>,
  ) => Promise<unknown>;
  readonly handleTriggerIds: (
    triggerIds: readonly string[],
    telemetry?: SafeTraceContext,
  ) => Promise<void>;
  readonly catchUp: () => Promise<number>;
  readonly close: () => Promise<void>;
}

export function createNotificationComposition(options: {
  readonly database: Database;
  readonly queue: Queue<NotificationDeliveryQueuePayload>;
  readonly logger: StructuredLogger;
  readonly store?: NotificationStore | undefined;
  readonly preferences?: NotificationPreferenceResolver | undefined;
  readonly email?: EmailAdapter | undefined;
  readonly recipients?: EmailRecipientResolver | undefined;
  readonly catchUpLimit?: number | undefined;
  readonly close?: (() => Promise<void>) | undefined;
}): NotificationComposition {
  const store =
    options.store ?? new PostgresNotificationStore(options.database);
  const orchestrator = new NotificationOrchestrator({
    store,
    preferences:
      options.preferences ??
      new PostgresNotificationPreferenceResolver(options.database),
  });
  const processor = new NotificationDeliveryProcessor({
    store,
    email: options.email ?? new UnconfiguredEmailAdapter(),
    recipients: options.recipients ?? { resolve: () => Promise.resolve(null) },
    workerId: randomUUID(),
  });

  async function enqueueOutbox(
    items: readonly {
      readonly outboxId: number;
      readonly attempt: number;
      readonly availableAt: Date;
    }[],
    telemetry?: SafeTraceContext,
  ): Promise<void> {
    for (const item of items) {
      await enqueueNotificationDelivery(
        options.queue,
        {
          outboxId: item.outboxId,
          attempt: item.attempt,
          ...(telemetry === undefined ? {} : { telemetry }),
        },
        { delay: Math.max(0, item.availableAt.getTime() - Date.now()) },
      );
    }
  }

  return {
    async process(job) {
      if (job.name !== JOB_NAMES.notificationDeliver) {
        throw new UnrecoverableError(
          `Unsupported notification job: ${job.name}`,
        );
      }
      const result = await processor.process(job.data.outboxId);
      if (
        result.status === 'retry_scheduled' &&
        result.nextAttempt !== undefined &&
        result.availableAt !== undefined
      ) {
        await enqueueOutbox(
          [
            {
              outboxId: job.data.outboxId,
              attempt: result.nextAttempt,
              availableAt: result.availableAt,
            },
          ],
          job.data.telemetry,
        );
      }
      options.logger.info('worker.notification.delivery.completed', {
        outboxId: job.data.outboxId,
        status: result.status,
      });
      return result;
    },
    async handleTriggerIds(triggerIds, telemetry) {
      const results = await orchestrator.orchestrateTriggerIds(triggerIds);
      await enqueueOutbox(
        results.flatMap(({ outboxItems }) => outboxItems),
        telemetry,
      );
    },
    async catchUp() {
      const limit = options.catchUpLimit ?? 1_000;
      const now = new Date();
      await store.recoverStaleOutbox({
        staleBefore: new Date(now.getTime() - 5 * 60_000),
        now,
      });
      const triggerIds = await store.listUnprocessedTriggerIds(limit);
      const results = await orchestrator.orchestrateTriggerIds(triggerIds);
      const pending = await store.listPendingOutbox(limit);
      await enqueueOutbox([
        ...results.flatMap(({ outboxItems }) => outboxItems),
        ...pending,
      ]);
      return triggerIds.length + pending.length;
    },
    close: options.close ?? (() => Promise.resolve()),
  };
}

export function createDefaultNotificationComposition(
  environment: WorkerEnvironment,
  logger: StructuredLogger,
  queue: Queue<NotificationDeliveryQueuePayload>,
): NotificationComposition {
  const { db, pool } = createDatabase(environment.DATABASE_URL);
  return createNotificationComposition({
    database: db,
    queue,
    logger,
    close: () => pool.end(),
  });
}
