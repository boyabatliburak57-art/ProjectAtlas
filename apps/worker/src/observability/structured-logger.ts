export type WorkerLogLevel = 'error' | 'warn' | 'info' | 'debug';

type LogFields = Readonly<Record<string, unknown>>;

const LEVEL_PRIORITY: Record<WorkerLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LogSink {
  write(line: string): void;
}

const stdoutSink: LogSink = {
  write(line) {
    process.stdout.write(`${line}\n`);
  },
};

export class StructuredLogger {
  constructor(
    private readonly minimumLevel: WorkerLogLevel,
    private readonly sink: LogSink = stdoutSink,
  ) {}

  debug(event: string, fields: LogFields = {}): void {
    this.write('debug', event, fields);
  }

  info(event: string, fields: LogFields = {}): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields: LogFields = {}): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields: LogFields = {}): void {
    this.write('error', event, fields);
  }

  private write(level: WorkerLogLevel, event: string, fields: LogFields): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minimumLevel]) {
      return;
    }

    this.sink.write(
      JSON.stringify({
        ...fields,
        event,
        level,
        service: 'atlas-worker',
        timestamp: new Date().toISOString(),
      }),
    );
  }
}
