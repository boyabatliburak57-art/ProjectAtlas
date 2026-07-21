import 'reflect-metadata';

import type { Server } from 'node:http';

import {
  backtestDataSnapshots,
  createDatabase,
  runMigrations,
  strategies,
  strategyRevisions,
} from '@atlas/database';
import type { ExperimentQueuePayload } from '@atlas/types';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Queue } from 'bullmq';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { configureApplication } from '../bootstrap/configure-application';
import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';

const ownerUserId = '00000000-0000-4000-8000-000000000711';
const strategyId = '00000000-0000-4000-8000-000000000712';
const snapshotId = '00000000-0000-4000-8000-000000000713';

describe('experiment production API dispatch', () => {
  const databaseUrl = requireTestDatabaseUrl();
  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const { db, pool } = createDatabase(databaseUrl);
  const queue = new Queue<ExperimentQueuePayload>('atlas.experiments.v1', {
    connection: { url: redisUrl },
  });
  let application: INestApplication;

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    await queue.waitUntilReady();
    await queue.obliterate({ force: true });
    await db.insert(strategies).values({
      id: strategyId,
      ownerUserId,
      name: 'API Experiment Strategy',
      status: 'validated',
      currentRevision: 1,
    });
    await db.insert(strategyRevisions).values({
      strategyId,
      revision: 1,
      schemaVersion: 1,
      definition: validStrategyDefinition(),
      validationStatus: 'valid',
      complexityScore: 10,
      createdBy: ownerUserId,
    });
    await db.insert(backtestDataSnapshots).values({
      id: snapshotId,
      snapshotHash: 'api-experiment-snapshot-v1',
      schemaVersion: 1,
      marketRevisionHash: 'market-v1',
      universeRevisionHash: 'universe-v1',
      fundamentalRevisionHash: 'fundamental-v1',
      corporateActionRevisionHash: 'action-v1',
      dataCutoffAt: new Date('2025-01-31T15:00:00.000Z'),
      coverageStatus: 'complete',
    });
    const auth: AuthenticatedUserResolver = () => ownerUserId;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ApiDatabase)
      .useValue({ database: db })
      .overrideProvider(AUTHENTICATED_USER_RESOLVER)
      .useValue(auth)
      .compile();
    application = module.createNestApplication({ logger: false });
    configureApplication(application);
    await application.init();
  }, 30_000);

  afterAll(async () => {
    await Promise.allSettled([application?.close(), queue.close(), pool.end()]);
  });

  it('creates through HTTP and dispatches only the identifier and safe trace context', async () => {
    const server = application.getHttpServer() as Server;
    const response = await request(server)
      .post('/api/v1/experiments')
      .send({
        name: 'API to production queue',
        strategyId,
        strategyRevision: 1,
        dataSnapshotId: snapshotId,
        dataSnapshotHash: 'api-experiment-snapshot-v1',
        definition: {
          parameterDefinitions: [
            {
              name: 'period',
              type: 'integer',
              defaultValue: 10,
              minimum: 5,
              maximum: 20,
            },
          ],
          grid: {
            axes: [{ parameter: 'period', values: [10, 20] }],
            samples: [
              {
                role: 'train',
                from: '2020-01-01T00:00:00.000Z',
                to: '2022-12-31T23:59:59.999Z',
              },
            ],
            maximumCombinations: 10,
          },
        },
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const body: unknown = response.body;
    if (!isRecord(body) || !isRecord(body['data']))
      throw new Error('EXPERIMENT_RESPONSE_INVALID');
    const experimentId = body['data']['id'];
    if (typeof experimentId !== 'string')
      throw new Error('EXPERIMENT_RESPONSE_INVALID');
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed']);
    const job = jobs.find((item) => item.data.experimentId === experimentId);
    expect(job?.name).toBe('backtests.experiment.v1');
    expect(job?.data).toMatchObject({ experimentId });
    expect(typeof job?.data.telemetry?.correlationId).toBe('string');
    expect(job?.data.telemetry?.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
    );
    expect(Object.keys(job?.data ?? {}).sort()).toEqual([
      'experimentId',
      'telemetry',
    ]);
  });
});

function requireTestDatabaseUrl(): string {
  const value = process.env.TEST_DATABASE_URL;
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validStrategyDefinition() {
  const universe = {
    market: 'BIST',
    statuses: ['active'],
    indexCodes: [],
    sectorIds: [],
  };
  const rule = (operator: 'GT' | 'LT') => ({
    version: 1,
    universe,
    root: {
      type: 'group',
      nodeId: `${operator}-root`,
      operator: 'AND',
      children: [
        {
          type: 'condition',
          nodeId: `${operator}-condition`,
          operator,
          left: { type: 'priceField', field: 'close', timeframe: '1d' },
          right: { type: 'constantNumber', value: 10 },
        },
      ],
    },
  });
  return {
    schemaVersion: 1,
    baseTimeframe: '1d',
    entryRule: rule('GT'),
    exitRule: rule('LT'),
    filterRule: null,
    parameters: [],
    positionSizing: { type: 'equalWeight' },
    riskControls: {
      maxPositionWeight: 20,
      maxConcurrentPositions: 5,
      allowShort: false,
      allowLeverage: false,
      allowNegativeCash: false,
    },
    executionPolicy: {
      code: 'closed_bar_next_open',
      version: 'next-open-v1',
      signalBarPolicy: 'closed_only',
      higherTimeframeBarPolicy: 'closed_only',
      missingBarPolicy: 'skip_fill',
    },
    costPolicy: {
      code: 'cost_free',
      version: 'cost-free-v1',
      explicitlyAccepted: true,
    },
    dataIntegrityPolicy: {
      universePolicy: 'point_in_time',
      fundamentalAvailabilityPolicy: 'publication_and_revision',
      corporateActionPolicyVersion: 'actions-v1',
      adjustmentMode: 'raw',
    },
    benchmarkCode: null,
  };
}
