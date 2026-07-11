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
      level: 'info',
      queue: 'atlas.system.v1',
      service: 'atlas-worker',
    });
  });
});
