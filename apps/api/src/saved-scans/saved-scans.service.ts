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
  SavedScanError,
  type SavedScanRevision,
  type SavedScanWithRevision,
} from '@atlas/domain';
import { z } from 'zod';

import type {
  CreateSavedScanDto,
  SavedScanDto,
  UpdateSavedScanDto,
} from './saved-scans.dto';
import {
  SAVED_SCAN_APPLICATION,
  type SavedScanCommands,
} from './saved-scans.ports';

const uuidSchema = z.uuid();
const createSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  rule: z.record(z.string(), z.unknown()),
});
const updateSchema = z.object({
  expectedRevision: z.number().int().min(1),
  name: z.string().optional(),
  description: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  rule: z.record(z.string(), z.unknown()).optional(),
});

@Injectable()
export class SavedScansService {
  constructor(
    @Inject(SAVED_SCAN_APPLICATION)
    private readonly savedScans: SavedScanCommands,
  ) {}

  async list(userId: string, includeDeleted: string | undefined) {
    if (
      includeDeleted !== undefined &&
      !['true', 'false'].includes(includeDeleted)
    ) {
      throw invalidRequest();
    }
    return (await this.savedScans.list(userId, includeDeleted === 'true')).map(
      toDto,
    );
  }

  async get(userId: string, rawId: string): Promise<SavedScanDto> {
    return this.execute(async () =>
      toDto(await this.savedScans.get(userId, id(rawId))),
    );
  }

  async revisions(userId: string, rawId: string) {
    return this.execute(async () =>
      (await this.savedScans.revisions(userId, id(rawId))).map(toRevisionDto),
    );
  }

  async create(
    userId: string,
    body: CreateSavedScanDto,
  ): Promise<SavedScanDto> {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest(parsed.error);
    return this.execute(async () =>
      toDto(await this.savedScans.create({ userId, ...parsed.data })),
    );
  }

  async update(
    userId: string,
    rawId: string,
    body: UpdateSavedScanDto,
  ): Promise<SavedScanDto> {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest(parsed.error);
    return this.execute(async () =>
      toDto(
        await this.savedScans.update({
          userId,
          id: id(rawId),
          ...parsed.data,
        }),
      ),
    );
  }

  async delete(userId: string, rawId: string): Promise<SavedScanDto> {
    return this.execute(async () =>
      toDto(await this.savedScans.delete(userId, id(rawId))),
    );
  }

  async restore(userId: string, rawId: string): Promise<SavedScanDto> {
    return this.execute(async () =>
      toDto(await this.savedScans.restore(userId, id(rawId))),
    );
  }

  async clone(userId: string, rawId: string): Promise<SavedScanDto> {
    return this.execute(async () =>
      toDto(await this.savedScans.clone(userId, id(rawId))),
    );
  }

  private async execute<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof SavedScanError) throw mapError(error);
      throw error;
    }
  }
}

function id(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw invalidRequest(parsed.error);
  return parsed.data;
}

function toDto(scan: SavedScanWithRevision): SavedScanDto {
  return {
    id: scan.id,
    ownerUserId: scan.ownerUserId,
    name: scan.name,
    description: scan.description,
    visibility: 'private',
    status: scan.status,
    currentRevision: scan.currentRevision,
    tags: scan.tags,
    createdAt: scan.createdAt.toISOString(),
    updatedAt: scan.updatedAt.toISOString(),
    deletedAt: scan.deletedAt?.toISOString() ?? null,
    revision: toRevisionDto(scan.revision),
  };
}

function toRevisionDto(revision: SavedScanRevision) {
  return {
    id: revision.id,
    savedScanId: revision.savedScanId,
    revision: revision.revision,
    ruleVersion: revision.ruleVersion,
    rule: revision.rule as unknown as Readonly<Record<string, unknown>>,
    complexityScore: revision.complexityScore,
    createdBy: revision.createdBy,
    createdAt: revision.createdAt.toISOString(),
  };
}

function invalidRequest(error?: z.ZodError) {
  return new BadRequestException({
    code: 'SAVED_SCAN_INVALID',
    message: 'Invalid saved scan request',
    ...(error === undefined
      ? {}
      : {
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            reason: issue.message,
          })),
        }),
  });
}

function mapError(error: SavedScanError) {
  const payload = {
    code: error.code,
    message: message(error.code),
    ...(error.details === undefined ? {} : { details: error.details }),
  };
  if (error.code === 'SAVED_SCAN_NOT_FOUND')
    return new NotFoundException(payload);
  if (error.code === 'SAVED_SCAN_ACCESS_DENIED')
    return new ForbiddenException(payload);
  if (error.code === 'SAVED_SCAN_CONFLICT')
    return new ConflictException(payload);
  if (error.code === 'SAVED_SCAN_QUOTA_EXCEEDED') {
    return new HttpException(payload, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (error.code === 'SAVED_SCAN_DELETED')
    return new ConflictException(payload);
  return new BadRequestException(payload);
}

function message(code: string): string {
  return (
    {
      SAVED_SCAN_NOT_FOUND: 'Saved scan was not found',
      SAVED_SCAN_ACCESS_DENIED: 'Access to saved scan was denied',
      SAVED_SCAN_CONFLICT: 'Saved scan revision conflict',
      SAVED_SCAN_DELETED: 'Saved scan is deleted',
      SAVED_SCAN_INVALID: 'Invalid saved scan request',
      SAVED_SCAN_QUOTA_EXCEEDED: 'Saved scan quota was exceeded',
    }[code] ?? 'Saved scan request could not be processed'
  );
}
