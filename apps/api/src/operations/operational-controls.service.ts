import {
  featureFlags,
  featureFlagVersions,
  operationalAuditEvents,
  releaseRecords,
} from '@atlas/database';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';

const forbiddenOperationalKey =
  /^(?:__proto__|constructor|prototype)$|authorization|cookie|password|secret|token|connection.?string|raw.?payload/iu;
const safeOperationalObject = z
  .record(z.string().max(120), z.unknown())
  .superRefine((value, context) => {
    inspectOperationalValue(value, context, []);
  });

const flagInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]{2,119}$/u),
  description: z.string().trim().min(1).max(2_000),
  flagType: z.enum(['release', 'experiment', 'kill_switch']),
  defaultEnabled: z.boolean().default(false),
  owner: z.string().trim().min(1).max(120).optional(),
});
const flagVersionInput = z.object({
  enabled: z.boolean(),
  environment: z.enum(['test', 'staging', 'production']),
  rolloutPercentage: z.number().min(0).max(100).optional(),
  targetingRules: safeOperationalObject.default({}),
  reason: z.string().trim().min(8).max(4_096),
  confirmation: z.literal('CONFIRM_OPERATIONAL_CHANGE'),
});
const releaseInput = z.object({
  version: z.string().trim().min(1).max(128),
  commitSha: z.string().regex(/^[a-f0-9]{7,64}$/u),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  environment: z.enum(['staging', 'production']),
  migrations: safeOperationalObject.default({}),
  featureFlags: safeOperationalObject.default({}),
  validationSummary: safeOperationalObject.default({}),
  confirmation: z.literal('CONFIRM_RELEASE_RECORD'),
});

export interface OperationalActorContext {
  readonly correlationId?: string;
  readonly requestId?: string;
  readonly userId: string;
}

@Injectable()
export class OperationalControlsService {
  private readonly environment: string;

  constructor(
    private readonly connection: ApiDatabase,
    config: ConfigService,
  ) {
    this.environment = config.getOrThrow<string>('ATLAS_ENV');
  }

  listFlags() {
    return this.connection.database
      .select()
      .from(featureFlags)
      .orderBy(featureFlags.key);
  }

  async createFlag(actor: OperationalActorContext, body: unknown) {
    const value = parse(flagInput, body);
    return this.connection.database.transaction(async (transaction) => {
      const rows = await transaction
        .insert(featureFlags)
        .values(value)
        .onConflictDoNothing()
        .returning();
      const flag = rows[0];
      if (flag === undefined)
        throw new ConflictException({
          code: 'FEATURE_FLAG_EXISTS',
          message: 'Feature flag already exists',
        });
      await transaction
        .insert(operationalAuditEvents)
        .values(
          audit(
            actor,
            this.environment,
            'feature_flag.create',
            'feature_flag',
            flag.id,
            null,
            flag,
          ),
        );
      return flag;
    });
  }

  async addFlagVersion(
    actor: OperationalActorContext,
    id: string,
    body: unknown,
  ) {
    const value = parse(flagVersionInput, body);
    this.assertEnvironment(value.environment);
    return this.connection.database.transaction(async (transaction) => {
      const existing = await transaction
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.id, id))
        .limit(1);
      const flag = existing[0];
      if (flag === undefined)
        throw new BadRequestException({
          code: 'FEATURE_FLAG_NOT_FOUND',
          message: 'Feature flag was not found',
        });
      const versions = await transaction
        .insert(featureFlagVersions)
        .values({
          changedBy: actor.userId,
          enabled: value.enabled,
          environment: value.environment,
          flagId: id,
          reason: value.reason,
          rolloutPercentage:
            value.rolloutPercentage === undefined
              ? null
              : value.rolloutPercentage.toFixed(2),
          targetingRules: value.targetingRules,
          version: sql`coalesce((select max(version) from feature_flag_versions where flag_id = ${id} and environment = ${value.environment}), 0) + 1`,
        })
        .returning();
      const version = versions[0]!;
      await transaction
        .insert(operationalAuditEvents)
        .values(
          audit(
            actor,
            this.environment,
            value.enabled ? 'feature_flag.enable' : 'feature_flag.disable',
            'feature_flag',
            id,
            flag,
            version,
            value.reason,
          ),
        );
      return version;
    });
  }

  listReleases() {
    return this.connection.database
      .select()
      .from(releaseRecords)
      .orderBy(desc(releaseRecords.startedAt));
  }

  async createRelease(actor: OperationalActorContext, body: unknown) {
    const value = parse(releaseInput, body);
    this.assertEnvironment(value.environment);
    return this.connection.database.transaction(async (transaction) => {
      const rows = await transaction
        .insert(releaseRecords)
        .values({
          commitSha: value.commitSha,
          environment: value.environment,
          featureFlags: value.featureFlags,
          imageDigest: value.imageDigest,
          migrations: value.migrations,
          startedBy: actor.userId,
          status: 'planned',
          validationSummary: value.validationSummary,
          version: value.version,
        })
        .onConflictDoNothing()
        .returning();
      const release = rows[0];
      if (release === undefined)
        throw new ConflictException({
          code: 'RELEASE_RECORD_EXISTS',
          message: 'Release record already exists',
        });
      await transaction
        .insert(operationalAuditEvents)
        .values(
          audit(
            actor,
            this.environment,
            'release.create',
            'release',
            release.id,
            null,
            release,
          ),
        );
      return release;
    });
  }

  listAudit() {
    return this.connection.database
      .select()
      .from(operationalAuditEvents)
      .orderBy(desc(operationalAuditEvents.createdAt))
      .limit(200);
  }

  private assertEnvironment(requested: string): void {
    if (
      ['staging', 'production'].includes(this.environment) &&
      requested !== this.environment
    )
      throw new BadRequestException({
        code: 'OPERATIONAL_ENVIRONMENT_MISMATCH',
        message: 'Operational change does not match the active environment',
      });
  }
}

function inspectOperationalValue(
  value: unknown,
  context: z.RefinementCtx,
  path: readonly PropertyKey[],
): void {
  if (path.length > 8) {
    context.addIssue({
      code: 'custom',
      message: 'Operational payload is too deep',
      path: [...path],
    });
    return;
  }
  if (typeof value === 'string' && value.length > 4_096)
    context.addIssue({
      code: 'custom',
      message: 'Operational value is too long',
      path: [...path],
    });
  if (Array.isArray(value)) {
    if (value.length > 100)
      context.addIssue({
        code: 'custom',
        message: 'Operational array is too large',
        path: [...path],
      });
    value.forEach((item, index) =>
      inspectOperationalValue(item, context, [...path, index]),
    );
    return;
  }
  if (value !== null && typeof value === 'object')
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenOperationalKey.test(key))
        context.addIssue({
          code: 'custom',
          message: 'Sensitive operational key is forbidden',
          path: [...path, key],
        });
      inspectOperationalValue(child, context, [...path, key]);
    }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: 'OPERATIONAL_REQUEST_INVALID',
      details: result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
      })),
      message: 'Operational request is invalid',
    });
  return result.data;
}

function audit(
  actor: OperationalActorContext,
  environment: string,
  action: string,
  resourceType: string,
  resourceId: string,
  beforeState: unknown,
  afterState: unknown,
  reason?: string,
) {
  return {
    action,
    actorType: 'operations_admin',
    actorUserId: actor.userId,
    afterState,
    beforeState,
    correlationId: actor.correlationId,
    environment,
    reason,
    requestId: actor.requestId,
    resourceId,
    resourceType,
  };
}
