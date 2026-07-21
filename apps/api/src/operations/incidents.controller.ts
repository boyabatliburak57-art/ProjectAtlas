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
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { ConfigService } from '@nestjs/config';
import { getRequestId } from '../common/http/request-context';
import {
  requireOperationsPrincipal,
  SECURITY_PRINCIPAL_RESOLVER,
  type SecurityPrincipalResolver,
} from '../security/security-principal';
import { IncidentsService } from './incidents.service';

@ApiTags('Operations Admin')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Operations role is required' })
@Controller('admin/incidents')
export class IncidentsController {
  constructor(
    private readonly incidents: IncidentsService,
    @Inject(SECURITY_PRINCIPAL_RESOLVER)
    private readonly principal: SecurityPrincipalResolver,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List recent operational incidents' })
  @ApiOkResponse({ description: 'Recent incident records' })
  async list(@Req() request: Request) {
    this.actor(request);
    return this.response(request, { items: await this.incidents.list() });
  }

  @Post()
  @ApiOperation({ summary: 'Create an operational incident' })
  async create(@Req() request: Request, @Body() body: unknown) {
    return this.response(
      request,
      await this.incidents.create(this.actor(request), body),
    );
  }

  @Get(':id')
  async get(@Req() request: Request, @Param('id') id: string) {
    this.actor(request);
    return this.response(request, await this.incidents.get(id));
  }

  @Post(':id/acknowledge')
  async acknowledge(@Req() request: Request, @Param('id') id: string) {
    return this.response(
      request,
      await this.incidents.acknowledge(id, this.actor(request)),
    );
  }

  @Post(':id/timeline')
  async timeline(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.response(
      request,
      await this.incidents.addTimeline(id, this.actor(request), body),
    );
  }

  @Post(':id/resolve')
  async resolve(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.response(
      request,
      await this.incidents.resolve(id, this.actor(request), body),
    );
  }

  private actor(request: Request): string {
    return requireOperationsPrincipal(
      request,
      this.principal,
      this.config.getOrThrow<number>('AUTH_REAUTH_MAX_AGE_SECONDS'),
    ).userId;
  }

  private response(request: Request, data: unknown) {
    return { data, meta: { requestId: getRequestId(request) } };
  }
}
