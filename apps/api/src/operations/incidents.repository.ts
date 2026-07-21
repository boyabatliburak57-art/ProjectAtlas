import {
  incidentTimelineEvents,
  incidents,
  operationalAuditEvents,
  type Database,
} from '@atlas/database';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';

type IncidentStatus = 'detected' | 'acknowledged' | 'mitigating' | 'resolved';
type IncidentRow = typeof incidents.$inferSelect;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class IncidentRepository {
  constructor(private readonly connection: ApiDatabase) {}

  async list() {
    const rows = await this.connection.database
      .select()
      .from(incidents)
      .orderBy(desc(incidents.detectedAt), desc(incidents.id))
      .limit(100);
    return rows.map(mapIncident);
  }

  async get(id: string) {
    const incidentRows = await this.connection.database
      .select()
      .from(incidents)
      .where(eq(incidents.id, id))
      .limit(1);
    if (incidentRows[0] === undefined) return null;
    const timeline = await this.connection.database
      .select()
      .from(incidentTimelineEvents)
      .where(eq(incidentTimelineEvents.incidentId, id))
      .orderBy(asc(incidentTimelineEvents.sequence));
    return { ...mapIncident(incidentRows[0]), timeline };
  }

  async create(input: {
    readonly id: string;
    readonly severity: 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4';
    readonly title: string;
    readonly summary: string;
    readonly impact?: string;
    readonly commanderUserId: string;
    readonly detectedAt: Date;
  }) {
    return this.connection.database.transaction(async (transaction) => {
      const inserted = await transaction
        .insert(incidents)
        .values({
          id: input.id,
          severity: input.severity,
          status: 'detected',
          title: input.title,
          summary: input.summary,
          ...(input.impact === undefined ? {} : { impact: input.impact }),
          commanderUserId: input.commanderUserId,
          detectedAt: input.detectedAt,
          createdAt: input.detectedAt,
          updatedAt: input.detectedAt,
        })
        .returning();
      await appendTimeline(transaction, {
        actorUserId: input.commanderUserId,
        eventType: 'detected',
        incidentId: input.id,
        message: 'Incident detected and record created.',
        now: input.detectedAt,
      });
      await appendAudit(
        transaction,
        input.commanderUserId,
        'incident.create',
        input.id,
      );
      return mapIncident(inserted[0]!);
    });
  }

  async transition(input: {
    readonly actorUserId: string;
    readonly id: string;
    readonly message: string;
    readonly nextStatus: 'acknowledged';
    readonly now: Date;
  }) {
    return this.connection.database.transaction(async (transaction) => {
      const rows = await transaction
        .update(incidents)
        .set({
          acknowledgedAt: input.now,
          commanderUserId: input.actorUserId,
          status: input.nextStatus,
          updatedAt: input.now,
        })
        .where(
          and(eq(incidents.id, input.id), eq(incidents.status, 'detected')),
        )
        .returning();
      if (rows[0] === undefined)
        return this.classifyTransitionFailure(transaction, input.id);
      await appendTimeline(transaction, {
        actorUserId: input.actorUserId,
        eventType: 'acknowledged',
        incidentId: input.id,
        message: input.message,
        now: input.now,
      });
      await appendAudit(
        transaction,
        input.actorUserId,
        'incident.acknowledge',
        input.id,
      );
      return { outcome: 'updated' as const, incident: mapIncident(rows[0]) };
    });
  }

  async addTimeline(input: {
    readonly actorUserId: string;
    readonly eventType:
      | 'mitigation_started'
      | 'mitigation_update'
      | 'follow_up';
    readonly id: string;
    readonly message: string;
    readonly now: Date;
  }) {
    return this.connection.database.transaction(async (transaction) => {
      const existing = await transaction
        .select({ id: incidents.id, status: incidents.status })
        .from(incidents)
        .where(eq(incidents.id, input.id))
        .for('update')
        .limit(1);
      if (existing[0] === undefined) return null;
      if (
        input.eventType === 'mitigation_started' &&
        existing[0].status !== 'resolved'
      )
        await transaction
          .update(incidents)
          .set({ status: 'mitigating', updatedAt: input.now })
          .where(eq(incidents.id, input.id));
      const timeline = await appendTimeline(transaction, {
        actorUserId: input.actorUserId,
        eventType: input.eventType,
        incidentId: input.id,
        message: input.message,
        now: input.now,
      });
      await appendAudit(
        transaction,
        input.actorUserId,
        `incident.${input.eventType}`,
        input.id,
      );
      return timeline;
    });
  }

  async resolve(input: {
    readonly actorUserId: string;
    readonly id: string;
    readonly resolution: string;
    readonly rootCause?: string;
    readonly followUps: readonly string[];
    readonly now: Date;
  }) {
    return this.connection.database.transaction(async (transaction) => {
      const rows = await transaction
        .update(incidents)
        .set({
          followUpSummary: { items: input.followUps },
          resolution: input.resolution,
          resolvedAt: input.now,
          ...(input.rootCause === undefined
            ? {}
            : { rootCause: input.rootCause }),
          status: 'resolved',
          updatedAt: input.now,
        })
        .where(
          and(
            eq(incidents.id, input.id),
            inArray(incidents.status, [
              'detected',
              'acknowledged',
              'mitigating',
            ]),
          ),
        )
        .returning();
      if (rows[0] === undefined)
        return this.classifyTransitionFailure(transaction, input.id);
      await appendTimeline(transaction, {
        actorUserId: input.actorUserId,
        eventType: 'resolved',
        incidentId: input.id,
        message: input.resolution,
        now: input.now,
      });
      await appendAudit(
        transaction,
        input.actorUserId,
        'incident.resolve',
        input.id,
      );
      return { outcome: 'updated' as const, incident: mapIncident(rows[0]) };
    });
  }

  private async classifyTransitionFailure(
    database: Transaction,
    id: string,
  ): Promise<
    | { readonly outcome: 'not_found' }
    | { readonly outcome: 'invalid_transition' }
  > {
    const rows = await database
      .select({ id: incidents.id })
      .from(incidents)
      .where(eq(incidents.id, id))
      .limit(1);
    return rows[0] === undefined
      ? { outcome: 'not_found' }
      : { outcome: 'invalid_transition' };
  }
}

async function appendAudit(
  database: Transaction,
  actorUserId: string,
  action: string,
  resourceId: string,
): Promise<void> {
  await database.insert(operationalAuditEvents).values({
    action,
    actorType: 'operations_admin',
    actorUserId,
    environment: process.env['ATLAS_ENV'] ?? 'local',
    resourceId,
    resourceType: 'incident',
  });
}

async function appendTimeline(
  database: Transaction,
  input: {
    readonly actorUserId: string;
    readonly eventType:
      | 'detected'
      | 'acknowledged'
      | 'mitigation_started'
      | 'mitigation_update'
      | 'resolved'
      | 'follow_up';
    readonly incidentId: string;
    readonly message: string;
    readonly now: Date;
  },
) {
  const sequence = await database
    .select({
      next: sql<number>`coalesce(max(${incidentTimelineEvents.sequence}), 0) + 1`,
    })
    .from(incidentTimelineEvents)
    .where(eq(incidentTimelineEvents.incidentId, input.incidentId));
  const rows = await database
    .insert(incidentTimelineEvents)
    .values({
      actorUserId: input.actorUserId,
      createdAt: input.now,
      eventType: input.eventType,
      incidentId: input.incidentId,
      message: input.message,
      sequence: Number(sequence[0]?.next ?? 1),
    })
    .returning();
  return rows[0]!;
}

function mapIncident(row: IncidentRow) {
  return {
    ...row,
    status: row.status as IncidentStatus,
    severity: row.severity as 'SEV-1' | 'SEV-2' | 'SEV-3' | 'SEV-4',
  };
}
