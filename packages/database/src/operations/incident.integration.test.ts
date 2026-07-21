import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../client';
import { runMigrations } from '../migration';

function testDatabaseUrl(): string {
  const value = process.env['TEST_DATABASE_URL'];
  if (value === undefined || !new URL(value).pathname.endsWith('_test'))
    throw new Error('A *_test TEST_DATABASE_URL is required');
  return value;
}

describe('DB-009 incident timeline invariants', () => {
  const { db, pool } = createDatabase(testDatabaseUrl());

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
  });

  afterAll(() => pool.end());

  it('stores ordered timeline events and prevents duplicate sequence', async () => {
    const incidentId = randomUUID();
    await pool.query(
      `insert into incidents
        (id, severity, status, title, summary, detected_at)
       values ($1, 'SEV-2', 'detected', 'Worker interruption',
               'Controlled game-day fixture', now())`,
      [incidentId],
    );
    await pool.query(
      `insert into incident_timeline_events
        (incident_id, sequence, event_type, message)
       values ($1, 1, 'detected', 'Alert fired')`,
      [incidentId],
    );
    await expect(
      pool.query(
        `insert into incident_timeline_events
          (incident_id, sequence, event_type, message)
         values ($1, 1, 'acknowledged', 'Duplicate sequence')`,
        [incidentId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('makes timeline records immutable', async () => {
    await expect(
      pool.query(`update incident_timeline_events set message = 'changed'`),
    ).rejects.toThrow('incident timeline events are immutable');
    await expect(
      pool.query(`delete from incident_timeline_events`),
    ).rejects.toThrow('incident timeline events are immutable');
  });
});
