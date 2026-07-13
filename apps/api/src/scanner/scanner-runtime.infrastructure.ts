import { createHash } from 'node:crypto';

import {
  createDatabase,
  instruments,
  PostgresScanRunRepository,
  scanResults,
  scanRuns,
  type Database,
} from '@atlas/database';
import {
  createCoreIndicatorRegistry,
  ScanRunApplicationService,
  type ScanUniverseFilter,
} from '@atlas/domain';
import {
  ATLAS_JOB_NAMES,
  ATLAS_QUEUE_NAMES,
  type ScannerRunQueuePayload,
} from '@atlas/types';
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Queue, type ConnectionOptions } from 'bullmq';

import type {
  ScanResultCursor,
  ScanResultDirection,
  ScanResultPage,
  ScanResultSort,
  ScannerRunDispatcher,
  ScannerRuntimeReader,
  ScanRunStatusView,
} from './scanner-runtime.ports';

@Injectable()
export class ApiDatabase implements OnApplicationShutdown {
  readonly database: Database;
  private readonly pool: ReturnType<typeof createDatabase>['pool'];

  constructor(config: ConfigService) {
    const created = createDatabase(config.getOrThrow<string>('DATABASE_URL'));
    this.database = created.db;
    this.pool = created.pool;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Injectable()
export class PostgresScannerRuntimeReader implements ScannerRuntimeReader {
  constructor(private readonly connection: ApiDatabase) {}

  async status(runId: string): Promise<ScanRunStatusView | null> {
    const rows = await this.connection.database
      .select()
      .from(scanRuns)
      .where(eq(scanRuns.id, runId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      status: row.status as ScanRunStatusView['status'],
      executionMode: row.executionMode as ScanRunStatusView['executionMode'],
      planVersion: row.planVersion,
      ruleVersion: row.ruleVersion,
      dataCutoffAt: row.dataCutoffAt,
      queuedAt: row.queuedAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      cancelRequestedAt: row.cancelRequestedAt,
      cancelledAt: row.cancelledAt,
      timeoutAt: row.timeoutAt,
      updatedAt: row.updatedAt,
      progress: {
        total: row.progressTotal,
        processed: row.progressProcessed,
        matched: row.matchedCount,
        notEvaluable: row.notEvaluableCount,
        warnings: row.warningCount,
        phase: row.status,
        updatedAt: row.updatedAt,
      },
      errorCode: row.errorCode,
    };
  }

  async results(
    input: Parameters<ScannerRuntimeReader['results']>[0],
  ): Promise<ScanResultPage> {
    const orderColumn =
      input.sort === 'rank'
        ? sql`coalesce(${scanResults.rank}, 2147483647)`
        : sql`${scanResults.createdAt}`;
    const order = input.direction === 'asc' ? asc : desc;
    const conditions = [eq(scanResults.scanRunId, input.runId)];
    if (input.status !== undefined) {
      conditions.push(eq(scanResults.status, input.status));
    }
    if (input.cursor !== undefined) {
      conditions.push(
        cursorCondition(input.sort, input.direction, input.cursor),
      );
    }
    const rows = await this.connection.database
      .select()
      .from(scanResults)
      .where(and(...conditions))
      .orderBy(order(orderColumn), order(scanResults.id))
      .limit(input.limit + 1);
    const hasNext = rows.length > input.limit;
    const selected = hasNext ? rows.slice(0, input.limit) : rows;
    const last = selected.at(-1);
    return {
      items: selected.map((row) => ({
        id: row.id.toString(),
        instrumentId: row.instrumentId,
        rank: row.rank,
        status: row.status as 'matched' | 'not_evaluable',
        computedValues: row.computedValues,
        ...(input.includeExplanation ? { explanation: row.explanation } : {}),
        warnings: row.warnings,
        dataCutoffAt: row.dataCutoffAt,
        matchedAt: row.matchedAt,
        sourceBatchIndex: row.sourceBatchIndex,
        resultVersion: row.resultVersion,
        createdAt: row.createdAt,
      })),
      nextCursor:
        hasNext && last !== undefined
          ? {
              id: last.id.toString(),
              sortValue:
                input.sort === 'rank'
                  ? (last.rank ?? 2_147_483_647)
                  : last.createdAt.toISOString(),
            }
          : null,
    };
  }
}

@Injectable()
export class BullMqScannerRunDispatcher
  implements ScannerRunDispatcher, OnApplicationShutdown
{
  private queue: Queue<ScannerRunQueuePayload> | undefined;

  constructor(private readonly config: ConfigService) {}

  async dispatch(input: ScannerRunQueuePayload): Promise<void> {
    const queue = this.queue ?? this.createQueue();
    this.queue = queue;
    await queue.add(ATLAS_JOB_NAMES.scannerRun, input, {
      attempts: 5,
      backoff: { delay: 1_000, jitter: 0.5, type: 'exponential' },
      jobId: scannerJobId(input.runId),
      removeOnComplete: 100,
      removeOnFail: false,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
  }

  private createQueue(): Queue<ScannerRunQueuePayload> {
    return new Queue(ATLAS_QUEUE_NAMES.scanner, {
      connection: redisConnection(this.config.getOrThrow<string>('REDIS_URL')),
    });
  }
}

export function createScanRunApplication(
  connection: ApiDatabase,
): ScanRunApplicationService {
  return new ScanRunApplicationService({
    repository: new PostgresScanRunRepository(connection.database),
    universeResolver: {
      resolve: (filter) => resolveUniverse(connection.database, filter),
    },
    sourceAuthorization: {
      authorize: ({ source }) => Promise.resolve(source.type === 'ad_hoc'),
    },
    planner: {
      indicatorRegistry: createCoreIndicatorRegistry(),
      entitlement: { check: () => ({ allowed: true }) },
      limits: {
        maximumComplexityScore: 100_000,
        asynchronousComplexityThreshold: 10_000,
      },
    },
  });
}

async function resolveUniverse(database: Database, filter: ScanUniverseFilter) {
  if (filter.indexCodes.length > 0) {
    return { instrumentIds: [], filter, resolvedAt: new Date() };
  }
  const conditions = [eq(instruments.marketCode, filter.market)];
  if (filter.statuses.length > 0) {
    conditions.push(inArray(instruments.status, [...filter.statuses]));
  }
  if (filter.sectorIds.length > 0) {
    conditions.push(inArray(instruments.sectorId, [...filter.sectorIds]));
  }
  const rows = await database
    .select({ id: instruments.id })
    .from(instruments)
    .where(and(...conditions))
    .orderBy(instruments.id);
  return {
    instrumentIds: rows.map(({ id }) => id),
    filter,
    resolvedAt: new Date(),
  };
}

function cursorCondition(
  sort: ScanResultSort,
  direction: ScanResultDirection,
  cursor: ScanResultCursor,
) {
  const operation = direction === 'asc' ? sql`>` : sql`<`;
  const column =
    sort === 'rank'
      ? sql`coalesce(${scanResults.rank}, 2147483647)`
      : sql`${scanResults.createdAt}`;
  const value =
    sort === 'rank'
      ? Number(cursor.sortValue)
      : new Date(String(cursor.sortValue));
  return sql`(${column}, ${scanResults.id}) ${operation} (${value}, ${BigInt(cursor.id)})`;
}

function scannerJobId(runId: string): string {
  const digest = createHash('sha256').update(runId).digest('hex');
  return `scanner-run-${digest.slice(0, 32)}`;
}

function redisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    maxRetriesPerRequest: null,
    port: url.port === '' ? 6379 : Number(url.port),
    ...(url.username === ''
      ? {}
      : { username: decodeURIComponent(url.username) }),
    ...(url.password === ''
      ? {}
      : { password: decodeURIComponent(url.password) }),
    ...(url.pathname === '' || url.pathname === '/'
      ? {}
      : { db: Number(url.pathname.slice(1)) }),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
