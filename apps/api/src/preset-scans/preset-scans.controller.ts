import type { Request, Response } from 'express';
import {
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { getCorrelationId, getRequestId } from '../common/http/request-context';
import { ScanRunResponseDto } from '../scanner/scanner-runtime.dto';
import { PresetScansService } from './preset-scans.service';

@ApiTags('Preset Scans')
@Controller()
export class PresetScansController {
  constructor(
    private readonly presets: PresetScansService,
    @Inject(AUTHENTICATED_USER_RESOLVER)
    private readonly authenticatedUser: AuthenticatedUserResolver,
  ) {}

  @Get('preset-scan-categories')
  @ApiOperation({ summary: 'List active preset scan categories' })
  @ApiOkResponse({ description: 'Active categories' })
  async categories(@Req() request: Request) {
    return {
      data: await this.presets.categories(),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Get('preset-scans')
  @ApiOperation({ summary: 'List published preset scans' })
  @ApiOkResponse({ description: 'Published presets only' })
  async list(@Req() request: Request, @Query('category') category?: string) {
    return {
      data: await this.presets.list(category),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Get('preset-scans/:code')
  @ApiOperation({ summary: 'Get a published preset scan revision' })
  @ApiOkResponse({ description: 'Published preset' })
  @ApiNotFoundResponse({ description: 'Preset is absent or unpublished' })
  async get(@Req() request: Request, @Param('code') code: string) {
    return {
      data: await this.presets.get(code),
      meta: { requestId: getRequestId(request) },
    };
  }

  @Post('preset-scans/:code/runs')
  @ApiBearerAuth()
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ summary: 'Start a run from the published preset revision' })
  @ApiCreatedResponse({ type: ScanRunResponseDto })
  @ApiOkResponse({ description: 'Idempotent replay', type: ScanRunResponseDto })
  async run(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Param('code') code: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<ScanRunResponseDto> {
    const result = await this.presets.run(
      this.authenticatedUser(request),
      code,
      idempotencyKey,
      getCorrelationId(request),
    );
    response.status(result.replayed ? 200 : 201);
    return {
      data: result.run,
      meta: { requestId: getRequestId(request), replayed: result.replayed },
    };
  }
}
