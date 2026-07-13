import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  ScanPlanningError,
  ScanRunApplicationError,
  type ScanRunStatus,
} from '@atlas/domain';
import { z } from 'zod';

import type {
  CreateScanRunDto,
  ScanRunDto,
  ScanRunResultsQueryDto,
  ScanResultDto,
} from './scanner-runtime.dto';
import {
  SCANNER_RUN_DISPATCHER,
  SCANNER_RUNTIME_READER,
  SCAN_RUN_APPLICATION,
  type ScannerRunDispatcher,
  type ScannerRuntimeReader,
  type ScanRunCommands,
  type ScanRunStatusView,
} from './scanner-runtime.ports';

const uuidSchema = z.uuid();
const createSchema = z.object({
  rule: z.record(z.string(), z.unknown()),
  requestedHistoryBars: z.number().int().min(1).max(10_000).optional(),
});
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(1_024).optional(),
  status: z.enum(['matched', 'notEvaluable']).optional(),
  sort: z.enum(['createdAt', 'rank']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  includeExplanation: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
});
const cursorSchema = z.object({
  id: z.string().regex(/^\d+$/),
  sortValue: z.union([z.string(), z.number(), z.null()]),
});

@Injectable()
export class ScannerRuntimeService {
  constructor(
    @Inject(SCAN_RUN_APPLICATION)
    private readonly commands: ScanRunCommands,
    @Inject(SCANNER_RUNTIME_READER)
    private readonly reader: ScannerRuntimeReader,
    @Inject(SCANNER_RUN_DISPATCHER)
    private readonly dispatcher: ScannerRunDispatcher,
  ) {}

  async create(
    userId: string,
    idempotencyKey: string | undefined,
    body: CreateScanRunDto,
    correlationId: string,
  ): Promise<{ readonly run: ScanRunDto; readonly replayed: boolean }> {
    if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
      throw httpError('IDEMPOTENCY_KEY_REQUIRED');
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest(parsed.error);
    try {
      const created = await this.commands.create({
        userId,
        idempotencyKey,
        rule: parsed.data.rule,
        ...(parsed.data.requestedHistoryBars === undefined
          ? {}
          : { requestedHistoryBars: parsed.data.requestedHistoryBars }),
      });
      await this.dispatcher.dispatch({ runId: created.run.id, correlationId });
      const status = await this.reader.status(created.run.id);
      if (status === null) throw new Error('Created scan run is unreadable');
      return { run: toRunDto(status), replayed: created.replayed };
    } catch (error: unknown) {
      throw mapDomainError(error);
    }
  }

  async status(userId: string, runId: string): Promise<ScanRunDto> {
    const validRunId = parseRunId(runId);
    try {
      await this.commands.getOwned(validRunId, userId);
      const status = await this.reader.status(validRunId);
      if (status === null)
        throw new ScanRunApplicationError('SCAN_RUN_NOT_FOUND');
      return toRunDto(status);
    } catch (error: unknown) {
      throw mapDomainError(error);
    }
  }

  async results(
    userId: string,
    runId: string,
    rawQuery: ScanRunResultsQueryDto,
  ): Promise<{
    readonly items: readonly ScanResultDto[];
    readonly nextCursor: string | null;
  }> {
    const validRunId = parseRunId(runId);
    const query = querySchema.safeParse(rawQuery);
    if (!query.success) throw invalidRequest(query.error);
    const cursor =
      query.data.cursor === undefined
        ? undefined
        : decodeCursor(query.data.cursor, query.data.sort);
    try {
      await this.commands.getOwned(validRunId, userId);
      const page = await this.reader.results({
        runId: validRunId,
        limit: query.data.limit,
        status:
          query.data.status === undefined
            ? undefined
            : query.data.status === 'matched'
              ? 'matched'
              : 'not_evaluable',
        sort: query.data.sort,
        direction: query.data.direction,
        ...(cursor === undefined ? {} : { cursor }),
        includeExplanation: query.data.includeExplanation,
      });
      return {
        items: page.items.map((item) => ({
          id: item.id,
          instrumentId: item.instrumentId,
          rank: item.rank,
          status: item.status === 'not_evaluable' ? 'notEvaluable' : 'matched',
          computedValues: item.computedValues,
          ...(item.explanation === undefined
            ? {}
            : { explanation: item.explanation }),
          warnings: item.warnings,
          dataCutoffAt: item.dataCutoffAt.toISOString(),
          matchedAt: item.matchedAt?.toISOString() ?? null,
          sourceBatchIndex: item.sourceBatchIndex,
          resultVersion: item.resultVersion,
        })),
        nextCursor:
          page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      };
    } catch (error: unknown) {
      throw mapDomainError(error);
    }
  }

  async cancel(userId: string, runId: string): Promise<ScanRunDto> {
    const validRunId = parseRunId(runId);
    try {
      const run = await this.commands.requestCancellation(validRunId, userId);
      const status = await this.reader.status(run.id);
      if (status === null)
        throw new ScanRunApplicationError('SCAN_RUN_NOT_FOUND');
      return toRunDto(status);
    } catch (error: unknown) {
      throw mapDomainError(error);
    }
  }
}

function parseRunId(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw invalidRequest(parsed.error);
  return parsed.data;
}

function toRunDto(view: ScanRunStatusView): ScanRunDto {
  return {
    id: view.id,
    status: publicStatus(view.status),
    executionMode: view.executionMode,
    planVersion: view.planVersion,
    ruleVersion: view.ruleVersion,
    dataCutoffAt: view.dataCutoffAt.toISOString(),
    queuedAt: view.queuedAt.toISOString(),
    startedAt: view.startedAt?.toISOString() ?? null,
    completedAt: view.completedAt?.toISOString() ?? null,
    cancelRequestedAt: view.cancelRequestedAt?.toISOString() ?? null,
    cancelledAt: view.cancelledAt?.toISOString() ?? null,
    timeoutAt: view.timeoutAt?.toISOString() ?? null,
    progress: {
      ...view.progress,
      phase: publicStatus(view.status),
      updatedAt: view.progress.updatedAt.toISOString(),
      percent:
        view.progress.total === 0
          ? 100
          : Math.min(
              100,
              Math.floor((view.progress.processed / view.progress.total) * 100),
            ),
    },
    errorCode: view.errorCode,
  };
}

function publicStatus(status: ScanRunStatus): string {
  return status === 'cancel_requested' ? 'cancelRequested' : status;
}

function encodeCursor(cursor: unknown): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string, sort: 'createdAt' | 'rank') {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(value, 'base64url').toString('utf8'),
    );
    const cursor = cursorSchema.parse(decoded);
    const id = BigInt(cursor.id);
    if (id > 9_223_372_036_854_775_807n) throw new Error('cursor id range');
    if (
      sort === 'rank' &&
      (typeof cursor.sortValue !== 'number' ||
        !Number.isSafeInteger(cursor.sortValue) ||
        cursor.sortValue < 0)
    ) {
      throw new Error('cursor rank');
    }
    if (
      sort === 'createdAt' &&
      (typeof cursor.sortValue !== 'string' ||
        !Number.isFinite(Date.parse(cursor.sortValue)))
    ) {
      throw new Error('cursor timestamp');
    }
    return cursor;
  } catch {
    throw new BadRequestException({
      code: 'SCAN_RESULTS_CURSOR_INVALID',
      message: 'Invalid results cursor',
    });
  }
}

function invalidRequest(error: z.ZodError): BadRequestException {
  return new BadRequestException({
    code: 'SCAN_REQUEST_INVALID',
    message: 'Invalid scanner request',
    details: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      reason: issue.message,
    })),
  });
}

function mapDomainError(error: unknown): unknown {
  if (
    error instanceof ScanRunApplicationError ||
    error instanceof ScanPlanningError
  ) {
    return httpError(error.code, error.details);
  }
  return error;
}

function httpError(code: string, details?: unknown) {
  const payload = {
    code,
    message: errorMessage(code),
    ...(details === undefined ? {} : { details }),
  };
  if (code === 'IDEMPOTENCY_KEY_REUSED') return new ConflictException(payload);
  if (code === 'SCAN_RUN_NOT_FOUND') return new NotFoundException(payload);
  if (code === 'SCAN_RUN_ACCESS_DENIED' || code === 'SCAN_SOURCE_ACCESS_DENIED')
    return new ForbiddenException(payload);
  if (code === 'SCAN_RULE_INVALID' || code === 'SCAN_UNIVERSE_EMPTY')
    return new UnprocessableEntityException(payload);
  if (code === 'SCAN_TOO_COMPLEX' || code === 'SCAN_ENTITLEMENT_VIOLATION')
    return new HttpException(payload, HttpStatus.TOO_MANY_REQUESTS);
  if (code === 'SCAN_RUN_NOT_CANCELLABLE')
    return new ConflictException(payload);
  return new BadRequestException(payload);
}

function errorMessage(code: string): string {
  const messages: Readonly<Record<string, string>> = {
    IDEMPOTENCY_KEY_REQUIRED: 'Idempotency-Key header is required',
    IDEMPOTENCY_KEY_REUSED:
      'Idempotency key was reused for a different request',
    SCAN_RULE_INVALID: 'Scan rule is invalid',
    SCAN_UNIVERSE_EMPTY: 'Scan universe is empty',
    SCAN_RUN_NOT_FOUND: 'Scan run was not found',
    SCAN_RUN_ACCESS_DENIED: 'Access to scan run was denied',
    SCAN_RUN_NOT_CANCELLABLE: 'Scan run cannot be cancelled',
    SCAN_SOURCE_ACCESS_DENIED: 'Access to scan source was denied',
    SCAN_TOO_COMPLEX: 'Scan complexity limit was exceeded',
    SCAN_ENTITLEMENT_VIOLATION: 'Scan entitlement was exceeded',
  };
  return messages[code] ?? 'Scanner request could not be processed';
}
