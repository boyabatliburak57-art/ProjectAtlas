import type { Server } from 'node:http';

import { UnauthorizedException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  createCoreIndicatorRegistry,
  ScanRunApplicationService,
  type IdempotentScanRunCreation,
  type NewScanRun,
  type ScanRun,
  type ScanRunRepository,
  type ScanRunTransition,
} from '@atlas/domain';
import type { Request } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { configureApplication } from '../bootstrap/configure-application';
import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import {
  SCANNER_RUN_DISPATCHER,
  SCANNER_RUNTIME_READER,
  SCAN_RUN_APPLICATION,
  type ScanResultPage,
  type ScannerRunDispatcher,
  type ScannerRuntimeReader,
  type ScanRunStatusView,
} from './scanner-runtime.ports';

const ownerId = '00000000-0000-4000-8000-000000000901';
const otherId = '00000000-0000-4000-8000-000000000902';
const fixedNow = new Date('2026-07-13T14:00:00.000Z');
let runSequence = 950;

class MemoryScanRunRepository implements ScanRunRepository {
  readonly runs = new Map<string, ScanRun>();

  findById(id: string): Promise<ScanRun | null> {
    return Promise.resolve(this.runs.get(id) ?? null);
  }

  findByIdempotency(
    requestedBy: string,
    idempotencyKeyHash: string,
  ): Promise<ScanRun | null> {
    return Promise.resolve(
      [...this.runs.values()].find(
        (run) =>
          run.requestedBy === requestedBy &&
          run.idempotencyKeyHash === idempotencyKeyHash,
      ) ?? null,
    );
  }

  async createIdempotently(
    input: NewScanRun,
  ): Promise<IdempotentScanRunCreation> {
    const existing = await this.findByIdempotency(
      input.requestedBy,
      input.idempotencyKeyHash,
    );
    if (existing !== null) return { run: existing, created: false };
    runSequence += 1;
    const run: ScanRun = {
      id: `00000000-0000-4000-8000-${String(runSequence).padStart(12, '0')}`,
      source: input.source,
      requestedBy: input.requestedBy,
      idempotencyKeyHash: input.idempotencyKeyHash,
      requestHash: input.requestHash,
      status: 'queued',
      executionMode: input.executionPlan.executionMode,
      planVersion: input.executionPlan.planVersion,
      ruleVersion: input.executionPlan.normalizedRule.version,
      normalizedRule: input.executionPlan.normalizedRule,
      executionPlan: input.executionPlan,
      universeSnapshot: input.universeSnapshot,
      complexityScore: input.executionPlan.complexity.score,
      dataCutoffAt: input.dataCutoffAt,
      queuedAt: input.dataCutoffAt,
      cancelRequestedAt: null,
      cancelledAt: null,
    };
    this.runs.set(run.id, run);
    return { run, created: true };
  }

  transition(input: ScanRunTransition): Promise<ScanRun | null> {
    const run = this.runs.get(input.runId);
    if (run === undefined || run.status !== input.fromStatus) {
      return Promise.resolve(null);
    }
    const updated: ScanRun = {
      ...run,
      status: input.toStatus,
      cancelRequestedAt:
        input.toStatus === 'cancel_requested'
          ? input.occurredAt
          : run.cancelRequestedAt,
      cancelledAt:
        input.toStatus === 'cancelled' ? input.occurredAt : run.cancelledAt,
    };
    this.runs.set(run.id, updated);
    return Promise.resolve(updated);
  }
}

class MemoryRuntimeReader implements ScannerRuntimeReader {
  constructor(private readonly repository: MemoryScanRunRepository) {}

  async status(runId: string): Promise<ScanRunStatusView | null> {
    const run = await this.repository.findById(runId);
    if (run === null) return null;
    return {
      id: run.id,
      status: run.status,
      executionMode: run.executionMode,
      planVersion: run.planVersion,
      ruleVersion: run.ruleVersion,
      dataCutoffAt: run.dataCutoffAt,
      queuedAt: run.queuedAt,
      startedAt: run.status === 'queued' ? null : fixedNow,
      completedAt: run.status === 'completed' ? fixedNow : null,
      cancelRequestedAt: run.cancelRequestedAt,
      cancelledAt: run.cancelledAt,
      timeoutAt: null,
      updatedAt: fixedNow,
      progress: {
        total: run.universeSnapshot.instrumentIds.length,
        processed: run.status === 'completed' ? 3 : 0,
        matched: run.status === 'completed' ? 2 : 0,
        notEvaluable: 0,
        warnings: 0,
        phase: run.status,
        updatedAt: fixedNow,
      },
      errorCode: null,
    };
  }

  results(
    input: Parameters<ScannerRuntimeReader['results']>[0],
  ): Promise<ScanResultPage> {
    const all = [1, 2, 3].map((id) => ({
      id: String(id),
      instrumentId: `00000000-0000-4000-8000-${String(960 + id).padStart(12, '0')}`,
      rank: id,
      status: 'matched' as const,
      computedValues: { score: 100 - id },
      ...(input.includeExplanation
        ? { explanation: { version: 1, status: 'matched' } }
        : {}),
      warnings: [],
      dataCutoffAt: fixedNow,
      matchedAt: fixedNow,
      sourceBatchIndex: 0,
      resultVersion: 1,
      createdAt: new Date(fixedNow.getTime() + id),
    }));
    const ordered = input.direction === 'asc' ? all : [...all].reverse();
    const cursorIndex =
      input.cursor === undefined
        ? 0
        : Math.max(
            0,
            ordered.findIndex(({ id }) => id === input.cursor?.id) + 1,
          );
    const selected = ordered.slice(cursorIndex, cursorIndex + input.limit);
    const hasNext = cursorIndex + input.limit < ordered.length;
    const last = selected.at(-1);
    return Promise.resolve({
      items: selected,
      nextCursor:
        hasNext && last !== undefined
          ? {
              id: last.id,
              sortValue:
                input.sort === 'rank'
                  ? last.rank
                  : last.createdAt.toISOString(),
            }
          : null,
    });
  }
}

class MemoryDispatcher implements ScannerRunDispatcher {
  readonly dispatched: string[] = [];

  dispatch(input: { readonly runId: string }): Promise<void> {
    this.dispatched.push(input.runId);
    return Promise.resolve();
  }
}

function scanRule(limit = 10) {
  return {
    version: 1,
    universe: {
      market: 'BIST',
      statuses: ['active'],
      indexCodes: [],
      sectorIds: [],
    },
    root: {
      type: 'group',
      nodeId: 'root',
      operator: 'AND',
      children: [
        {
          type: 'condition',
          nodeId: 'price',
          operator: 'GT',
          left: { type: 'priceField', field: 'close', timeframe: '1d' },
          right: { type: 'constantNumber', value: limit },
        },
      ],
    },
  };
}

function server(application: INestApplication): Server {
  return application.getHttpServer() as Server;
}

describe('Scanner Runtime API', () => {
  const repository = new MemoryScanRunRepository();
  const reader = new MemoryRuntimeReader(repository);
  const dispatcher = new MemoryDispatcher();
  const commands = new ScanRunApplicationService({
    repository,
    universeResolver: {
      resolve: (filter) =>
        Promise.resolve({
          instrumentIds: [
            '00000000-0000-4000-8000-000000000961',
            '00000000-0000-4000-8000-000000000962',
            '00000000-0000-4000-8000-000000000963',
          ],
          filter,
          resolvedAt: fixedNow,
        }),
    },
    sourceAuthorization: { authorize: () => Promise.resolve(true) },
    planner: {
      indicatorRegistry: createCoreIndicatorRegistry(),
      entitlement: { check: () => ({ allowed: true }) },
      limits: {
        maximumComplexityScore: 100_000,
        asynchronousComplexityThreshold: 10_000,
      },
    },
    now: () => new Date(fixedNow),
  });
  const testUserResolver: AuthenticatedUserResolver = (
    httpRequest: Request,
  ) => {
    const userId = httpRequest.get('x-test-user-id');
    if (userId === undefined) {
      throw new UnauthorizedException({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required',
      });
    }
    return userId;
  };
  let application: INestApplication;
  let runId: string;

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AUTHENTICATED_USER_RESOLVER)
      .useValue(testUserResolver)
      .overrideProvider(SCAN_RUN_APPLICATION)
      .useValue(commands)
      .overrideProvider(SCANNER_RUNTIME_READER)
      .useValue(reader)
      .overrideProvider(SCANNER_RUN_DISPATCHER)
      .useValue(dispatcher)
      .compile();
    application = moduleReference.createNestApplication();
    configureApplication(application);
    await application.init();
  });

  afterAll(async () => application.close());

  it('creates, replays and rejects conflicting idempotency requests', async () => {
    const first = await request(server(application))
      .post('/api/v1/scanner/runs')
      .set('x-test-user-id', ownerId)
      .set('Idempotency-Key', 'api-idempotency-key')
      .send({ rule: scanRule() })
      .expect(201);
    runId = (first.body as { data: { id: string } }).data.id;
    expect(first.body).toMatchObject({
      data: { id: runId, status: 'queued' },
      meta: { replayed: false },
    });

    const replay = await request(server(application))
      .post('/api/v1/scanner/runs')
      .set('x-test-user-id', ownerId)
      .set('Idempotency-Key', 'api-idempotency-key')
      .send({ rule: scanRule() })
      .expect(200);
    expect(replay.body).toMatchObject({
      data: { id: runId },
      meta: { replayed: true },
    });

    const conflict = await request(server(application))
      .post('/api/v1/scanner/runs')
      .set('x-test-user-id', ownerId)
      .set('Idempotency-Key', 'api-idempotency-key')
      .send({ rule: scanRule(11) })
      .expect(409);
    expect(conflict.body).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(dispatcher.dispatched).toEqual([runId, runId]);
  });

  it('validates authentication, idempotency key and rule input', async () => {
    await request(server(application))
      .post('/api/v1/scanner/runs')
      .set('Idempotency-Key', 'unauthenticated')
      .send({ rule: scanRule() })
      .expect(401);
    const missingKey = await request(server(application))
      .post('/api/v1/scanner/runs')
      .set('x-test-user-id', ownerId)
      .send({ rule: scanRule() })
      .expect(400);
    const invalidRule = await request(server(application))
      .post('/api/v1/scanner/runs')
      .set('x-test-user-id', ownerId)
      .set('Idempotency-Key', 'invalid-rule')
      .send({ rule: {} })
      .expect(422);
    expect(missingKey.body).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    });
    expect(invalidRule.body).toMatchObject({
      error: { code: 'SCAN_RULE_INVALID' },
    });
  });

  it('enforces owner-only status and IDOR protection', async () => {
    const owned = await request(server(application))
      .get(`/api/v1/scanner/runs/${runId}`)
      .set('x-test-user-id', ownerId)
      .expect(200);
    expect(owned.body).toMatchObject({ data: { id: runId, status: 'queued' } });

    const denied = await request(server(application))
      .get(`/api/v1/scanner/runs/${runId}`)
      .set('x-test-user-id', otherId)
      .expect(403);
    expect(denied.body).toMatchObject({
      error: { code: 'SCAN_RUN_ACCESS_DENIED' },
    });
  });

  it('paginates results with opaque cursors and lazy explanations', async () => {
    const first = await request(server(application))
      .get(`/api/v1/scanner/runs/${runId}/results?limit=2&direction=asc`)
      .set('x-test-user-id', ownerId)
      .expect(200);
    const firstBody = first.body as {
      data: { items: ReadonlyArray<Record<string, unknown>> };
      meta: { nextCursor: string | null };
    };
    expect(firstBody.data.items).toHaveLength(2);
    expect(firstBody.data.items[0]).not.toHaveProperty('explanation');
    expect(firstBody.meta.nextCursor).toEqual(expect.any(String));

    const second = await request(server(application))
      .get(
        `/api/v1/scanner/runs/${runId}/results?limit=2&direction=asc&includeExplanation=true&cursor=${String(firstBody.meta.nextCursor)}`,
      )
      .set('x-test-user-id', ownerId)
      .expect(200);
    expect(second.body).toMatchObject({
      data: { items: [{ id: '3', explanation: { version: 1 } }] },
      meta: { nextCursor: null },
    });

    const invalid = await request(server(application))
      .get(`/api/v1/scanner/runs/${runId}/results?cursor=not-a-cursor`)
      .set('x-test-user-id', ownerId)
      .expect(400);
    expect(invalid.body).toMatchObject({
      error: { code: 'SCAN_RESULTS_CURSOR_INVALID' },
    });

    await request(server(application))
      .get(`/api/v1/scanner/runs/${runId}/results`)
      .set('x-test-user-id', otherId)
      .expect(403);
  });

  it('cancels idempotently and rejects terminal cancellation', async () => {
    await request(server(application))
      .post(`/api/v1/scanner/runs/${runId}/cancel`)
      .set('x-test-user-id', otherId)
      .expect(403);
    const first = await request(server(application))
      .post(`/api/v1/scanner/runs/${runId}/cancel`)
      .set('x-test-user-id', ownerId)
      .expect(200);
    const replay = await request(server(application))
      .post(`/api/v1/scanner/runs/${runId}/cancel`)
      .set('x-test-user-id', ownerId)
      .expect(200);
    expect(first.body).toMatchObject({ data: { status: 'cancelRequested' } });
    expect(replay.body).toMatchObject({ data: { status: 'cancelRequested' } });

    const run = repository.runs.get(runId);
    if (run === undefined) throw new Error('test run invariant');
    repository.runs.set(runId, { ...run, status: 'completed' });
    const terminalStatus = await request(server(application))
      .get(`/api/v1/scanner/runs/${runId}`)
      .set('x-test-user-id', ownerId)
      .expect(200);
    expect(terminalStatus.body).toMatchObject({
      data: {
        status: 'completed',
        progress: { processed: 3, percent: 100 },
      },
    });
    const terminal = await request(server(application))
      .post(`/api/v1/scanner/runs/${runId}/cancel`)
      .set('x-test-user-id', ownerId)
      .expect(409);
    expect(terminal.body).toMatchObject({
      error: { code: 'SCAN_RUN_NOT_CANCELLABLE' },
    });
  });
});
