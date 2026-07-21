import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { TelemetryService } from '../observability/telemetry.service';
import { IncidentRepository } from './incidents.repository';
import { IncidentsService } from './incidents.service';

describe('IncidentsService', () => {
  it('records detection, acknowledgement, mitigation and resolution timeline', async () => {
    const timeline: Array<Record<string, unknown>> = [];
    let incident: Record<string, unknown> | null = null;
    const repository = {
      list: () => Promise.resolve(incident === null ? [] : [incident]),
      get: () =>
        Promise.resolve(
          incident === null ? null : { ...incident, timeline: [...timeline] },
        ),
      create: (input: Record<string, unknown>) => {
        incident = { ...input, status: 'detected' };
        timeline.push({ eventType: 'detected', sequence: 1 });
        return Promise.resolve(incident);
      },
      transition: (input: Record<string, unknown>) => {
        incident = { ...incident, status: input['nextStatus'] };
        timeline.push({ eventType: 'acknowledged', sequence: 2 });
        return Promise.resolve({ outcome: 'updated', incident });
      },
      addTimeline: (input: Record<string, unknown>) => {
        timeline.push({
          eventType: input['eventType'],
          sequence: timeline.length + 1,
        });
        return Promise.resolve(timeline.at(-1));
      },
      resolve: (input: Record<string, unknown>) => {
        incident = {
          ...incident,
          resolution: input['resolution'],
          status: 'resolved',
        };
        timeline.push({ eventType: 'resolved', sequence: timeline.length + 1 });
        return Promise.resolve({ outcome: 'updated', incident });
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        IncidentsService,
        { provide: IncidentRepository, useValue: repository },
        {
          provide: TelemetryService,
          useFactory: () =>
            new TelemetryService(new ConfigService({}), {
              write: () => undefined,
            }),
        },
      ],
    }).compile();
    const service = module.get(IncidentsService);
    const actor = randomUUID();

    const created = await service.create(actor, {
      severity: 'SEV-2',
      title: 'Worker interruption',
      summary: 'Controlled staging game-day',
    });
    await service.acknowledge(String(created.id), actor);
    await service.addTimeline(String(created.id), actor, {
      eventType: 'mitigation_started',
      message: 'Worker restarted and queue reconciliation started.',
    });
    await service.resolve(String(created.id), actor, {
      resolution: 'Queue recovered and backlog drained.',
      rootCause: 'Controlled worker interruption.',
      followUps: ['Verify worker interruption alert cooldown.'],
    });

    const result = await service.get(String(created.id));
    expect(result).toMatchObject({ status: 'resolved' });
    expect(result.timeline).toEqual([
      { eventType: 'detected', sequence: 1 },
      { eventType: 'acknowledged', sequence: 2 },
      { eventType: 'mitigation_started', sequence: 3 },
      { eventType: 'resolved', sequence: 4 },
    ]);
  });
});
