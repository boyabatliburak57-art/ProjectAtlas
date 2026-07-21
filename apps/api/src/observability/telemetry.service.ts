import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildStructuredLogRecord,
  createTraceparent,
  parseTraceparent,
  SafeMetricRecorder,
  type MetricPoint,
  type SafeTraceContext,
  type StructuredLogLevel,
} from '@atlas/types';

interface RequestTelemetryContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly traceparent: string;
}

export interface TelemetrySink {
  write(line: string): void;
}

const stdoutSink: TelemetrySink = {
  write(line) {
    process.stdout.write(`${line}\n`);
  },
};

@Injectable()
export class TelemetryService {
  private readonly storage = new AsyncLocalStorage<RequestTelemetryContext>();
  private readonly metrics = new SafeMetricRecorder();
  private readonly environment: string;
  private readonly releaseVersion: string;

  constructor(
    config: ConfigService,
    @Optional()
    private readonly sink: TelemetrySink = stdoutSink,
  ) {
    this.environment = config.get<string>('ATLAS_ENV') ?? 'local';
    this.releaseVersion =
      config.get<string>('RELEASE_VERSION') ?? 'development';
  }

  runWithHttpContext<T>(
    input: {
      readonly requestId: string;
      readonly correlationId: string;
      readonly incomingTraceparent?: string;
    },
    operation: () => T,
  ): T {
    const incoming = parseTraceparent(input.incomingTraceparent);
    const traceId = incoming?.traceId ?? randomUUID().replaceAll('-', '');
    const spanId = randomUUID().replaceAll('-', '').slice(0, 16);
    const traceparent = createTraceparent(
      traceId,
      spanId,
      incoming?.sampled ?? true,
    );
    return this.storage.run(
      {
        correlationId: input.correlationId,
        requestId: input.requestId,
        spanId,
        traceId,
        traceparent,
      },
      operation,
    );
  }

  currentContext(): RequestTelemetryContext | undefined {
    return this.storage.getStore();
  }

  safeQueueContext(): SafeTraceContext | undefined {
    const current = this.currentContext();
    return current === undefined
      ? undefined
      : {
          correlationId: current.correlationId,
          traceparent: current.traceparent,
        };
  }

  log(
    level: StructuredLogLevel,
    eventCode: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    try {
      const current = this.currentContext();
      const record = buildStructuredLogRecord(
        {
          environment: this.environment,
          releaseVersion: this.releaseVersion,
          service: 'atlas-api',
        },
        level,
        eventCode,
        {
          ...(current === undefined
            ? {}
            : {
                correlationId: current.correlationId,
                requestId: current.requestId,
                traceId: current.traceId,
              }),
          ...fields,
        },
      );
      this.sink.write(JSON.stringify(record));
    } catch {
      // Telemetry is explicitly best-effort and cannot change the request result.
    }
  }

  metric(point: MetricPoint): void {
    try {
      this.metrics.record(point);
    } catch (error) {
      this.log('warn', 'telemetry.metric.rejected', {
        errorCategory:
          error instanceof Error ? error.constructor.name : 'UnknownError',
        outcome: 'rejected',
      });
    }
  }

  metricSnapshot(): readonly MetricPoint[] {
    return this.metrics.snapshot();
  }

  prometheusSnapshot(): string {
    const points = [
      ...this.metrics.snapshot(),
      {
        kind: 'gauge' as const,
        labels: {
          environment: this.environment,
          service: 'atlas-api',
        },
        name: 'process.memory.bytes',
        value: process.memoryUsage().rss,
      },
      {
        kind: 'gauge' as const,
        labels: {
          environment: this.environment,
          service: 'atlas-api',
        },
        name: 'process.uptime.seconds',
        value: process.uptime(),
      },
    ];
    const aggregates = new Map<string, number>();
    for (const point of points) {
      const metric = `atlas_${point.name.replaceAll('.', '_')}`;
      const labels = Object.entries(point.labels)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}="${escapeLabel(value)}"`)
        .join(',');
      const key = `${metric}{${labels}}`;
      aggregates.set(
        key,
        point.kind === 'counter'
          ? (aggregates.get(key) ?? 0) + point.value
          : point.value,
      );
    }
    return `${[...aggregates.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key} ${String(value)}`)
      .join('\n')}\n`;
  }

  async span<T>(
    name: string,
    attributes: Readonly<Record<string, unknown>>,
    operation: () => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    const spanId = randomUUID().replaceAll('-', '').slice(0, 16);
    this.log('debug', 'trace.span.started', {
      ...attributes,
      operation: name,
      spanId,
    });
    try {
      const result = await operation();
      this.log('debug', 'trace.span.completed', {
        ...attributes,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        operation: name,
        outcome: 'success',
        spanId,
      });
      return result;
    } catch (error) {
      this.log('warn', 'trace.span.completed', {
        ...attributes,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        errorCategory:
          error instanceof Error ? error.constructor.name : 'UnknownError',
        operation: name,
        outcome: 'error',
        spanId,
      });
      throw error;
    }
  }
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
