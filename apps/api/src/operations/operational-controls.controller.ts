import type { Request } from 'express';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';

import { getCorrelationId, getRequestId } from '../common/http/request-context';
import {
  requireOperationsPrincipal,
  SECURITY_PRINCIPAL_RESOLVER,
  type SecurityPrincipalResolver,
} from '../security/security-principal';
import { OperationalControlsService } from './operational-controls.service';

@ApiTags('Operations Admin')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Operations role is required' })
@Controller('admin/operations')
export class OperationalControlsController {
  constructor(
    private readonly operations: OperationalControlsService,
    @Inject(SECURITY_PRINCIPAL_RESOLVER)
    private readonly resolvePrincipal: SecurityPrincipalResolver,
    private readonly config: ConfigService,
  ) {}

  @Get('feature-flags')
  async listFlags(@Req() request: Request) {
    this.actor(request);
    return this.response(request, { items: await this.operations.listFlags() });
  }

  @Post('feature-flags')
  async createFlag(@Req() request: Request, @Body() body: unknown) {
    return this.response(
      request,
      await this.operations.createFlag(this.actor(request), body),
    );
  }

  @Post('feature-flags/:id/versions')
  async addFlagVersion(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.response(
      request,
      await this.operations.addFlagVersion(this.actor(request), id, body),
    );
  }

  @Get('releases')
  async listReleases(@Req() request: Request) {
    this.actor(request);
    return this.response(request, {
      items: await this.operations.listReleases(),
    });
  }

  @Post('releases')
  async createRelease(@Req() request: Request, @Body() body: unknown) {
    return this.response(
      request,
      await this.operations.createRelease(this.actor(request), body),
    );
  }

  @Get('audit')
  async listAudit(@Req() request: Request) {
    this.actor(request);
    return this.response(request, { items: await this.operations.listAudit() });
  }

  private actor(request: Request) {
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

  private response(request: Request, data: unknown) {
    return { data, meta: { requestId: getRequestId(request) } };
  }
}
