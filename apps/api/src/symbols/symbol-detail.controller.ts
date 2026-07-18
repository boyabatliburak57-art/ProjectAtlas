import type { Request } from 'express';
import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { getRequestId } from '../common/http/request-context';
import { SymbolChartQueryDto, SymbolResponseDto } from './symbol-detail.dto';
import { SymbolDetailService } from './symbol-detail.service';

@ApiTags('Symbol Intelligence')
@ApiParam({ name: 'symbol', example: 'THYAO' })
@ApiNotFoundResponse({ description: 'Symbol or market data was not found' })
@ApiTooManyRequestsResponse({
  description: 'Public market rate limit exceeded',
})
@Controller('symbols/:symbol')
export class SymbolDetailController {
  constructor(
    @Inject(SymbolDetailService) private readonly service: SymbolDetailService,
    @Inject(AUTHENTICATED_USER_RESOLVER)
    private readonly resolveUser: AuthenticatedUserResolver,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Read symbol profile, latest quote and quality metadata',
  })
  @ApiOkResponse({ type: SymbolResponseDto })
  async profile(@Req() request: Request, @Param('symbol') symbol: string) {
    return this.response(
      request,
      await this.service.profile(this.clientKey(request), symbol),
    );
  }

  @Get('quote')
  @ApiOkResponse({ type: SymbolResponseDto })
  async quote(@Req() request: Request, @Param('symbol') symbol: string) {
    return this.response(
      request,
      await this.service.quote(this.clientKey(request), symbol),
    );
  }

  @Get('chart')
  @ApiBadRequestResponse({
    description: 'Chart query, range or overlay limit is invalid',
  })
  @ApiUnauthorizedResponse({
    description: 'User markers require authentication',
  })
  @ApiOkResponse({ type: SymbolResponseDto })
  async chart(
    @Req() request: Request,
    @Param('symbol') symbol: string,
    @Query() query: SymbolChartQueryDto,
  ) {
    const userId =
      query.includeUserMarkers === 'true' ? this.resolveUser(request) : null;
    return this.response(
      request,
      await this.service.chart(this.clientKey(request), symbol, query, userId),
    );
  }

  @Get('signals')
  @ApiOkResponse({ type: SymbolResponseDto })
  async signals(@Req() request: Request, @Param('symbol') symbol: string) {
    return this.response(
      request,
      await this.service.signals(
        this.clientKey(request),
        symbol,
        request.authenticatedUserId ?? null,
      ),
    );
  }

  @Get('corporate-actions')
  @ApiOkResponse({ type: SymbolResponseDto })
  async corporateActions(
    @Req() request: Request,
    @Param('symbol') symbol: string,
  ) {
    return this.response(
      request,
      await this.service.corporateActions(this.clientKey(request), symbol),
    );
  }

  private response(
    request: Request,
    value: { readonly data: unknown; readonly meta: Record<string, unknown> },
  ) {
    return {
      data: value.data,
      meta: { requestId: getRequestId(request), ...value.meta },
    };
  }

  private clientKey(request: Request) {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
