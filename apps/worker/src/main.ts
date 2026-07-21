import 'dotenv/config';

import { parseEnvironment } from './config/environment';
import { StructuredLogger } from './observability/structured-logger';
import { installShutdownHandlers } from './runtime/shutdown';
import { WorkerRuntime } from './runtime/worker-runtime';

async function bootstrap(): Promise<void> {
  let logger = new StructuredLogger('info');

  try {
    const environment = parseEnvironment(process.env);
    logger = new StructuredLogger(environment.WORKER_LOG_LEVEL, undefined, {
      environment: environment.ATLAS_ENV ?? 'local',
      releaseVersion: environment.RELEASE_VERSION ?? 'development',
      service: `atlas-worker-${environment.WORKER_ROLE}`,
    });
    const runtime = await WorkerRuntime.start(environment, logger);
    installShutdownHandlers(runtime, logger);
  } catch (error: unknown) {
    logger.error('worker.startup.failed', {
      errorType:
        error instanceof Error ? error.constructor.name : 'UnknownError',
    });
    process.exitCode = 1;
  }
}

void bootstrap();
