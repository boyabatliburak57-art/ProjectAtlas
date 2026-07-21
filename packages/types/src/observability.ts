export const TELEMETRY_POLICY_VERSION = 'telemetry-v1';

export interface SafeTraceContext {
  readonly traceparent: string;
  readonly tracestate?: string;
  readonly correlationId?: string;
}

export interface StructuredLogContext {
  readonly environment: string;
  readonly releaseVersion: string;
  readonly service: string;
}

export type StructuredLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogRecord {
  readonly timestamp: string;
  readonly level: StructuredLogLevel;
  readonly service: string;
  readonly environment: string;
  readonly releaseVersion: string;
  readonly eventCode: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly traceId?: string;
  readonly jobId?: string;
  readonly runId?: string;
  readonly actorRef?: string;
  readonly resourceRef?: string;
  readonly durationMs?: number;
  readonly outcome?: string;
  readonly errorCategory?: string;
  readonly [field: string]: unknown;
}

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /(authorization|cookie|session.?token|password|reset.?token|provider.?secret|connection.?string|database.?url|redis.?url|raw.?upload|user.?note|access.?token|secret.?key)/iu;
const CONNECTION_STRING =
  /\b(?:postgres(?:ql)?|redis|rediss|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/giu;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;

export function redactTelemetryValue(
  value: unknown,
  key = '',
  seen = new WeakSet<object>(),
): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string')
    return value
      .replace(CONNECTION_STRING, REDACTED)
      .replace(BEARER_TOKEN, `Bearer ${REDACTED}`);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value))
    return value.map((item) => redactTelemetryValue(item, key, seen));
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      redactTelemetryValue(childValue, childKey, seen),
    ]),
  );
}

export function buildStructuredLogRecord(
  context: StructuredLogContext,
  level: StructuredLogLevel,
  eventCode: string,
  fields: Readonly<Record<string, unknown>> = {},
  now = new Date(),
): StructuredLogRecord {
  const safeFields = redactTelemetryValue(fields) as Record<string, unknown>;
  return {
    ...safeFields,
    timestamp: now.toISOString(),
    level,
    service: context.service,
    environment: context.environment,
    releaseVersion: context.releaseVersion,
    eventCode,
  };
}

const TRACEPARENT_PATTERN = /^00-([a-f0-9]{32})-([a-f0-9]{16})-(0[01])$/u;

export function parseTraceparent(value: string | undefined):
  | {
      readonly traceId: string;
      readonly parentSpanId: string;
      readonly sampled: boolean;
    }
  | undefined {
  const match = value?.toLowerCase().match(TRACEPARENT_PATTERN);
  if (
    match === null ||
    match === undefined ||
    match[1] === '00000000000000000000000000000000' ||
    match[2] === '0000000000000000'
  )
    return undefined;
  return {
    traceId: match[1]!,
    parentSpanId: match[2]!,
    sampled: match[3] === '01',
  };
}

export function createTraceparent(
  traceId: string,
  spanId: string,
  sampled = true,
): string {
  const normalizedTrace = traceId.replaceAll('-', '').toLowerCase();
  const normalizedSpan = spanId.replaceAll('-', '').toLowerCase().slice(0, 16);
  if (!/^[a-f0-9]{32}$/u.test(normalizedTrace))
    throw new Error('traceId must be 16-byte lowercase hex');
  if (!/^[a-f0-9]{16}$/u.test(normalizedSpan))
    throw new Error('spanId must be 8-byte lowercase hex');
  return `00-${normalizedTrace}-${normalizedSpan}-${sampled ? '01' : '00'}`;
}

export const METRIC_LABEL_ALLOWLIST = new Set([
  'environment',
  'service',
  'release',
  'route',
  'method',
  'status_class',
  'queue',
  'job_type',
  'outcome',
  'error_category',
  'operation',
]);

const HIGH_CARDINALITY_LABEL =
  /(user|actor|instrument|symbol|request|correlation|trace|job|run|resource|email|payload|url|path)/iu;

export function assertBoundedMetricLabels(
  labels: Readonly<Record<string, string>>,
): void {
  for (const [key, value] of Object.entries(labels)) {
    if (!METRIC_LABEL_ALLOWLIST.has(key) || HIGH_CARDINALITY_LABEL.test(key))
      throw new Error(`Metric label is not allowlisted: ${key}`);
    if (value.length > 96 || /[\n\r]/u.test(value))
      throw new Error(`Metric label value is not bounded: ${key}`);
  }
}

export interface MetricPoint {
  readonly name: string;
  readonly value: number;
  readonly labels: Readonly<Record<string, string>>;
  readonly kind: 'counter' | 'gauge' | 'histogram';
}

export class SafeMetricRecorder {
  private readonly points: MetricPoint[] = [];

  record(point: MetricPoint): void {
    assertBoundedMetricLabels(point.labels);
    if (!Number.isFinite(point.value))
      throw new Error(`Metric value must be finite: ${point.name}`);
    this.points.push({ ...point, labels: { ...point.labels } });
  }

  snapshot(): readonly MetricPoint[] {
    return this.points.map((point) => ({
      ...point,
      labels: { ...point.labels },
    }));
  }
}

export interface TelemetryPort {
  log(
    level: StructuredLogLevel,
    eventCode: string,
    fields?: Readonly<Record<string, unknown>>,
  ): void;
  metric(point: MetricPoint): void;
  span<T>(
    name: string,
    context: SafeTraceContext | undefined,
    operation: () => Promise<T>,
  ): Promise<T>;
}

export class ResilientTelemetry implements TelemetryPort {
  constructor(
    private readonly delegate: TelemetryPort,
    private readonly fallback?: (error: unknown) => void,
  ) {}

  log(
    level: StructuredLogLevel,
    eventCode: string,
    fields: Readonly<Record<string, unknown>> = {},
  ): void {
    try {
      this.delegate.log(level, eventCode, fields);
    } catch (error) {
      this.fallback?.(error);
    }
  }

  metric(point: MetricPoint): void {
    try {
      this.delegate.metric(point);
    } catch (error) {
      this.fallback?.(error);
    }
  }

  async span<T>(
    name: string,
    context: SafeTraceContext | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    let operationPromise: Promise<T> | undefined;
    const runOnce = () => {
      operationPromise ??= operation();
      return operationPromise;
    };
    try {
      return await this.delegate.span(name, context, runOnce);
    } catch (telemetryError) {
      this.fallback?.(telemetryError);
      return runOnce();
    }
  }
}
