import { randomUUID } from 'node:crypto';

import { Job, Queue, Worker } from 'bullmq';

import type { WorkerEnvironment } from '../config/environment';
import { processHeartbeat } from '../heartbeat/heartbeat';
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
    private readonly deadLetterQueue: Queue<DeadLetterData>,
    private readonly worker: Worker,
    private readonly workerId: string,
  ) {}

  static async start(
    environment: WorkerEnvironment,
    logger: StructuredLogger,
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
    const worker = new Worker(
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
    const runtime = new WorkerRuntime(
      environment,
      logger,
      systemQueue,
      deadLetterQueue,
      worker,
      randomUUID(),
    );

    runtime.registerWorkerEvents();

    try {
      await runtime.waitUntilReady();
      await runtime.enqueueHeartbeat();
      runtime.startHeartbeat();
      logger.info('worker.ready', {
        concurrency: environment.WORKER_CONCURRENCY,
        queue: QUEUE_NAMES.system,
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
    await this.worker.pause(false);
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
          this.deadLetterQueue.waitUntilReady(),
          this.worker.waitUntilReady(),
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
    this.systemQueue.on('error', (error) => {
      this.logger.error('worker.queue.connection.error', {
        errorType: error.constructor.name,
        queue: QUEUE_NAMES.system,
      });
    });
    this.deadLetterQueue.on('error', (error) => {
      this.logger.error('worker.queue.connection.error', {
        errorType: error.constructor.name,
        queue: QUEUE_NAMES.deadLetter,
      });
    });
    this.worker.on('completed', (job) => {
      this.logger.debug('worker.job.completed', {
        jobId: job.id,
        jobName: job.name,
        queue: QUEUE_NAMES.system,
      });
    });
    this.worker.on('error', (error) => {
      this.logger.error('worker.connection.error', {
        errorType: error.constructor.name,
        queue: QUEUE_NAMES.system,
      });
    });
    this.worker.on('failed', (job, error) => {
      if (job === undefined) {
        return;
      }

      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < attempts) {
        return;
      }

      void this.moveToDeadLetter(job, error);
    });
  }

  private async moveToDeadLetter(job: Job, error: Error): Promise<void> {
    const jobId = job.id ?? 'job-id-unavailable';

    try {
      await this.deadLetterQueue.add(
        JOB_NAMES.deadLetter,
        {
          attemptsMade: job.attemptsMade,
          failedAt: new Date().toISOString(),
          jobId,
          jobName: job.name,
          queueName: QUEUE_NAMES.system,
        },
        { jobId: `dead-letter-${jobId}-${job.attemptsMade}` },
      );
      this.logger.error('worker.job.dead-lettered', {
        errorType: error.constructor.name,
        jobId,
        jobName: job.name,
        queue: QUEUE_NAMES.system,
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
      this.worker.close(),
      this.systemQueue.close(),
      this.deadLetterQueue.close(),
    ]);
  }
}
