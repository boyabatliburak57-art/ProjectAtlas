import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  createCoreIndicatorRegistry,
  ScanRunApplicationService,
  type IdempotentScanRunCreation,
  type NewScanRun,
  type ScanRun,
  type ScanRunRepository,
  type ScanRunTransition,
} from '@atlas/domain';

import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { IndicatorCatalogController } from '../indicators/indicator-catalog.controller';
import {
  INDICATOR_REGISTRY,
  IndicatorCatalogService,
} from '../indicators/indicator-catalog.service';
import { ScannerCatalogController } from '../scanner/scanner-catalog.controller';
import { ScannerCatalogService } from '../scanner/scanner-catalog.service';
import { ScannerRuntimeController } from '../scanner/scanner-runtime.controller';
import {
  SCANNER_RUN_DISPATCHER,
  SCANNER_RUNTIME_READER,
  SCAN_RUN_APPLICATION,
  type ScanResultPage,
  type ScannerRunDispatcher,
  type ScannerRuntimeReader,
  type ScanRunStatusView,
} from '../scanner/scanner-runtime.ports';
import { ScannerRuntimeService } from '../scanner/scanner-runtime.service';

const fixedNow = new Date('2026-07-14T12:00:00.000Z');
const ownerId = '00000000-0000-4000-8000-000000000901';

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
    const run: ScanRun = {
      id: randomUUID(),
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

class CompletedRuntimeReader implements ScannerRuntimeReader {
  constructor(private readonly repository: MemoryScanRunRepository) {}

  async status(runId: string): Promise<ScanRunStatusView | null> {
    const run = await this.repository.findById(runId);
    if (run === null) return null;
    const completed = run.status === 'completed';
    return {
      id: run.id,
      status: run.status,
      executionMode: run.executionMode,
      planVersion: run.planVersion,
      ruleVersion: run.ruleVersion,
      dataCutoffAt: run.dataCutoffAt,
      queuedAt: run.queuedAt,
      startedAt: completed ? fixedNow : null,
      completedAt: completed ? fixedNow : null,
      cancelRequestedAt: run.cancelRequestedAt,
      cancelledAt: run.cancelledAt,
      timeoutAt: null,
      updatedAt: fixedNow,
      progress: {
        total: 3,
        processed: completed ? 3 : 0,
        matched: completed ? 1 : 0,
        notEvaluable: 0,
        warnings: 0,
        phase: run.status,
        updatedAt: fixedNow,
        source: 'postgresql',
        stale: false,
        terminal: completed,
        pollAfterMs: completed ? null : 750,
      },
      errorCode: null,
    };
  }

  results(): Promise<ScanResultPage> {
    return Promise.resolve({
      items: [
        {
          id: '1',
          instrumentId: '00000000-0000-4000-8000-000000000961',
          rank: 1,
          status: 'matched',
          computedValues: {
            symbol: 'E2E',
            companyName: 'Round-trip Fixture',
            lastPrice: 100,
          },
          explanation: { roundTrip: true },
          warnings: [],
          dataCutoffAt: fixedNow,
          matchedAt: fixedNow,
          sourceBatchIndex: 0,
          resultVersion: 1,
          createdAt: fixedNow,
        },
      ],
      nextCursor: null,
    });
  }
}

const repository = new MemoryScanRunRepository();
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
const dispatcher: ScannerRunDispatcher = {
  async dispatch({ runId }) {
    await commands.transitionStatus(runId, 'running');
    await commands.transitionStatus(runId, 'completed');
  },
};
const authenticatedUser: AuthenticatedUserResolver = () => ownerId;

@Module({
  controllers: [
    IndicatorCatalogController,
    ScannerCatalogController,
    ScannerRuntimeController,
  ],
  providers: [
    IndicatorCatalogService,
    ScannerCatalogService,
    ScannerRuntimeService,
    {
      provide: INDICATOR_REGISTRY,
      useValue: createCoreIndicatorRegistry(),
    },
    { provide: AUTHENTICATED_USER_RESOLVER, useValue: authenticatedUser },
    { provide: SCAN_RUN_APPLICATION, useValue: commands },
    {
      provide: SCANNER_RUNTIME_READER,
      useValue: new CompletedRuntimeReader(repository),
    },
    { provide: SCANNER_RUN_DISPATCHER, useValue: dispatcher },
  ],
})
class ScannerE2eModule {}

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(ScannerE2eModule, {
    abortOnError: false,
    logger: false,
  });
  application.enableCors({ origin: 'http://127.0.0.1:3100' });
  application.setGlobalPrefix('api/v1');
  await application.listen(3001, '127.0.0.1');
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
