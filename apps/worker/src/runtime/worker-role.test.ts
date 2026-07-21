import { describe, expect, it } from 'vitest';

import { readSafeTraceContext, roleConsumesQueue } from './worker-runtime';

describe('production worker process roles', () => {
  it('keeps every production queue composition root explicit', () => {
    expect(roleConsumesQueue('market-data', 'market-data')).toBe(true);
    expect(roleConsumesQueue('scanner', 'scanner')).toBe(true);
    expect(roleConsumesQueue('alert', 'alert')).toBe(true);
    expect(roleConsumesQueue('notification', 'notification')).toBe(true);
    expect(roleConsumesQueue('backtest', 'backtest')).toBe(true);
    expect(roleConsumesQueue('experiment', 'experiment')).toBe(true);
    expect(roleConsumesQueue('scheduled', 'scheduled')).toBe(true);
  });

  it('does not let a dedicated process consume another role queue', () => {
    expect(roleConsumesQueue('scanner', 'backtest')).toBe(false);
    expect(roleConsumesQueue('alert', 'notification')).toBe(false);
    expect(roleConsumesQueue('scheduled', 'market-data')).toBe(false);
  });

  it('preserves the all role for local and integration composition', () => {
    expect(roleConsumesQueue('all', 'scanner')).toBe(true);
    expect(roleConsumesQueue('all', 'experiment')).toBe(true);
  });
});

describe('worker queue trace propagation', () => {
  it('accepts only W3C trace context and safe correlation metadata', () => {
    expect(
      readSafeTraceContext({
        telemetry: {
          traceparent:
            '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
          correlationId: 'correlation_12345678',
          authorization: 'must-not-propagate',
        },
      }),
    ).toEqual({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      correlationId: 'correlation_12345678',
    });
    expect(
      readSafeTraceContext({ telemetry: { traceparent: 'invalid' } }),
    ).toBeUndefined();
  });
});
