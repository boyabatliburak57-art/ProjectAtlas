import { ConfigService } from '@nestjs/config';
import { ResilientTelemetry, type TelemetryPort } from '@atlas/types';
import { describe, expect, it } from 'vitest';

import { TelemetryService } from './telemetry.service';

describe('TelemetryService', () => {
  it('correlates HTTP logs and emits only safe queue trace context', () => {
    const lines: string[] = [];
    const service = new TelemetryService(
      new ConfigService({
        ATLAS_ENV: 'test',
        RELEASE_VERSION: 'test-release',
      }),
      { write: (line) => lines.push(line) },
    );

    service.runWithHttpContext(
      {
        requestId: 'request_12345678',
        correlationId: 'correlation_12345678',
        incomingTraceparent:
          '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      },
      () => {
        service.log('info', 'http.request.completed', {
          authorization: 'Bearer do-not-log',
          outcome: 'success',
        });
        expect(service.safeQueueContext()).toMatchObject({
          correlationId: 'correlation_12345678',
        });
        expect(service.safeQueueContext()?.traceparent).toMatch(
          /^00-4bf92f3577b34da6a3ce929d0e0e4736-[a-f0-9]{16}-01$/u,
        );
      },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('do-not-log');
    expect(JSON.parse(lines[0]!)).toMatchObject({
      correlationId: 'correlation_12345678',
      environment: 'test',
      eventCode: 'http.request.completed',
      releaseVersion: 'test-release',
      requestId: 'request_12345678',
      service: 'atlas-api',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    });
  });

  it('rejects high-cardinality metrics without changing application flow', () => {
    const service = new TelemetryService(new ConfigService({}), {
      write: () => {
        throw new Error('telemetry unavailable');
      },
    });

    expect(() =>
      service.metric({
        kind: 'counter',
        labels: { user_id: 'private-user' },
        name: 'unsafe.metric',
        value: 1,
      }),
    ).not.toThrow();
    expect(service.metricSnapshot()).toEqual([]);
  });

  it('does not repeat an application operation when telemetry fails', async () => {
    let executions = 0;
    const unavailable: TelemetryPort = {
      log: () => {
        throw new Error('telemetry unavailable');
      },
      metric: () => {
        throw new Error('telemetry unavailable');
      },
      span: async (_name, _context, operation) => {
        await operation();
        throw new Error('telemetry unavailable');
      },
    };
    const telemetry = new ResilientTelemetry(unavailable);

    await expect(
      telemetry.span('database.query', undefined, () => {
        executions += 1;
        return Promise.resolve('application-result');
      }),
    ).resolves.toBe('application-result');
    expect(executions).toBe(1);
  });
});
