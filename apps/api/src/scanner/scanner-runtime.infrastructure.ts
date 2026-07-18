import { createHash } from 'node:crypto';

import {
  createDatabase,
  instruments,
  PostgresScanRunRepository,
  presetScanRevisions,
  presetScans,
  savedScans,
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
import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Queue, type ConnectionOptions } from 'bullmq';

import type {
  ScanResultCursor,
  ScanResultDirection,
  ScanResultPage,
  ScanResultSort,
  ScannerRunDispatcher,
  ScannerProgressFastReader,
  ScannerRuntimeReader,
  ScanRunStatusView,
} from './scanner-runtime.ports';
import { FallbackScannerRuntimeReader } from './scanner-progress';

@Injectable()
export class ApiDatabase implements OnApplicationShutdown {
  readonly database: Database;
  private readonly pool: ReturnType<typeof createDatabase>['pool'];

  constructor(@Inject(ConfigService) config: ConfigService) {
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

@Injectable()
export class BullMqScannerProgressReader
  implements ScannerProgressFastReader, OnApplicationShutdown
{
  private queue: Queue<ScannerRunQueuePayload> | undefined;

  constructor(private readonly config: ConfigService) {}

  async read(runId: string) {
    const queue = this.queue ?? this.createQueue();
    this.queue = queue;
    const job = await queue.getJob(scannerJobId(runId));
    return parseFastProgress(job?.progress);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
  }

  private createQueue(): Queue<ScannerRunQueuePayload> {
    return new Queue(ATLAS_QUEUE_NAMES.scanner, {
      connection: redisProgressConnection(
        this.config.getOrThrow<string>('REDIS_URL'),
      ),
    });
  }
}

export function createFallbackScannerRuntimeReader(
  durable: PostgresScannerRuntimeReader,
  fast: ScannerProgressFastReader,
  config: ConfigService,
): ScannerRuntimeReader {
  return new FallbackScannerRuntimeReader(durable, fast, {
    staleAfterMs: config.getOrThrow<number>('SCANNER_PROGRESS_STALE_AFTER_MS'),
    pollAfterMs: config.getOrThrow<number>('SCANNER_PROGRESS_POLL_AFTER_MS'),
  });
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
      authorize: async ({ userId, source }) => {
        if (source.type === 'ad_hoc') return true;
        if (source.type === 'preset_scan' && source.id !== undefined) {
          const rows = await connection.database
            .select({ revision: presetScanRevisions.revision })
            .from(presetScans)
            .innerJoin(
              presetScanRevisions,
              and(
                eq(presetScanRevisions.presetScanId, presetScans.id),
                eq(presetScanRevisions.revision, presetScans.currentRevision),
              ),
            )
            .where(
              and(
                eq(presetScans.id, source.id),
                eq(presetScans.status, 'published'),
                eq(presetScanRevisions.lifecycleStatus, 'published'),
              ),
            )
            .limit(1);
          return rows[0]?.revision === source.revision;
        }
        if (source.type !== 'saved_scan' || source.id === undefined)
          return false;
        const rows = await connection.database
          .select({
            ownerUserId: savedScans.ownerUserId,
            status: savedScans.status,
            currentRevision: savedScans.currentRevision,
          })
          .from(savedScans)
          .where(eq(savedScans.id, source.id))
          .limit(1);
        const scan = rows[0];
        if (scan === undefined || scan.ownerUserId !== userId) return false;
        if (scan.status === 'deleted') {
          return { allowed: false, errorCode: 'SAVED_SCAN_DELETED' };
        }
        return source.revision === scan.currentRevision;
      },
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

function redisProgressConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: url.port === '' ? 6379 : Number(url.port),
    connectTimeout: 500,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
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

function parseFastProgress(value: unknown) {
  if (!isRecord(value)) return null;
  const updatedAt =
    typeof value.updatedAt === 'string' ? new Date(value.updatedAt) : null;
  if (
    !Number.isInteger(value.total) ||
    !Number.isInteger(value.processed) ||
    !Number.isInteger(value.matched) ||
    !Number.isInteger(value.notEvaluable) ||
    !Number.isInteger(value.warnings) ||
    typeof value.phase !== 'string' ||
    !['loading', 'evaluating', 'persisting', 'completed'].includes(
      value.phase,
    ) ||
    updatedAt === null ||
    !Number.isFinite(updatedAt.getTime())
  ) {
    return null;
  }
  return {
    total: value.total as number,
    processed: value.processed as number,
    matched: value.matched as number,
    notEvaluable: value.notEvaluable as number,
    warnings: value.warnings as number,
    phase: value.phase,
    updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
