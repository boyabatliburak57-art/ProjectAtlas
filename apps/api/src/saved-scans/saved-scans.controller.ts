import type { Request } from 'express';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { getRequestId } from '../common/http/request-context';
import {
  CreateSavedScanDto,
  SavedScanListResponseDto,
  SavedScanResponseDto,
  SavedScanRevisionsResponseDto,
  SavedScansQueryDto,
  UpdateSavedScanDto,
} from './saved-scans.dto';
import { SavedScansService } from './saved-scans.service';

@ApiTags('Saved Scans')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@Controller('saved-scans')
export class SavedScansController {
  constructor(
    private readonly service: SavedScansService,
    @Inject(AUTHENTICATED_USER_RESOLVER)
    private readonly authenticatedUser: AuthenticatedUserResolver,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List owned private saved scans' })
  @ApiOkResponse({ type: SavedScanListResponseDto })
  async list(@Req() request: Request, @Query() query: SavedScansQueryDto) {
    return {
      data: await this.service.list(
        this.authenticatedUser(request),
        query.includeDeleted,
      ),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a private saved scan and revision 1' })
  @ApiCreatedResponse({ type: SavedScanResponseDto })
  @ApiTooManyRequestsResponse({ description: 'Saved scan quota exceeded' })
  async create(@Req() request: Request, @Body() body: CreateSavedScanDto) {
    return {
      data: await this.service.create(this.authenticatedUser(request), body),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Get(':id')
  @ApiOkResponse({ type: SavedScanResponseDto })
  @ApiForbiddenResponse({ description: 'Saved scan belongs to another user' })
  @ApiNotFoundResponse({ description: 'Saved scan was not found' })
  async get(@Req() request: Request, @Param('id') id: string) {
    return {
      data: await this.service.get(this.authenticatedUser(request), id),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Create an immutable next revision' })
  @ApiOkResponse({ type: SavedScanResponseDto })
  @ApiConflictResponse({
    description: 'Stale expectedRevision or deleted scan',
  })
  async update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: UpdateSavedScanDto,
  ) {
    return {
      data: await this.service.update(
        this.authenticatedUser(request),
        id,
        body,
      ),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete an owned saved scan' })
  @ApiOkResponse({ type: SavedScanResponseDto })
  async delete(@Req() request: Request, @Param('id') id: string) {
    return {
      data: await this.service.delete(this.authenticatedUser(request), id),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Post(':id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore a soft-deleted saved scan' })
  @ApiOkResponse({ type: SavedScanResponseDto })
  async restore(@Req() request: Request, @Param('id') id: string) {
    return {
      data: await this.service.restore(this.authenticatedUser(request), id),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Post(':id/clone')
  @ApiOperation({
    summary: 'Clone an owned saved scan into a new private resource',
  })
  @ApiCreatedResponse({ type: SavedScanResponseDto })
  async clone(@Req() request: Request, @Param('id') id: string) {
    return {
      data: await this.service.clone(this.authenticatedUser(request), id),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Get(':id/revisions')
  @ApiOperation({ summary: 'List immutable revisions of an owned saved scan' })
  @ApiOkResponse({ type: SavedScanRevisionsResponseDto })
  async revisions(@Req() request: Request, @Param('id') id: string) {
    return {
      data: await this.service.revisions(this.authenticatedUser(request), id),
      meta: { requestId: getRequestId(request) },
    };
  }
}
