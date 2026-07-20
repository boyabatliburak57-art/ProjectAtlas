import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BacktestRuntimeApplicationError,
  buildCsv,
  generateExperimentCombinations,
  StrategyDomainError,
  validateStrategyDefinition,
  type BacktestExecutionPlan,
  type BacktestRunApplicationService,
  type StrategyApplicationService,
} from '@atlas/domain';
import { z } from 'zod';

import type {
  BacktestCreateDto,
  ExperimentCreateDto,
  ListQueryDto,
  SeriesQueryDto,
  StrategyCreateDto,
  StrategyUpdateDto,
  TradesQueryDto,
} from './backtests.dto';
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
  type StrategyApiRepository,
} from './backtests.ports';

export const STRATEGY_APPLICATION = Symbol('STRATEGY_APPLICATION');
export const BACKTEST_APPLICATION = Symbol('BACKTEST_APPLICATION');

const uuid = z.uuid();
const key = z.string().trim().min(1).max(200);
const strategyCreate = z
  .object({
    name: z.string(),
    description: z.string().nullable().optional(),
    definition: z.unknown(),
    status: z.enum(['draft', 'validated']).optional(),
  })
  .strict();
const strategyUpdate = strategyCreate
  .partial()
  .extend({
    expectedRevision: z.number().int().min(1),
  })
  .strict();
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(2048).optional(),
  status: z
    .enum([
      'queued',
      'resolvingData',
      'running',
      'calculatingMetrics',
      'completed',
      'failed',
      'cancelRequested',
      'cancelled',
      'expired',
    ])
    .optional(),
});
const backtestCreate = z
  .object({
    strategyId: z.uuid(),
    strategyRevision: z.number().int().min(1),
    executionPlan: z.record(z.string(), z.unknown()),
    dataSnapshotHash: z.string().trim().min(1).max(128),
    rangeFrom: z.iso.datetime({ offset: true }),
    rangeTo: z.iso.datetime({ offset: true }),
    complexityScore: z.number().int().min(0).max(1_000_000),
  })
  .strict();
const runCursor = z.object({
  version: z.literal(1),
  contextHash: z.string().length(64),
  updatedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});
const tradeQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2048).optional(),
  instrumentId: z.uuid().optional(),
  sort: z.literal('closedAt:desc').default('closedAt:desc'),
});
const tradeCursor = z.object({
  version: z.literal(1),
  contextHash: z.string().length(64),
  closedAt: z.iso.datetime({ offset: true }),
  tradeSequence: z.number().int().min(0),
  id: z.uuid(),
});
const seriesQuery = z.object({
  type: z.enum(['equity', 'drawdown', 'cash', 'exposure', 'benchmark']),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
  resolution: z.enum(['raw', 'daily', 'weekly']).default('raw'),
});
const experimentCreate = z
  .object({
    name: z.string().trim().min(1).max(160),
    strategyId: z.uuid(),
    strategyRevision: z.number().int().min(1),
    dataSnapshotId: z.uuid(),
    dataSnapshotHash: z.string().min(1).max(128),
    definition: z.record(z.string(), z.unknown()),
  })
  .strict();

@Injectable()
export class StrategiesService {
  constructor(
    @Inject(STRATEGY_APPLICATION)
    private readonly strategies: StrategyApplicationService,
    @Inject(STRATEGY_REPOSITORY)
    private readonly repository: StrategyApiRepository,
  ) {}

  list(userId: string, includeDeleted: string | undefined) {
    return this.repository.listOwned(userId, includeDeleted === 'true');
  }

  get(userId: string, rawId: string) {
    return this.execute(() => this.strategies.get(userId, identifier(rawId)));
  }

  create(userId: string, body: StrategyCreateDto) {
    const value = parse(strategyCreate, body, 'STRATEGY_REQUEST_INVALID');
    return this.execute(() =>
      this.strategies.create({
        userId,
        name: value.name,
        description: value.description,
        definition: value.definition,
        status: value.status,
      }),
    );
  }

  update(userId: string, rawId: string, body: StrategyUpdateDto) {
    const value = parse(strategyUpdate, body, 'STRATEGY_REQUEST_INVALID');
    return this.execute(() =>
      this.strategies.revise({
        userId,
        id: identifier(rawId),
        expectedRevision: value.expectedRevision,
        name: value.name,
        description: value.description,
        definition: value.definition,
        status: value.status,
      }),
    );
  }

  async remove(userId: string, rawId: string) {
    const id = identifier(rawId);
    await this.get(userId, id);
    const result = await this.repository.setDeleted({
      id,
      userId,
      deleted: true,
      now: new Date(),
    });
    if (!result) throw strategyNotFound();
    return result;
  }

  async restore(userId: string, rawId: string) {
    const id = identifier(rawId);
    await this.get(userId, id);
    const result = await this.repository.setDeleted({
      id,
      userId,
      deleted: false,
      now: new Date(),
    });
    if (!result) throw strategyNotFound();
    return result;
  }

  clone(userId: string, rawId: string) {
    return this.execute(() => this.strategies.clone(userId, identifier(rawId)));
  }

  revisions(userId: string, rawId: string) {
    return this.execute(() =>
      this.strategies.revisions(userId, identifier(rawId)),
    );
  }

  validate(definition: unknown) {
    return validateStrategyDefinition(definition);
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof StrategyDomainError) throw mapStrategyError(error);
      throw error;
    }
  }
}

@Injectable()
export class BacktestsService {
  constructor(
    @Inject(BACKTEST_APPLICATION)
    private readonly runs: BacktestRunApplicationService,
    @Inject(STRATEGY_APPLICATION)
    private readonly strategies: StrategyApplicationService,
    @Inject(BACKTEST_RUN_REPOSITORY)
    private readonly repository: import('@atlas/domain').BacktestRunRepository,
    @Inject(BACKTEST_ANALYTICS_STORE)
    private readonly analytics: BacktestAnalyticsStore,
    @Inject(BACKTEST_COMMAND_GUARD)
    private readonly guard: BacktestCommandGuard,
  ) {}

  async create(
    userId: string,
    rawKey: string | undefined,
    body: BacktestCreateDto,
  ) {
    const idempotencyKey = requiredKey(rawKey);
    const value = parse(backtestCreate, body, 'BACKTEST_REQUEST_INVALID');
    if (Date.parse(value.rangeTo) < Date.parse(value.rangeFrom))
      throw invalid('BACKTEST_RANGE_INVALID');
    await this.requireStrategyRevision(
      userId,
      value.strategyId,
      value.strategyRevision,
    );
    this.consume(userId, 'run', value.complexityScore);
    try {
      return await this.runs.create({
        userId,
        idempotencyKey,
        strategyId: value.strategyId,
        strategyRevision: value.strategyRevision,
        executionPlan: value.executionPlan as unknown as BacktestExecutionPlan,
        dataSnapshotHash: value.dataSnapshotHash,
        rangeFrom: value.rangeFrom,
        rangeTo: value.rangeTo,
        complexityScore: value.complexityScore,
      });
    } catch (error) {
      if (error instanceof BacktestRuntimeApplicationError)
        throw mapBacktestError(error);
      throw error;
    }
  }

  async list(userId: string, query: ListQueryDto) {
    const value = parse(listQuery, query, 'BACKTEST_REQUEST_INVALID');
    const contextHash = hash({
      version: 1,
      userId,
      status: value.status ?? null,
      sort: 'updatedAt:desc,id:asc',
    });
    const cursor = value.cursor
      ? decode(value.cursor, runCursor, contextHash, 'BACKTEST_CURSOR_INVALID')
      : null;
    const page = await this.analytics.listRuns({
      userId,
      limit: value.limit,
      status: value.status,
      cursor: cursor
        ? { updatedAt: new Date(cursor.updatedAt), id: cursor.id }
        : null,
    });
    return {
      items: page.items.map(publicValue),
      nextCursor: page.nextPosition
        ? encode({
            version: 1,
            contextHash,
            updatedAt: page.nextPosition.updatedAt.toISOString(),
            id: page.nextPosition.id,
          })
        : null,
    };
  }

  get(userId: string, rawId: string) {
    return this.owned(userId, identifier(rawId));
  }

  async cancel(userId: string, rawId: string) {
    try {
      return await this.runs.requestCancellation(identifier(rawId), userId);
    } catch (error) {
      if (error instanceof BacktestRuntimeApplicationError)
        throw mapBacktestError(error);
      throw error;
    }
  }

  async summary(userId: string, rawId: string) {
    const id = await this.ownedId(userId, rawId);
    return publicValue(
      (await this.analytics.summary(id)) ??
        notFound('BACKTEST_SUMMARY_NOT_FOUND'),
    );
  }
  async methodology(userId: string, rawId: string) {
    const id = await this.ownedId(userId, rawId);
    return publicValue(
      (await this.analytics.methodology(id)) ??
        notFound('BACKTEST_METHODOLOGY_NOT_FOUND'),
    );
  }

  async series(userId: string, rawId: string, query: SeriesQueryDto) {
    const id = await this.ownedId(userId, rawId);
    const value = parse(seriesQuery, query, 'BACKTEST_SERIES_INVALID');
    if (value.from && value.to && Date.parse(value.to) < Date.parse(value.from))
      throw invalid('BACKTEST_SERIES_RANGE_INVALID');
    const points = await this.analytics.series({
      runId: id,
      type: value.type,
      from: value.from ? new Date(value.from) : null,
      to: value.to ? new Date(value.to) : null,
      maximumPoints: value.limit,
    });
    return downsample(points, value.resolution);
  }

  async trades(userId: string, rawId: string, query: TradesQueryDto) {
    const id = await this.ownedId(userId, rawId);
    const value = parse(tradeQuery, query, 'BACKTEST_TRADES_INVALID');
    const contextHash = hash({
      version: 1,
      userId,
      runId: id,
      filters: { instrumentId: value.instrumentId ?? null },
      sort: value.sort,
    });
    const cursor = value.cursor
      ? decode(
          value.cursor,
          tradeCursor,
          contextHash,
          'BACKTEST_CURSOR_INVALID',
        )
      : null;
    const page = await this.analytics.trades({
      runId: id,
      limit: value.limit,
      instrumentId: value.instrumentId ?? null,
      cursor: cursor
        ? {
            closedAt: new Date(cursor.closedAt),
            tradeSequence: cursor.tradeSequence,
            id: cursor.id,
          }
        : null,
    });
    return {
      items: page.items.map(publicValue),
      nextCursor: page.nextPosition
        ? encode({
            version: 1,
            contextHash,
            closedAt: page.nextPosition.closedAt.toISOString(),
            tradeSequence: page.nextPosition.tradeSequence,
            id: page.nextPosition.id,
          })
        : null,
    };
  }

  async orders(userId: string, rawId: string, query: ListQueryDto) {
    const id = await this.ownedId(userId, rawId);
    const limit = parse(listQuery, query, 'BACKTEST_REQUEST_INVALID').limit;
    return (await this.analytics.orders(id, limit)).map(publicValue);
  }
  async fills(userId: string, rawId: string, query: ListQueryDto) {
    const id = await this.ownedId(userId, rawId);
    const limit = parse(listQuery, query, 'BACKTEST_REQUEST_INVALID').limit;
    return (await this.analytics.fills(id, limit)).map(publicValue);
  }

  private async owned(userId: string, id: string) {
    const run = await this.repository.findById(id);
    if (!run) notFound('BACKTEST_RUN_NOT_FOUND');
    if (run.requestedBy !== userId)
      throw forbidden('BACKTEST_RUN_ACCESS_DENIED');
    return publicValue(run);
  }
  private async ownedId(userId: string, rawId: string) {
    const id = identifier(rawId);
    await this.owned(userId, id);
    return id;
  }
  private async requireStrategyRevision(
    userId: string,
    strategyId: string,
    revision: number,
  ) {
    try {
      await this.strategies.get(userId, strategyId);
      const revisions = await this.strategies.revisions(userId, strategyId);
      if (!revisions.some((item) => item.revision === revision))
        throw new NotFoundException({
          code: 'STRATEGY_REVISION_NOT_FOUND',
          message: 'Strategy revision was not found',
        });
    } catch (error) {
      if (error instanceof StrategyDomainError) throw mapStrategyError(error);
      throw error;
    }
  }
  private consume(
    userId: string,
    operation: 'run' | 'experiment' | 'export',
    complexity: number,
  ) {
    try {
      this.guard.consume({ userId, operation, complexity, now: new Date() });
    } catch (error) {
      throw guardError(error);
    }
  }
}

@Injectable()
export class ExperimentsService {
  constructor(
    @Inject(EXPERIMENT_STORE) private readonly store: ExperimentStore,
    @Inject(STRATEGY_APPLICATION)
    private readonly strategies: StrategyApplicationService,
    @Inject(BACKTEST_COMMAND_GUARD)
    private readonly guard: BacktestCommandGuard,
  ) {}

  list(userId: string) {
    return this.store.listOwned(userId);
  }
  async get(userId: string, rawId: string) {
    return publicValue(await this.owned(userId, identifier(rawId)));
  }

  async create(userId: string, body: ExperimentCreateDto) {
    const value = parse(experimentCreate, body, 'EXPERIMENT_REQUEST_INVALID');
    const revisions = await this.strategyOwned(userId, value.strategyId);
    if (!revisions.some((item) => item.revision === value.strategyRevision))
      throw new NotFoundException({
        code: 'STRATEGY_REVISION_NOT_FOUND',
        message: 'Strategy revision was not found',
      });
    const definition = value.definition as unknown as Parameters<
      typeof generateExperimentCombinations
    >[0];
    let combinations: ReturnType<typeof generateExperimentCombinations>;
    try {
      combinations = generateExperimentCombinations(definition);
    } catch {
      throw invalid('EXPERIMENT_GRID_INVALID');
    }
    const childCount = combinations.length * definition.grid.samples.length;
    this.consume(userId, 'experiment', childCount);
    return this.store.create({
      id: randomUUID(),
      ownerUserId: userId,
      strategyId: value.strategyId,
      strategyRevision: value.strategyRevision,
      dataSnapshotId: value.dataSnapshotId,
      dataSnapshotHash: value.dataSnapshotHash,
      name: value.name,
      experimentHash: hash({ userId, ...value }),
      definition: value.definition,
      combinationCount: childCount,
      now: new Date(),
    });
  }

  async cancel(userId: string, rawId: string) {
    const id = identifier(rawId);
    await this.owned(userId, id);
    return (
      (await this.store.cancel(id, userId, new Date())) ??
      conflict('EXPERIMENT_NOT_CANCELLABLE')
    );
  }
  async results(userId: string, rawId: string) {
    const id = identifier(rawId);
    await this.owned(userId, id);
    return (await this.store.results(id)).map(publicValue);
  }
  async matrix(userId: string, rawId: string) {
    const id = identifier(rawId);
    await this.owned(userId, id);
    return (await this.store.matrix(id)).map(publicValue);
  }
  async export(userId: string, rawId: string) {
    const id = identifier(rawId);
    await this.owned(userId, id);
    this.consume(userId, 'export', 1);
    const rows = await this.store.matrix(id);
    return buildCsv(
      [
        'bindingHash',
        'sampleRole',
        'parameterBinding',
        'selectedMetrics',
        'rank',
      ],
      rows.map((row) => [
        row['bindingHash'],
        row['sampleRole'],
        JSON.stringify(row['parameterBinding']),
        JSON.stringify(row['selectedMetrics']),
        row['rank'],
      ]),
    );
  }
  private async owned(userId: string, id: string): Promise<ExperimentRecord> {
    const item = await this.store.findById(id);
    if (!item) notFound('EXPERIMENT_NOT_FOUND');
    if (item.ownerUserId !== userId)
      throw forbidden('EXPERIMENT_ACCESS_DENIED');
    return item;
  }
  private async strategyOwned(userId: string, id: string) {
    try {
      await this.strategies.get(userId, id);
      return await this.strategies.revisions(userId, id);
    } catch (error) {
      if (error instanceof StrategyDomainError) throw mapStrategyError(error);
      throw error;
    }
  }
  private consume(
    userId: string,
    operation: 'experiment' | 'export',
    complexity: number,
  ) {
    try {
      this.guard.consume({ userId, operation, complexity, now: new Date() });
    } catch (error) {
      throw guardError(error);
    }
  }
}

export function strategyDto(
  value: import('@atlas/domain').StrategyWithRevision,
) {
  return publicValue(value);
}

function identifier(value: string) {
  return parse(uuid, value, 'IDENTIFIER_INVALID');
}
function requiredKey(value: string | undefined) {
  return parse(key, value, 'BACKTEST_IDEMPOTENCY_KEY_REQUIRED');
}
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code,
      message: 'Invalid request',
      details: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        reason: issue.message,
      })),
    });
  return result.data;
}
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
function decode<T extends { contextHash: string }>(
  raw: string,
  schema: z.ZodType<T>,
  contextHash: string,
  code: string,
): T {
  let value: T;
  try {
    value = schema.parse(
      JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')),
    );
  } catch {
    throw invalid(code);
  }
  if (value.contextHash !== contextHash)
    throw invalid('BACKTEST_CURSOR_CONTEXT_MISMATCH');
  return value;
}
function publicValue<T>(value: T): T {
  return sanitize(value) as T;
}
function sanitize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([name]) =>
            ![
              'revisionManifest',
              'providerRawPayload',
              'qualityMetadata',
            ].includes(name),
        )
        .map(([name, nested]) => [name, sanitize(nested)]),
    );
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new Error('Non-finite backtest API output');
  return value;
}
function downsample(
  points: readonly Record<string, unknown>[],
  resolution: 'raw' | 'daily' | 'weekly',
) {
  if (resolution === 'raw') return points.map(publicValue);
  const selected = new Map<string, Record<string, unknown>>();
  for (const point of points) {
    const date = new Date(String(point['timestamp']));
    const key =
      resolution === 'daily'
        ? date.toISOString().slice(0, 10)
        : `${date.getUTCFullYear()}-${Math.floor(date.getUTCDate() / 7)}`;
    selected.set(key, point);
  }
  return [...selected.values()].map(publicValue);
}
function invalid(code: string) {
  return new BadRequestException({ code, message: 'Invalid backtest request' });
}
function notFound(code: string): never {
  throw new NotFoundException({ code, message: 'Resource was not found' });
}
function forbidden(code: string) {
  return new ForbiddenException({ code, message: 'Access was denied' });
}
function conflict(code: string): never {
  throw new ConflictException({
    code,
    message: 'Resource state conflicts with request',
  });
}
function strategyNotFound() {
  return new NotFoundException({
    code: 'STRATEGY_NOT_FOUND',
    message: 'Strategy was not found',
  });
}
function mapStrategyError(error: StrategyDomainError): HttpException {
  const payload = { code: error.code, message: error.code };
  if (error.code === 'STRATEGY_NOT_FOUND')
    return new NotFoundException(payload);
  if (error.code === 'STRATEGY_ACCESS_DENIED')
    return new ForbiddenException(payload);
  if (
    error.code === 'STRATEGY_REVISION_CONFLICT' ||
    error.code === 'STRATEGY_DELETED'
  )
    return new ConflictException(payload);
  return new BadRequestException(payload);
}
function mapBacktestError(
  error: BacktestRuntimeApplicationError,
): HttpException {
  const payload = { code: error.code, message: error.code };
  if (error.code === 'BACKTEST_RUN_NOT_FOUND')
    return new NotFoundException(payload);
  if (error.code === 'BACKTEST_RUN_ACCESS_DENIED')
    return new ForbiddenException(payload);
  if (
    error.code === 'BACKTEST_IDEMPOTENCY_CONFLICT' ||
    error.code === 'BACKTEST_RUN_NOT_CANCELLABLE'
  )
    return new ConflictException(payload);
  if (
    error.code === 'BACKTEST_ENTITLEMENT_DENIED' ||
    error.code === 'BACKTEST_COMPLEXITY_LIMIT_EXCEEDED'
  )
    return new HttpException(payload, HttpStatus.TOO_MANY_REQUESTS);
  return new BadRequestException(payload);
}
function guardError(error: unknown): HttpException {
  const code = error instanceof Error ? error.message : 'BACKTEST_RATE_LIMITED';
  return new HttpException(
    { code, message: code },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
