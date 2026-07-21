import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';

import { TelemetryService } from '../observability/telemetry.service';
import { IncidentRepository } from './incidents.repository';

export const incidentSeveritySchema = z.enum([
  'SEV-1',
  'SEV-2',
  'SEV-3',
  'SEV-4',
]);
const createIncidentSchema = z.object({
  severity: incidentSeveritySchema,
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(8_192),
  impact: z.string().trim().min(1).max(8_192).optional(),
});
const timelineSchema = z.object({
  eventType: z.enum(['mitigation_started', 'mitigation_update', 'follow_up']),
  message: z.string().trim().min(1).max(8_192),
});
const resolutionSchema = z.object({
  resolution: z.string().trim().min(1).max(8_192),
  rootCause: z.string().trim().min(1).max(8_192).optional(),
  followUps: z.array(z.string().trim().min(1).max(512)).max(100).default([]),
});

@Injectable()
export class IncidentsService {
  constructor(
    private readonly repository: IncidentRepository,
    private readonly telemetry: TelemetryService,
  ) {}

  list() {
    return this.repository.list();
  }

  async get(id: string) {
    const value = await this.repository.get(id);
    if (value === null) throw incidentNotFound();
    return value;
  }

  async create(actorUserId: string, rawInput: unknown) {
    const input = parse(createIncidentSchema, rawInput);
    const now = new Date();
    const incident = await this.repository.create({
      commanderUserId: actorUserId,
      detectedAt: now,
      id: randomUUID(),
      severity: input.severity,
      summary: input.summary,
      title: input.title,
      ...(input.impact === undefined ? {} : { impact: input.impact }),
    });
    this.telemetry.log('error', 'incident.created', {
      outcome: 'detected',
      resourceRef: incident.id,
      severity: incident.severity,
    });
    return incident;
  }

  async acknowledge(id: string, actorUserId: string) {
    const result = await this.repository.transition({
      actorUserId,
      id,
      message: 'Incident acknowledged and commander assigned.',
      nextStatus: 'acknowledged',
      now: new Date(),
    });
    return transitionResult(result);
  }

  async addTimeline(id: string, actorUserId: string, rawInput: unknown) {
    const input = parse(timelineSchema, rawInput);
    const result = await this.repository.addTimeline({
      ...input,
      actorUserId,
      id,
      now: new Date(),
    });
    if (result === null) throw incidentNotFound();
    return result;
  }

  async resolve(id: string, actorUserId: string, rawInput: unknown) {
    const input = parse(resolutionSchema, rawInput);
    const result = await this.repository.resolve({
      actorUserId,
      followUps: input.followUps,
      id,
      now: new Date(),
      resolution: input.resolution,
      ...(input.rootCause === undefined ? {} : { rootCause: input.rootCause }),
    });
    const incident = transitionResult(result);
    this.telemetry.log('info', 'incident.resolved', {
      outcome: 'resolved',
      resourceRef: incident.id,
      severity: incident.severity,
    });
    return incident;
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: 'INCIDENT_VALIDATION_FAILED',
      details: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
      })),
      message: 'Incident request is invalid',
    });
  return result.data;
}

function transitionResult<T>(
  result:
    | { readonly outcome: 'updated'; readonly incident: T }
    | {
        readonly outcome: 'not_found' | 'invalid_transition';
      },
): T {
  if ('incident' in result) return result.incident;
  if (result.outcome === 'not_found') throw incidentNotFound();
  if (result.outcome === 'invalid_transition')
    throw new ConflictException({
      code: 'INCIDENT_INVALID_TRANSITION',
      message: 'Incident state transition is not allowed',
    });
  throw new Error('Unreachable incident transition outcome');
}

function incidentNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'INCIDENT_NOT_FOUND',
    message: 'Incident was not found',
  });
}
