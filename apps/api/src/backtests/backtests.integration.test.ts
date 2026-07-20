/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import type { Server } from 'node:http';

import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  BacktestRunApplicationService,
  BacktestRuntimeApplicationError,
  StrategyDomainError,
  type BacktestRunCreationInput,
  type BacktestRunRecord,
  type BacktestRunRepository,
} from '@atlas/domain';
import type { Request } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { GlobalExceptionFilter } from '../common/http/global-exception.filter';
import {
  BacktestsController,
  ExperimentsController,
  StrategiesController,
} from './backtests.controller';
import {
  BACKTEST_APPLICATION,
  BacktestsService,
  ExperimentsService,
  STRATEGY_APPLICATION,
  StrategiesService,
} from './backtests.service';
import {
  BACKTEST_ANALYTICS_STORE,
  BACKTEST_COMMAND_GUARD,
  BACKTEST_RUN_REPOSITORY,
  EXPERIMENT_STORE,
  STRATEGY_REPOSITORY,
  type BacktestAnalyticsStore,
  type BacktestCommandGuard,
  type ExperimentRecord,
  type ExperimentStore,
} from './backtests.ports';

const owner = '00000000-0000-4000-8000-000000006801';
const other = '00000000-0000-4000-8000-000000006802';
const strategyId = '00000000-0000-4000-8000-000000006811';
const runId = '00000000-0000-4000-8000-000000006821';
const secondRunId = '00000000-0000-4000-8000-000000006822';
const experimentId = '00000000-0000-4000-8000-000000006831';
const snapshotId = '00000000-0000-4000-8000-000000006841';
const now = new Date('2026-07-18T12:00:00.000Z');

describe('backtest API analytics and export', () => {
  let application: INestApplication;
  const strategies = new FixtureStrategies();
  const runs = new MemoryRunRepository();
  const analytics = new FixtureAnalytics();
  const experiments = new FixtureExperiments();
  const guard = new FixtureGuard();
  const runApplication = new BacktestRunApplicationService({
    repository: runs,
    snapshotResolver: {
      resolve: () =>
        Promise.resolve({
          id: snapshotId,
          hash: 'snapshot-068',
          dataCutoffAt: now.toISOString(),
          universeSnapshot: { version: 'u1' },
          events: [],
          coverageStatus: 'complete',
        }),
    },
    entitlement: {
      authorize: () =>
        Promise.resolve({ allowed: true, maximumComplexityScore: 100 }),
    },
    dispatcher: { dispatch: () => Promise.resolve() },
    idGenerator: () => runId,
    now: () => now,
  });

  beforeAll(async () => {
    const auth: AuthenticatedUserResolver = (request: Request) =>
      String(request.headers['x-user-id'] ?? owner);
    const moduleReference = await Test.createTestingModule({
      controllers: [
        StrategiesController,
        BacktestsController,
        ExperimentsController,
      ],
      providers: [
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: AUTHENTICATED_USER_RESOLVER, useValue: auth },
        { provide: STRATEGY_APPLICATION, useValue: strategies },
        { provide: STRATEGY_REPOSITORY, useValue: strategies },
        { provide: BACKTEST_APPLICATION, useValue: runApplication },
        { provide: BACKTEST_RUN_REPOSITORY, useValue: runs },
        { provide: BACKTEST_ANALYTICS_STORE, useValue: analytics },
        { provide: EXPERIMENT_STORE, useValue: experiments },
        { provide: BACKTEST_COMMAND_GUARD, useValue: guard },
        StrategiesService,
        BacktestsService,
        ExperimentsService,
      ],
    }).compile();
    application = moduleReference.createNestApplication();
    application.setGlobalPrefix('api/v1');
    await application.init();
  });

  afterAll(async () => application.close());

  it('supports strategy CRUD, immutable revision, clone, restore and validation', async () => {
    const created = await api()
      .post('/api/v1/strategies')
      .send({ name: 'Momentum', definition: {} })
      .expect(201);
    const id = created.body.data.id as string;
    await api().get('/api/v1/strategies').expect(200);
    await api().get(`/api/v1/strategies/${id}`).expect(200);
    const revised = await api()
      .patch(`/api/v1/strategies/${id}`)
      .send({ expectedRevision: 1, name: 'Momentum v2' })
      .expect(200);
    expect(revised.body.data.currentRevision).toBe(2);
    const revisions = await api()
      .get(`/api/v1/strategies/${id}/revisions`)
      .expect(200);
    expect(revisions.body.data.items).toHaveLength(2);
    const clone = await api()
      .post(`/api/v1/strategies/${id}/clone`)
      .expect(201);
    expect(clone.body.data.id).not.toBe(id);
    await api().delete(`/api/v1/strategies/${id}`).expect(200);
    await api().post(`/api/v1/strategies/${id}/restore`).expect(200);
    const validation = await api()
      .post('/api/v1/strategies/validate')
      .send({ definition: {} })
      .expect(200);
    expect(validation.body.data.valid).toBe(false);
    expect(validation.body.data.errors.length).toBeGreaterThan(0);
  });

  it('enforces strategy ownership and IDOR', async () => {
    await api(other).get(`/api/v1/strategies/${strategyId}`).expect(403);
    await api(other).post(`/api/v1/strategies/${strategyId}/clone`).expect(403);
  });

  it('creates backtests with idempotent replay and conflicts on changed payload', async () => {
    const body = backtestBody();
    await api(other)
      .post('/api/v1/backtests')
      .set('Idempotency-Key', 'other-user-run-key')
      .send(body)
      .expect(403);
    const first = await api()
      .post('/api/v1/backtests')
      .set('Idempotency-Key', 'run-key')
      .send(body)
      .expect(201);
    const replay = await api()
      .post('/api/v1/backtests')
      .set('Idempotency-Key', 'run-key')
      .send(body)
      .expect(200);
    expect(replay.body.data.id).toBe(first.body.data.id);
    await api()
      .post('/api/v1/backtests')
      .set('Idempotency-Key', 'run-key')
      .send({ ...body, complexityScore: 11 })
      .expect(409);
  });

  it('returns run status and supports cooperative cancellation', async () => {
    await api().get(`/api/v1/backtests/${runId}`).expect(200);
    const cancelled = await api()
      .post(`/api/v1/backtests/${runId}/cancel`)
      .expect(200);
    expect(cancelled.body.data.status).toBe('cancelRequested');
  });

  it('enforces result ownership across every analytics resource', async () => {
    for (const suffix of [
      '',
      '/summary',
      '/series?type=equity',
      '/trades',
      '/orders',
      '/fills',
      '/methodology',
    ])
      await api(other).get(`/api/v1/backtests/${runId}${suffix}`).expect(403);
  });

  it('returns safe summary, methodology, bounded series, orders and fills', async () => {
    const summary = await api()
      .get(`/api/v1/backtests/${runId}/summary`)
      .expect(200);
    expect(summary.body.data).toMatchObject({
      metrics: {
        annualizedReturn: metricFixture('0.08'),
        annualizedVolatility: metricFixture('0.12'),
        sharpeRatio: metricFixture('0.66'),
        sortinoRatio: metricFixture('0.91'),
        calmarRatio: metricFixture('0.8'),
        expectancy: metricFixture('12.5'),
        benchmarkReturn: metricFixture('0.06'),
        excessReturn: metricFixture('0.02'),
        turnover: metricFixture('1.25'),
      },
      methodology: {
        engineVersion: 'engine-v1',
        metricPolicy: { version: 'backtest-metrics-v2' },
      },
      dataSnapshot: { hash: 'snapshot-068' },
    });
    expect(JSON.stringify(summary.body)).not.toMatch(/NaN|Infinity/u);
    expect(JSON.stringify(summary.body)).not.toContain('revisionManifest');
    await api().get(`/api/v1/backtests/${runId}/methodology`).expect(200);
    const series = await api()
      .get(`/api/v1/backtests/${runId}/series?type=equity&limit=2`)
      .expect(200);
    expect(series.body.data.items).toHaveLength(2);
    await api().get(`/api/v1/backtests/${runId}/orders`).expect(200);
    await api().get(`/api/v1/backtests/${runId}/fills`).expect(200);
  });

  it('uses a context-bound trade cursor without duplicate or missing trades', async () => {
    const first = await api()
      .get(`/api/v1/backtests/${runId}/trades?limit=2`)
      .expect(200);
    const second = await api()
      .get(
        `/api/v1/backtests/${runId}/trades?limit=2&cursor=${first.body.meta.nextCursor}`,
      )
      .expect(200);
    const ids = [...first.body.data.items, ...second.body.data.items].map(
      (item: { id: string }) => item.id,
    );
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    await api()
      .get(
        `/api/v1/backtests/${runId}/trades?limit=2&instrumentId=00000000-0000-4000-8000-000000006899&cursor=${first.body.meta.nextCursor}`,
      )
      .expect(400);
    await api()
      .get(
        `/api/v1/backtests/${secondRunId}/trades?cursor=${first.body.meta.nextCursor}`,
      )
      .expect(400);
    await api()
      .get(`/api/v1/backtests/${runId}/trades?cursor=not-a-cursor`)
      .expect(400);
    await api(other)
      .get(
        `/api/v1/backtests/${runId}/trades?cursor=${first.body.meta.nextCursor}`,
      )
      .expect(403);
  });

  it('creates, reads, cancels and aggregates experiments', async () => {
    const body = experimentBody();
    const created = await api()
      .post('/api/v1/experiments')
      .send(body)
      .expect(201);
    const id = created.body.data.id as string;
    await api().get('/api/v1/experiments').expect(200);
    await api().get(`/api/v1/experiments/${id}`).expect(200);
    await api().get(`/api/v1/experiments/${id}/results`).expect(200);
    await api().get(`/api/v1/experiments/${id}/matrix`).expect(200);
    await api().post(`/api/v1/experiments/${id}/cancel`).expect(200);
  });

  it('enforces experiment and export IDOR', async () => {
    await api(other).get(`/api/v1/experiments/${experimentId}`).expect(403);
    await api(other)
      .post(`/api/v1/experiments/${experimentId}/export`)
      .expect(403);
  });

  it('escapes spreadsheet formula injection in experiment export', async () => {
    const response = await api()
      .post(`/api/v1/experiments/${experimentId}/export`)
      .expect(200);
    expect(response.text).toContain("'=HYPERLINK");
    expect(response.text).not.toContain(',=HYPERLINK');
  });

  it('enforces complexity and export rate limits', async () => {
    await api()
      .post('/api/v1/backtests')
      .set('Idempotency-Key', 'complex')
      .send({ ...backtestBody(), complexityScore: 101 })
      .expect(429);
    for (let index = 0; index < 5; index += 1)
      await api()
        .post(`/api/v1/experiments/${experimentId}/export`)
        .expect(200);
    await api().post(`/api/v1/experiments/${experimentId}/export`).expect(429);
  });

  function api(user = owner) {
    const server = application.getHttpServer() as Server;
    return {
      get: (path: string) => request(server).get(path).set('x-user-id', user),
      post: (path: string) => request(server).post(path).set('x-user-id', user),
      patch: (path: string) =>
        request(server).patch(path).set('x-user-id', user),
      delete: (path: string) =>
        request(server).delete(path).set('x-user-id', user),
    };
  }
});

class MemoryRunRepository implements BacktestRunRepository {
  run: BacktestRunRecord | null = null;
  private key: string | null = null;
  findById = (id: string) =>
    Promise.resolve(
      this.run?.id === id
        ? this.run
        : id === runId || id === secondRunId
          ? fixtureRun(owner, id)
          : null,
    );
  findByIdempotency = (_userId: string, idempotencyKeyHash: string) =>
    Promise.resolve(this.key === idempotencyKeyHash ? this.run : null);
  createIdempotently(input: BacktestRunCreationInput) {
    if (this.run && this.key === input.idempotencyKeyHash)
      return Promise.resolve({ run: this.run, created: false });
    this.key = input.idempotencyKeyHash;
    this.run = {
      ...fixtureRun(input.requestedBy),
      requestHash: input.requestHash,
      idempotencyKeyHash: input.idempotencyKeyHash,
      executionPlan: input.executionPlan,
    };
    return Promise.resolve({ run: this.run, created: true });
  }
  listDispatchable = () => Promise.resolve(this.run ? [this.run] : []);
  requestCancellation = async (input: {
    runId: string;
    userId: string;
    requestedAt: string;
  }) => {
    const found = await this.findById(input.runId);
    if (!found || found.requestedBy !== input.userId)
      throw new BacktestRuntimeApplicationError('BACKTEST_RUN_ACCESS_DENIED');
    this.run = {
      ...found,
      status: 'cancelRequested',
      cancelRequestedAt: input.requestedAt,
    };
    return this.run;
  };
}

class FixtureAnalytics implements BacktestAnalyticsStore {
  readonly tradesData = Array.from({ length: 4 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(6_900 + index).padStart(12, '0')}`,
    tradeSequence: 4 - index,
    closedAt: new Date(`2025-01-0${4 - index}T15:00:00.000Z`),
    symbol: 'SAFE',
  }));
  listRuns = () =>
    Promise.resolve({ items: [fixtureRun(owner)], nextPosition: null });
  summary = () =>
    Promise.resolve({
      endingEquity: '1100',
      metrics: {
        annualizedReturn: metricFixture('0.08'),
        annualizedVolatility: metricFixture('0.12'),
        sharpeRatio: metricFixture('0.66'),
        sortinoRatio: metricFixture('0.91'),
        calmarRatio: metricFixture('0.8'),
        expectancy: metricFixture('12.5'),
        benchmarkReturn: metricFixture('0.06'),
        excessReturn: metricFixture('0.02'),
        turnover: metricFixture('1.25'),
      },
      methodology: {
        engineVersion: 'engine-v1',
        metricPolicy: { version: 'backtest-metrics-v2' },
      },
      dataSnapshot: { id: snapshotId, hash: 'snapshot-068', dataCutoffAt: now },
    });
  series = (input: Parameters<BacktestAnalyticsStore['series']>[0]) =>
    Promise.resolve(
      Array.from({ length: Math.min(input.maximumPoints, 3) }, (_, index) => ({
        timestamp: `2025-01-0${index + 1}T15:00:00.000Z`,
        value: String(1000 + index),
      })),
    );
  trades(input: Parameters<BacktestAnalyticsStore['trades']>[0]) {
    const start = input.cursor
      ? this.tradesData.findIndex((item) => item.id === input.cursor?.id) + 1
      : 0;
    const selected = this.tradesData.slice(start, start + input.limit);
    const hasNext = start + input.limit < this.tradesData.length;
    const last = selected.at(-1);
    return Promise.resolve({
      items: selected,
      nextPosition:
        hasNext && last
          ? {
              closedAt: last.closedAt,
              tradeSequence: last.tradeSequence,
              id: last.id,
            }
          : null,
    });
  }
  orders = () => Promise.resolve([{ id: 'order-1', requestedQuantity: '10' }]);
  fills = () => Promise.resolve([{ id: 'fill-1', quantity: '10' }]);
  methodology = () =>
    Promise.resolve({
      engineVersion: 'engine-v1',
      costPolicyVersion: 'cost-v1',
    });
}

class FixtureStrategies {
  private sequence = 6810;
  private readonly records = new Map<string, any>();
  constructor() {
    this.records.set(strategyId, strategyRecord(strategyId, owner));
  }
  listOwned = (userId: string) =>
    Promise.resolve(
      [...this.records.values()].filter((item) => item.ownerUserId === userId),
    );
  get(userId: string, id: string) {
    const item = this.records.get(id);
    if (!item)
      return Promise.reject(new StrategyDomainError('STRATEGY_NOT_FOUND'));
    if (item.ownerUserId !== userId)
      return Promise.reject(new StrategyDomainError('STRATEGY_ACCESS_DENIED'));
    return Promise.resolve(item);
  }
  create(input: { userId: string; name: string }) {
    const id = `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, '0')}`;
    const item = strategyRecord(id, input.userId, input.name);
    this.records.set(id, item);
    return Promise.resolve(item);
  }
  async revise(input: {
    userId: string;
    id: string;
    expectedRevision: number;
    name?: string;
  }) {
    const item = await this.get(input.userId, input.id);
    const revised = {
      ...item,
      name: input.name ?? item.name,
      currentRevision: item.currentRevision + 1,
      revision: { ...item.revision, revision: item.currentRevision + 1 },
    };
    this.records.set(input.id, revised);
    return revised;
  }
  async clone(userId: string, id: string) {
    const item = await this.get(userId, id);
    return this.create({ userId, name: `${item.name} (Copy)` });
  }
  async revisions(userId: string, id: string) {
    const item = await this.get(userId, id);
    return Array.from({ length: item.currentRevision }, (_, index) => ({
      ...item.revision,
      revision: item.currentRevision - index,
    }));
  }
  setDeleted = async (input: {
    id: string;
    userId: string;
    deleted: boolean;
  }) => {
    const item = await this.get(input.userId, input.id);
    const updated = {
      ...item,
      status: input.deleted ? 'deleted' : 'draft',
      deletedAt: input.deleted ? now : null,
    };
    this.records.set(input.id, updated);
    return updated;
  };
}

class FixtureExperiments implements ExperimentStore {
  private readonly records = new Map<string, ExperimentRecord>([
    [experimentId, experimentRecord(experimentId, owner)],
  ]);
  listOwned = (userId: string) =>
    Promise.resolve(
      [...this.records.values()].filter((item) => item.ownerUserId === userId),
    );
  findById = (id: string) => Promise.resolve(this.records.get(id) ?? null);
  create(input: Parameters<ExperimentStore['create']>[0]) {
    const item = experimentRecord(input.id, input.ownerUserId);
    this.records.set(item.id, item);
    return Promise.resolve(item);
  }
  cancel(id: string, userId: string) {
    const item = this.records.get(id);
    if (!item || item.ownerUserId !== userId) return Promise.resolve(null);
    const updated = { ...item, status: 'cancelRequested' };
    this.records.set(id, updated);
    return Promise.resolve(updated);
  }
  results = () =>
    Promise.resolve([{ runId, bindingHash: 'safe', status: 'completed' }]);
  matrix = () =>
    Promise.resolve([
      {
        bindingHash: '=HYPERLINK("bad")',
        sampleRole: 'train',
        parameterBinding: { period: 14 },
        selectedMetrics: { return: '10' },
        rank: 1,
      },
    ]);
}

class FixtureGuard implements BacktestCommandGuard {
  private exports = 0;
  consume(input: Parameters<BacktestCommandGuard['consume']>[0]) {
    if (input.complexity > 100)
      throw new Error('BACKTEST_COMPLEXITY_LIMIT_EXCEEDED');
    if (input.operation === 'export' && ++this.exports > 6)
      throw new Error('BACKTEST_RATE_LIMITED');
  }
}

function fixtureRun(userId: string, id = runId): BacktestRunRecord {
  return {
    id,
    requestedBy: userId,
    strategyId,
    strategyRevision: 1,
    status: 'queued',
    requestHash: 'request',
    idempotencyKeyHash: 'key',
    executionPlan: backtestBody().executionPlan as never,
    dataSnapshotId: snapshotId,
    dataSnapshotHash: 'snapshot-068',
    rangeFrom: '2025-01-01T00:00:00.000Z',
    rangeTo: '2025-01-31T00:00:00.000Z',
    complexityScore: 10,
    progressPercent: 0,
    queuedAt: now.toISOString(),
    startedAt: null,
    completedAt: null,
    cancelRequestedAt: null,
    errorCode: null,
  };
}
function strategyRecord(id: string, userId: string, name = 'Fixture') {
  return {
    id,
    ownerUserId: userId,
    name,
    description: null,
    visibility: 'private',
    status: 'draft',
    currentRevision: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    revision: {
      id: `${id}-r1`,
      strategyId: id,
      revision: 1,
      definition: {},
      status: 'draft',
      validation: { valid: true },
      createdBy: userId,
      createdAt: now,
    },
  };
}
function experimentRecord(id: string, userId: string): ExperimentRecord {
  return {
    id,
    ownerUserId: userId,
    strategyId,
    strategyRevision: 1,
    name: 'Experiment',
    status: 'running',
    definition: {},
    combinationCount: 1,
    completedRunCount: 0,
    failedRunCount: 0,
    warnings: [],
    createdAt: now,
    updatedAt: now,
  };
}
function backtestBody() {
  return {
    strategyId,
    strategyRevision: 1,
    executionPlan: {
      runId: 'assigned',
      strategyRevisionId: 'revision-1',
      dataSnapshotHash: 'snapshot-068',
      engineVersion: 'engine-v1',
      executionPolicyVersion: 'next-open-v1',
      eventOrderingPolicyVersion: 'ordering-v1',
      roundingPolicyVersion: 'round-v1',
      timeframe: '1d',
      initialCash: '1000',
      entryRule: {},
      exitRule: {},
      positionSizing: { type: 'fixedCash', amount: '100' },
      maxConcurrentPositions: 5,
      fractionalShares: false,
      allowShort: false,
      allowLeverage: false,
      liquidateAtEnd: true,
    },
    dataSnapshotHash: 'snapshot-068',
    rangeFrom: '2025-01-01T00:00:00.000Z',
    rangeTo: '2025-01-31T00:00:00.000Z',
    complexityScore: 10,
  };
}
function experimentBody() {
  return {
    name: 'Grid',
    strategyId,
    strategyRevision: 1,
    dataSnapshotId: snapshotId,
    dataSnapshotHash: 'snapshot-068',
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
        axes: [{ parameter: 'period', values: [10] }],
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
  };
}

function metricFixture(value: string) {
  return {
    value,
    status: 'complete',
    reasonCode: 'NONE',
    observationCount: 3,
    methodologyVersion: 'backtest-metrics-v2',
    warnings: [],
  };
}
