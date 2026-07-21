import {
  buildStructuredLogRecord,
  type StructuredLogContext,
  type StructuredLogLevel,
} from '@atlas/types';

export type WorkerLogLevel = StructuredLogLevel;

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
    private readonly context: StructuredLogContext = {
      environment: process.env['ATLAS_ENV'] ?? 'local',
      releaseVersion: process.env['RELEASE_VERSION'] ?? 'development',
      service: 'atlas-worker',
    },
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

    const record = buildStructuredLogRecord(this.context, level, event, fields);
    this.sink.write(JSON.stringify({ ...record, event: record.eventCode }));
  }
}
