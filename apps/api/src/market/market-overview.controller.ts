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
} from '@nestjs/swagger';

import { getRequestId } from '../common/http/request-context';
import {
  MarketBreadthResponseDto,
  MarketOverviewResponseDto,
  MarketQueryDto,
  MarketRankingQueryDto,
  MarketRankingResponseDto,
  MarketSectorsResponseDto,
} from './market-overview.dto';
import { MarketOverviewService } from './market-overview.service';

@ApiTags('Market Intelligence')
@ApiTooManyRequestsResponse({
  description: 'Public market rate limit exceeded',
})
@ApiNotFoundResponse({ description: 'Market snapshot is not available' })
@Controller('market')
export class MarketOverviewController {
  constructor(
    @Inject(MarketOverviewService)
    private readonly service: MarketOverviewService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Read the latest versioned market overview snapshot',
  })
  @ApiOkResponse({ type: MarketOverviewResponseDto })
  async overview(@Req() request: Request, @Query() query: MarketQueryDto) {
    return this.response(
      request,
      await this.service.overview(this.clientKey(request), query),
    );
  }

  @Get('breadth')
  @ApiOkResponse({ type: MarketBreadthResponseDto })
  async breadth(@Req() request: Request, @Query() query: MarketQueryDto) {
    return this.response(
      request,
      await this.service.breadth(this.clientKey(request), query),
    );
  }

  @Get('sectors')
  @ApiOkResponse({ type: MarketSectorsResponseDto })
  async sectors(@Req() request: Request, @Query() query: MarketQueryDto) {
    return this.response(
      request,
      await this.service.sectors(this.clientKey(request), query),
    );
  }

  @Get('rankings/:type')
  @ApiBadRequestResponse({ description: 'Ranking type or cursor is invalid' })
  @ApiOkResponse({ type: MarketRankingResponseDto })
  @ApiParam({
    name: 'type',
    enum: [
      'gainers',
      'losers',
      'volume',
      'relativeVolume',
      'volatility',
      'breakoutCandidates',
    ],
  })
  async rankings(
    @Req() request: Request,
    @Param('type') type: string,
    @Query() query: MarketRankingQueryDto,
  ) {
    return this.response(
      request,
      await this.service.rankings(this.clientKey(request), type, query),
    );
  }

  private response(
    request: Request,
    result: { readonly data: unknown; readonly meta: Record<string, unknown> },
  ) {
    return {
      data: result.data,
      meta: { requestId: getRequestId(request), ...result.meta },
    };
  }

  private clientKey(request: Request) {
    return request.ip || request.socket.remoteAddress || 'unknown';
  }
}
