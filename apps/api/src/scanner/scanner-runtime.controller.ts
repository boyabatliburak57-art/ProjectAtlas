import type { Response } from 'express';
import type { Request } from 'express';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { getCorrelationId, getRequestId } from '../common/http/request-context';
import {
  CreateScanRunDto,
  ScanResultsResponseDto,
  ScanRunResponseDto,
  ScanRunResultsQueryDto,
} from './scanner-runtime.dto';
import { ScannerRuntimeService } from './scanner-runtime.service';

@ApiTags('Scanner Runtime')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@Controller('scanner/runs')
export class ScannerRuntimeController {
  constructor(
    private readonly scanner: ScannerRuntimeService,
    @Inject(AUTHENTICATED_USER_RESOLVER)
    private readonly authenticatedUser: AuthenticatedUserResolver,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create or replay a scan run' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ScanRunResponseDto })
  @ApiOkResponse({
    description: 'Idempotent replay of an existing run',
    type: ScanRunResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Missing key or malformed request' })
  @ApiConflictResponse({ description: 'Idempotency conflict' })
  @ApiUnprocessableEntityResponse({ description: 'Invalid rule or universe' })
  @ApiTooManyRequestsResponse({ description: 'Quota or complexity exceeded' })
  async create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateScanRunDto,
  ): Promise<ScanRunResponseDto> {
    const result = await this.scanner.create(
      this.authenticatedUser(request),
      idempotencyKey,
      body,
      getCorrelationId(request),
    );
    response.status(result.replayed ? 200 : 201);
    return {
      data: result.run,
      meta: { requestId: getRequestId(request), replayed: result.replayed },
    };
  }

  @Get(':runId')
  @ApiOperation({ summary: 'Get owned scan run status and durable progress' })
  @ApiParam({ name: 'runId', format: 'uuid' })
  @ApiOkResponse({ type: ScanRunResponseDto })
  @ApiForbiddenResponse({ description: 'Run belongs to another user' })
  @ApiNotFoundResponse({ description: 'Run was not found' })
  async status(
    @Req() request: Request,
    @Param('runId') runId: string,
  ): Promise<ScanRunResponseDto> {
    return {
      data: await this.scanner.status(this.authenticatedUser(request), runId),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Get(':runId/results')
  @ApiOperation({
    summary: 'List owned scan run results with cursor pagination',
  })
  @ApiParam({ name: 'runId', format: 'uuid' })
  @ApiOkResponse({ type: ScanResultsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid pagination parameters' })
  @ApiForbiddenResponse({ description: 'Run belongs to another user' })
  @ApiNotFoundResponse({ description: 'Run was not found' })
  async results(
    @Req() request: Request,
    @Param('runId') runId: string,
    @Query() query: ScanRunResultsQueryDto,
  ): Promise<ScanResultsResponseDto> {
    const result = await this.scanner.results(
      this.authenticatedUser(request),
      runId,
      query,
    );
    return {
      data: { items: [...result.items] },
      meta: {
        requestId: getRequestId(request),
        nextCursor: result.nextCursor,
      },
    };
  }

  @Post(':runId/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Request cooperative cancellation for an owned run',
  })
  @ApiParam({ name: 'runId', format: 'uuid' })
  @ApiOkResponse({ type: ScanRunResponseDto })
  @ApiConflictResponse({ description: 'Terminal run cannot be cancelled' })
  @ApiForbiddenResponse({ description: 'Run belongs to another user' })
  @ApiNotFoundResponse({ description: 'Run was not found' })
  async cancel(
    @Req() request: Request,
    @Param('runId') runId: string,
  ): Promise<ScanRunResponseDto> {
    return {
      data: await this.scanner.cancel(this.authenticatedUser(request), runId),
      meta: { requestId: getRequestId(request) },
    };
  }
}
