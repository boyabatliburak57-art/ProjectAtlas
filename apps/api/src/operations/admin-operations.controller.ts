import type { Request } from 'express';
import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { getCorrelationId, getRequestId } from '../common/http/request-context';
import {
  requireOperationsPrincipal,
  SECURITY_PRINCIPAL_RESOLVER,
  type SecurityPrincipalResolver,
} from '../security/security-principal';
import { AdminOperationsService } from './admin-operations.service';
import { KILL_SWITCHES } from './feature-flag-runtime.service';
import {
  OperationalControlsService,
  type OperationalActorContext,
} from './operational-controls.service';

const maintenanceInput = z.object({
  confirmation: z.literal('SET_MAINTENANCE_BANNER'),
  expectedVersion: z.number().int().min(0),
  message: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(8).max(4_096),
});
const clearMaintenanceInput = z.object({
  confirmation: z.literal('CLEAR_MAINTENANCE_BANNER'),
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(8).max(4_096),
});
const switchInput = z.object({
  confirmation: z.enum(['ENABLE_KILL_SWITCH', 'DISABLE_KILL_SWITCH']),
  expectedVersion: z.number().int().min(0),
  reason: z.string().trim().min(8).max(4_096),
});

abstract class AdminControllerBase {
  constructor(
    protected readonly resolvePrincipal: SecurityPrincipalResolver,
    protected readonly config: ConfigService,
  ) {}

  protected actor(request: Request): OperationalActorContext {
    const principal = requireOperationsPrincipal(
      request,
      this.resolvePrincipal,
      this.config.getOrThrow<number>('AUTH_REAUTH_MAX_AGE_SECONDS'),
    );
    return {
      correlationId: getCorrelationId(request),
      requestId: getRequestId(request),
      userId: principal.userId,
    };
  }

  protected response(request: Request, data: unknown) {
    return { data, meta: { requestId: getRequestId(request) } };
  }
}

@ApiTags('Feature Flags Admin')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Operations role is required' })
@Controller('admin/feature-flags')
export class FeatureFlagsAdminController extends AdminControllerBase {
  constructor(
    private readonly operations: OperationalControlsService,
    @Inject(SECURITY_PRINCIPAL_RESOLVER) resolver: SecurityPrincipalResolver,
    config: ConfigService,
  ) {
    super(resolver, config);
  }

  @Get()
  async list(@Req() request: Request) {
    this.actor(request);
    return this.response(request, {
      expired: await this.operations.expiredFlags(),
      items: await this.operations.listFlags(),
    });
  }

  @Get(':key')
  async get(@Req() request: Request, @Param('key') key: string) {
    this.actor(request);
    return this.response(request, await this.operations.getFlag(key));
  }

  @Post()
  async create(@Req() request: Request, @Body() body: unknown) {
    return this.response(
      request,
      await this.operations.createFlag(this.actor(request), body),
    );
  }

  @Post(':key/versions')
  async version(
    @Req() request: Request,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.response(
      request,
      await this.operations.addFlagVersionByKey(this.actor(request), key, body),
    );
  }

  @Get(':key/history')
  async history(@Req() request: Request, @Param('key') key: string) {
    this.actor(request);
    return this.response(request, await this.operations.flagHistory(key));
  }
}

@ApiTags('Operations Admin')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Operations role is required' })
@Controller('admin/operations')
export class AdminOperationsController extends AdminControllerBase {
  constructor(
    private readonly admin: AdminOperationsService,
    @Inject(SECURITY_PRINCIPAL_RESOLVER) resolver: SecurityPrincipalResolver,
    config: ConfigService,
  ) {
    super(resolver, config);
  }

  @Get('overview') async overview(@Req() request: Request) {
    this.actor(request);
    return this.response(request, await this.admin.overview());
  }
  @Get('queues') async queues(@Req() request: Request) {
    this.actor(request);
    return this.response(request, { items: await this.admin.queues() });
  }
  @Post('queues/:queue/pause') async pause(
    @Req() request: Request,
    @Param('queue') queue: string,
    @Body() body: unknown,
  ) {
    return this.response(
      request,
      await this.admin.setQueuePaused(this.actor(request), queue, true, body),
    );
  }
  @Post('queues/:queue/resume') async resume(
    @Req() request: Request,
    @Param('queue') queue: string,
    @Body() body: unknown,
  ) {
    return this.response(
      request,
      await this.admin.setQueuePaused(this.actor(request), queue, false, body),
    );
  }
  @Post('jobs/:jobId/retry') async retry(
    @Req() request: Request,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    return this.response(
      request,
      await this.admin.retryJob(this.actor(request), jobId, body),
    );
  }
  @Post('jobs/:jobId/cancel') async cancel(
    @Req() request: Request,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ) {
    return this.response(
      request,
      await this.admin.cancelJob(this.actor(request), jobId, body),
    );
  }
  @Get('data-freshness') async freshness(@Req() request: Request) {
    this.actor(request);
    return this.response(request, await this.admin.dataFreshness());
  }
  @Get('incidents') async incidents(@Req() request: Request) {
    this.actor(request);
    return this.response(request, {
      items: await this.admin.incidentSummary(),
    });
  }
}

@ApiTags('Maintenance Admin')
@ApiBearerAuth()
@Controller('admin/maintenance')
export class MaintenanceAdminController extends AdminControllerBase {
  constructor(
    private readonly operations: OperationalControlsService,
    @Inject(SECURITY_PRINCIPAL_RESOLVER) resolver: SecurityPrincipalResolver,
    config: ConfigService,
  ) {
    super(resolver, config);
  }

  @Post('banner') async setBanner(
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    const input = parseAdminInput(maintenanceInput, body);
    await this.ensureMaintenanceFlag(this.actor(request));
    return this.response(
      request,
      await this.operations.addFlagVersionByKey(
        this.actor(request),
        'maintenance.banner',
        {
          confirmation: 'CONFIRM_OPERATIONAL_CHANGE',
          enabled: true,
          environment: this.config.getOrThrow<string>('ATLAS_ENV'),
          expectedVersion: input.expectedVersion,
          reason: input.reason,
          targetingRules: { message: [input.message] },
        },
      ),
    );
  }

  @Delete('banner') async clearBanner(
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    const input = parseAdminInput(clearMaintenanceInput, body);
    return this.response(
      request,
      await this.operations.addFlagVersionByKey(
        this.actor(request),
        'maintenance.banner',
        {
          confirmation: 'CONFIRM_OPERATIONAL_CHANGE',
          enabled: false,
          environment: this.config.getOrThrow<string>('ATLAS_ENV'),
          expectedVersion: input.expectedVersion,
          reason: input.reason,
        },
      ),
    );
  }

  @Post('kill-switches/:key/enable') enable(
    @Req() request: Request,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.setSwitch(request, key, true, body);
  }

  @Post('kill-switches/:key/disable') disable(
    @Req() request: Request,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.setSwitch(request, key, false, body);
  }

  private async setSwitch(
    request: Request,
    key: string,
    enabled: boolean,
    body: unknown,
  ) {
    if (!Object.values(KILL_SWITCHES).includes(key as never))
      throw new BadRequestException({
        code: 'KILL_SWITCH_NOT_ALLOWLISTED',
        message: 'Kill switch is not allowlisted',
      });
    const input = parseAdminInput(switchInput, body);
    if (
      input.confirmation !==
      (enabled ? 'ENABLE_KILL_SWITCH' : 'DISABLE_KILL_SWITCH')
    )
      throw new BadRequestException({
        code: 'DANGEROUS_CONFIRMATION_INVALID',
        message: 'Confirmation text is invalid',
      });
    return this.response(
      request,
      await this.operations.addFlagVersionByKey(this.actor(request), key, {
        confirmation: 'CONFIRM_OPERATIONAL_CHANGE',
        enabled,
        environment: this.config.getOrThrow<string>('ATLAS_ENV'),
        expectedVersion: input.expectedVersion,
        reason: input.reason,
      }),
    );
  }

  private async ensureMaintenanceFlag(actor: OperationalActorContext) {
    try {
      return await this.operations.getFlag('maintenance.banner');
    } catch {
      return this.operations.createFlag(actor, {
        defaultEnabled: false,
        description: 'User-visible maintenance banner',
        flagType: 'maintenance',
        key: 'maintenance.banner',
        owner: 'platform-operations',
      });
    }
  }
}

function parseAdminInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: 'ADMIN_OPERATION_REQUEST_INVALID',
      details: result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
      })),
      message: 'Admin operation request is invalid',
    });
  return result.data;
}

@ApiTags('Recovery Admin')
@ApiBearerAuth()
@Controller('admin/recovery')
export class RecoveryAdminController extends AdminControllerBase {
  constructor(
    private readonly admin: AdminOperationsService,
    @Inject(SECURITY_PRINCIPAL_RESOLVER) resolver: SecurityPrincipalResolver,
    config: ConfigService,
  ) {
    super(resolver, config);
  }
  @Get('status') async status(@Req() request: Request) {
    this.actor(request);
    return this.response(request, await this.admin.recoveryStatus());
  }
  @Get('drills') async drills(@Req() request: Request) {
    this.actor(request);
    return this.response(request, { items: await this.admin.recoveryDrills() });
  }
}
