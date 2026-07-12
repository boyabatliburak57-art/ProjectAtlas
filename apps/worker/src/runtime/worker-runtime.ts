import { randomUUID } from 'node:crypto';

import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';

import type { WorkerEnvironment } from '../config/environment';
import { processHeartbeat } from '../heartbeat/heartbeat';
import {
  createDefaultMarketDataComposition,
  type MarketDataComposition,
} from '../market-data/market-data-composition';
import type { StructuredLogger } from '../observability/structured-logger';
import {
  createHeartbeatJobId,
  DEFAULT_JOB_OPTIONS,
  JOB_NAMES,
  QUEUE_NAMES,
} from '../queue/queue-contracts';
import { createRedisConnection } from '../queue/redis-connection';

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
    private readonly deadLetterQueue: Queue<DeadLetterData>,
    private readonly systemWorker: Worker,
    private readonly marketDataWorker: Worker,
    private readonly marketDataComposition: MarketDataComposition,
    private readonly workerId: string,
  ) {}

  static async start(
    environment: WorkerEnvironment,
    logger: StructuredLogger,
    injectedComposition?: MarketDataComposition,
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
      createDefaultMarketDataComposition(environment.DATABASE_URL, logger);
    const marketDataWorker = new Worker(
      QUEUE_NAMES.marketData,
      (job) => marketDataComposition.process(job),
      {
        concurrency: environment.WORKER_CONCURRENCY,
        connection,
      },
    );
    const runtime = new WorkerRuntime(
      environment,
      logger,
      systemQueue,
      marketDataQueue,
      deadLetterQueue,
      systemWorker,
      marketDataWorker,
      marketDataComposition,
      randomUUID(),
    );

    runtime.registerWorkerEvents();

    try {
      await runtime.waitUntilReady();
      await runtime.enqueueHeartbeat();
      runtime.startHeartbeat();
      logger.info('worker.ready', {
        concurrency: environment.WORKER_CONCURRENCY,
        queues: [QUEUE_NAMES.system, QUEUE_NAMES.marketData],
      });
      return runtime;
    } catch (error: unknown) {
      await runtime.closeConnections();
      throw new WorkerStartupError(
        `Worker could not connect to Redis (${error instanceof Error ? error.constructor.name : 'UnknownError'})`,
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
          this.deadLetterQueue.waitUntilReady(),
          this.systemWorker.waitUntilReady(),
          this.marketDataWorker.waitUntilReady(),
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
    this.registerQueueError(this.deadLetterQueue, QUEUE_NAMES.deadLetter);
    this.registerJobEvents(this.systemWorker, QUEUE_NAMES.system);
    this.registerJobEvents(this.marketDataWorker, QUEUE_NAMES.marketData);
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
      this.systemQueue.close(),
      this.marketDataQueue.close(),
      this.deadLetterQueue.close(),
      this.marketDataComposition.close(),
    ]);
  }
}
