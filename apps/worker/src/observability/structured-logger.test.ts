import { describe, expect, it } from 'vitest';

import { type LogSink, StructuredLogger } from './structured-logger';

describe('StructuredLogger', () => {
  it('writes machine-readable service context', () => {
    const lines: string[] = [];
    const sink: LogSink = { write: (line) => lines.push(line) };
    const logger = new StructuredLogger('info', sink);

    logger.info('worker.ready', { queue: 'atlas.system.v1' });

    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'worker.ready',
      eventCode: 'worker.ready',
      environment: 'local',
      level: 'info',
      queue: 'atlas.system.v1',
      releaseVersion: 'development',
      service: 'atlas-worker',
    });
  });

  it('redacts nested secrets and connection strings centrally', () => {
    const lines: string[] = [];
    const logger = new StructuredLogger('info', {
      write: (line) => lines.push(line),
    });

    logger.info('worker.redaction.test', {
      authorization: 'Bearer secret-token',
      nested: { password: 'secret', safe: 'value' },
      message: 'failed at postgresql://user:password@db.internal/atlas',
    });

    const line = lines[0] ?? '';
    expect(line).not.toContain('secret-token');
    expect(line).not.toContain('password@db.internal');
    expect(line).toContain('[REDACTED]');
    expect(JSON.parse(line)).toMatchObject({ nested: { safe: 'value' } });
  });
});
