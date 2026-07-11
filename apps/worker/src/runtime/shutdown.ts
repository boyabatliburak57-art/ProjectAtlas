import type { StructuredLogger } from '../observability/structured-logger';
import type { WorkerRuntime } from './worker-runtime';

const SIGNALS = ['SIGINT', 'SIGTERM'] as const;

export function installShutdownHandlers(
  runtime: WorkerRuntime,
  logger: StructuredLogger,
): () => void {
  let shutdownStarted = false;

  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of SIGNALS) {
    const handler = (): void => {
      if (shutdownStarted) {
        return;
      }

      shutdownStarted = true;
      void runtime
        .stop(signal)
        .then(() => {
          process.exitCode = 0;
        })
        .catch((error: unknown) => {
          logger.error('worker.shutdown.failed', {
            errorType:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            signal,
          });
          process.exitCode = 1;
        });
    };

    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) {
      process.off(signal, handler);
    }
  };
}
