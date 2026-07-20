import { randomUUID } from 'node:crypto';

import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import type {
  AlertEvaluationQueuePayload,
  BacktestRunQueuePayload,
  ExperimentQueuePayload,
  NotificationDeliveryQueuePayload,
} from '@atlas/types';

import {
  createDefaultBacktestComposition,
  type BacktestComposition,
} from '../backtesting/backtest-composition';
import {
  createDefaultExperimentComposition,
  type ExperimentComposition,
} from '../backtesting/experiment-composition';

import {
  createDefaultAlertComposition,
  type AlertComposition,
} from '../alerts/alert-composition';
import type { WorkerEnvironment } from '../config/environment';
import { processHeartbeat } from '../heartbeat/heartbeat';
import {
  createDefaultMarketDataComposition,
  type MarketDataComposition,
} from '../market-data/market-data-composition';
import type { StructuredLogger } from '../observability/structured-logger';
import {
  createDefaultNotificationComposition,
  type NotificationComposition,
} from '../notifications/notification-composition';
import {
  createHeartbeatJobId,
  DEFAULT_JOB_OPTIONS,
  JOB_NAMES,
  QUEUE_NAMES,
} from '../queue/queue-contracts';
import { createRedisConnection } from '../queue/redis-connection';
import {
  createDefaultScannerComposition,
  type ScannerComposition,
} from '../scanner/scanner-composition';
import type { ScannerRunJobData } from '../scanner/contracts';

interface DeadLetterData {
  readonly attemptsMade: number;
  readonly failedAt: string;
  readonly jobId: string;
  readonly jobName: string;
  readonly queueName: string;
}

export class WorkerStartupError extends Error {
  override readonly name = 'WorkerStartupError';
}

export class WorkerRuntime {
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private stopping = false;

  private constructor(
    private readonly environment: WorkerEnvironment,
    private readonly logger: StructuredLogger,
    private readonly systemQueue: Queue,
    private readonly marketDataQueue: Queue,
    private readonly scannerQueue: Queue<ScannerRunJobData>,
    private readonly alertQueue: Queue<AlertEvaluationQueuePayload>,
    private readonly notificationQueue: Queue<NotificationDeliveryQueuePayload>,
    private readonly backtestQueue: Queue<BacktestRunQueuePayload>,
    private readonly experimentQueue: Queue<ExperimentQueuePayload>,
    private readonly deadLetterQueue: Queue<DeadLetterData>,
    private readonly systemWorker: Worker,
    private readonly marketDataWorker: Worker,
    private readonly scannerWorker: Worker<ScannerRunJobData>,
    private readonly alertWorker: Worker<AlertEvaluationQueuePayload>,
    private readonly notificationWorker: Worker<NotificationDeliveryQueuePayload>,
    private readonly backtestWorker: Worker<BacktestRunQueuePayload>,
    private readonly experimentWorker: Worker<ExperimentQueuePayload>,
    private readonly marketDataComposition: MarketDataComposition,
    private readonly scannerComposition: ScannerComposition,
    private readonly alertComposition: AlertComposition,
    private readonly notificationComposition: NotificationComposition,
    private readonly backtestComposition: BacktestComposition,
    private readonly experimentComposition: ExperimentComposition,
    private readonly workerId: string,
  ) {}

  static async start(
    environment: WorkerEnvironment,
    logger: StructuredLogger,
    injectedComposition?: MarketDataComposition,
    injectedScannerComposition?: ScannerComposition,
    injectedAlertComposition?: AlertComposition,
    injectedNotificationComposition?: NotificationComposition,
    injectedBacktestComposition?: BacktestComposition,
    injectedExperimentComposition?: ExperimentComposition,
  ): Promise<WorkerRuntime> {
    const connection = createRedisConnection(environment.REDIS_URL);
    const systemQueue = new Queue(QUEUE_NAMES.system, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    const deadLetterQueue = new Queue<DeadLetterData>(QUEUE_NAMES.deadLetter, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    const marketDataQueue = new Queue(QUEUE_NAMES.marketData, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    const scannerQueue = new Queue<ScannerRunJobData>(QUEUE_NAMES.scanner, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    const alertQueue = new Queue<AlertEvaluationQueuePayload>(
      QUEUE_NAMES.alerts,
      {
        connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      },
    );
    const notificationQueue = new Queue<NotificationDeliveryQueuePayload>(
      QUEUE_NAMES.notifications,
      {
        connection,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      },
    );
    const backtestQueue = new Queue<BacktestRunQueuePayload>(
      QUEUE_NAMES.backtests,
      { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS },
    );
    const experimentQueue = new Queue<ExperimentQueuePayload>(
      QUEUE_NAMES.experiments,
      { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS },
    );
    const systemWorker = new Worker(
      QUEUE_NAMES.system,
      (job) => {
        if (job.name !== JOB_NAMES.heartbeat) {
          throw new Error('Unsupported internal job type');
        }

        return Promise.resolve(processHeartbeat(job));
      },
      {
        concurrency: environment.WORKER_CONCURRENCY,
        connection,
      },
    );
    const marketDataComposition =
      injectedComposition ??
      createDefaultMarketDataComposition(
        environment.DATABASE_URL,
        environment.REDIS_URL,
        logger,
      );
    const marketDataWorker = new Worker(
      QUEUE_NAMES.marketData,
      (job) => marketDataComposition.process(job),
      {
        concurrency: environment.WORKER_CONCURRENCY,
        connection,
      },
    );
    const scannerComposition =
      injectedScannerComposition ??
      createDefaultScannerComposition(environment, logger);
    const scannerWorker = new Worker<ScannerRunJobData>(
      QUEUE_NAMES.scanner,
      (job) => scannerComposition.process(job),
      {
        concurrency: environment.WORKER_CONCURRENCY,
        connection,
      },
    );
    const notificationComposition =
      injectedNotificationComposition ??
      createDefaultNotificationComposition(
        environment,
        logger,
        notificationQueue,
      );
    const alertComposition =
      injectedAlertComposition ??
      createDefaultAlertComposition(environment, logger, {
        handle: (triggerIds) =>
          notificationComposition.handleTriggerIds(triggerIds),
      });
    const alertWorker = new Worker<AlertEvaluationQueuePayload>(
      QUEUE_NAMES.alerts,
      (job) => alertComposition.process(job),
      {
        concurrency: environment.WORKER_CONCURRENCY,
        connection,
      },
    );
    const notificationWorker = new Worker<NotificationDeliveryQueuePayload>(
      QUEUE_NAMES.notifications,
      (job) => notificationComposition.process(job),
      {
        concurrency: environment.WORKER_CONCURRENCY,
        connection,
      },
    );
    const backtestComposition =
      injectedBacktestComposition ??
      createDefaultBacktestComposition(environment, logger);
    const backtestWorker = new Worker<BacktestRunQueuePayload>(
      QUEUE_NAMES.backtests,
      (job) => backtestComposition.process(job),
      {
        concurrency: environment.WORKER_CONCURRENCY,
        connection,
        lockDuration: environment.BACKTEST_RUN_TIMEOUT_MS,
      },
    );
    const experimentComposition =
      injectedExperimentComposition ??
      createDefaultExperimentComposition(environment, logger, backtestQueue);
    const experimentWorker = new Worker<ExperimentQueuePayload>(
      QUEUE_NAMES.experiments,
      (job) => experimentComposition.process(job),
      {
        concurrency: environment.WORKER_CONCURRENCY,
        connection,
        lockDuration: environment.BACKTEST_RUN_TIMEOUT_MS,
      },
    );
    const runtime = new WorkerRuntime(
      environment,
      logger,
      systemQueue,
      marketDataQueue,
      scannerQueue,
      alertQueue,
      notificationQueue,
      backtestQueue,
      experimentQueue,
      deadLetterQueue,
      systemWorker,
      marketDataWorker,
      scannerWorker,
      alertWorker,
      notificationWorker,
      backtestWorker,
      experimentWorker,
      marketDataComposition,
      scannerComposition,
      alertComposition,
      notificationComposition,
      backtestComposition,
      experimentComposition,
      randomUUID(),
    );

    runtime.registerWorkerEvents();

    try {
      await runtime.waitUntilReady();
      await notificationComposition.catchUp();
      await alertComposition.catchUp(alertQueue);
      await experimentComposition.reconcile(experimentQueue);
      await runtime.enqueueHeartbeat();
      runtime.startHeartbeat();
      logger.info('worker.ready', {
        concurrency: environment.WORKER_CONCURRENCY,
        queues: [
          QUEUE_NAMES.system,
          QUEUE_NAMES.marketData,
          QUEUE_NAMES.scanner,
          QUEUE_NAMES.alerts,
          QUEUE_NAMES.notifications,
          QUEUE_NAMES.backtests,
          QUEUE_NAMES.experiments,
        ],
      });
      return runtime;
    } catch (error: unknown) {
      await runtime.closeConnections();
      throw new WorkerStartupError(
        `Worker could not start (${error instanceof Error ? error.constructor.name : 'UnknownError'})`,
      );
    }
  }

  async stop(reason: string): Promise<void> {
    if (this.stopping) {
      return;
    }

    this.stopping = true;
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
    }

    this.logger.info('worker.stopping', { reason });
    await Promise.all([
      this.systemWorker.pause(false),
      this.marketDataWorker.pause(false),
      this.scannerWorker.pause(false),
      this.alertWorker.pause(false),
      this.notificationWorker.pause(false),
      this.backtestWorker.pause(false),
      this.experimentWorker.pause(false),
    ]);
    await this.closeConnections();
    this.logger.info('worker.stopped', { reason });
  }

  private async waitUntilReady(): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Redis startup timeout')),
        this.environment.WORKER_STARTUP_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([
        Promise.all([
          this.systemQueue.waitUntilReady(),
          this.marketDataQueue.waitUntilReady(),
          this.scannerQueue.waitUntilReady(),
          this.alertQueue.waitUntilReady(),
          this.notificationQueue.waitUntilReady(),
          this.backtestQueue.waitUntilReady(),
          this.experimentQueue.waitUntilReady(),
          this.deadLetterQueue.waitUntilReady(),
          this.systemWorker.waitUntilReady(),
          this.marketDataWorker.waitUntilReady(),
          this.scannerWorker.waitUntilReady(),
          this.alertWorker.waitUntilReady(),
          this.notificationWorker.waitUntilReady(),
          this.backtestWorker.waitUntilReady(),
          this.experimentWorker.waitUntilReady(),
        ]),
        timeoutPromise,
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.enqueueHeartbeat().catch((error: unknown) => {
        this.logger.error('worker.heartbeat.enqueue-failed', {
          errorType:
            error instanceof Error ? error.constructor.name : 'UnknownError',
        });
      });
      void this.experimentComposition
        .reconcile(this.experimentQueue)
        .catch((error: unknown) => {
          this.logger.error('worker.experiment.reconcile-failed', {
            errorType:
              error instanceof Error ? error.constructor.name : 'UnknownError',
          });
        });
    }, this.environment.WORKER_HEARTBEAT_INTERVAL_MS);
  }

  private async enqueueHeartbeat(now: Date = new Date()): Promise<void> {
    await this.systemQueue.add(
      JOB_NAMES.heartbeat,
      { sentAt: now.toISOString(), workerId: this.workerId },
      {
        jobId: createHeartbeatJobId(
          now.getTime(),
          this.environment.WORKER_HEARTBEAT_INTERVAL_MS,
        ),
      },
    );
  }

  private registerWorkerEvents(): void {
    this.registerQueueError(this.systemQueue, QUEUE_NAMES.system);
    this.registerQueueError(this.marketDataQueue, QUEUE_NAMES.marketData);
    this.registerQueueError(this.scannerQueue, QUEUE_NAMES.scanner);
    this.registerQueueError(this.alertQueue, QUEUE_NAMES.alerts);
    this.registerQueueError(this.notificationQueue, QUEUE_NAMES.notifications);
    this.registerQueueError(this.backtestQueue, QUEUE_NAMES.backtests);
    this.registerQueueError(this.experimentQueue, QUEUE_NAMES.experiments);
    this.registerQueueError(this.deadLetterQueue, QUEUE_NAMES.deadLetter);
    this.registerJobEvents(this.systemWorker, QUEUE_NAMES.system);
    this.registerJobEvents(this.marketDataWorker, QUEUE_NAMES.marketData);
    this.registerJobEvents(this.scannerWorker, QUEUE_NAMES.scanner);
    this.registerJobEvents(this.alertWorker, QUEUE_NAMES.alerts);
    this.registerJobEvents(this.notificationWorker, QUEUE_NAMES.notifications);
    this.registerJobEvents(this.backtestWorker, QUEUE_NAMES.backtests);
    this.registerJobEvents(this.experimentWorker, QUEUE_NAMES.experiments);
  }

  private registerQueueError(queue: Queue, queueName: string): void {
    queue.on('error', (error) => {
      this.logger.error('worker.queue.connection.error', {
        errorType: error.constructor.name,
        queue: queueName,
      });
    });
  }

  private registerJobEvents(worker: Worker, queueName: string): void {
    worker.on('completed', (job) => {
      this.logger.debug('worker.job.completed', {
        jobId: job.id,
        jobName: job.name,
        queue: queueName,
      });
    });
    worker.on('error', (error) => {
      this.logger.error('worker.connection.error', {
        errorType: error.constructor.name,
        queue: queueName,
      });
    });
    worker.on('failed', (job, error) => {
      if (job === undefined) {
        return;
      }

      const attempts = job.opts.attempts ?? 1;
      if (
        !(error instanceof UnrecoverableError) &&
        job.attemptsMade < attempts
      ) {
        return;
      }

      void this.moveToDeadLetter(job, error, queueName);
    });
  }

  private async moveToDeadLetter(
    job: Job,
    error: Error,
    queueName: string,
  ): Promise<void> {
    const jobId = job.id ?? 'job-id-unavailable';

    try {
      await this.deadLetterQueue.add(
        JOB_NAMES.deadLetter,
        {
          attemptsMade: job.attemptsMade,
          failedAt: new Date().toISOString(),
          jobId,
          jobName: job.name,
          queueName,
        },
        { jobId: `dead-letter-${jobId}-${job.attemptsMade}` },
      );
      this.logger.error('worker.job.dead-lettered', {
        errorType: error.constructor.name,
        jobId,
        jobName: job.name,
        queue: queueName,
      });
    } catch (deadLetterError: unknown) {
      this.logger.error('worker.dead-letter.enqueue-failed', {
        errorType:
          deadLetterError instanceof Error
            ? deadLetterError.constructor.name
            : 'UnknownError',
        jobId,
        queue: QUEUE_NAMES.deadLetter,
      });
    }
  }

  private async closeConnections(): Promise<void> {
    await Promise.allSettled([
      this.systemWorker.close(),
      this.marketDataWorker.close(),
      this.scannerWorker.close(),
      this.alertWorker.close(),
      this.notificationWorker.close(),
      this.backtestWorker.close(),
      this.experimentWorker.close(),
      this.systemQueue.close(),
      this.marketDataQueue.close(),
      this.scannerQueue.close(),
      this.alertQueue.close(),
      this.notificationQueue.close(),
      this.backtestQueue.close(),
      this.experimentQueue.close(),
      this.deadLetterQueue.close(),
      this.marketDataComposition.close(),
      this.scannerComposition.close(),
      this.alertComposition.close(),
      this.notificationComposition.close(),
      this.backtestComposition.close(),
      this.experimentComposition.close(),
    ]);
  }
}
