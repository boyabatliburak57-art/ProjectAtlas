import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { getRequestId } from '../common/http/request-context';
import {
  IndicatorCatalogDetailResponseDto,
  IndicatorCatalogListResponseDto,
  IndicatorCatalogQueryDto,
} from './indicator-catalog.dto';
import { IndicatorCatalogService } from './indicator-catalog.service';

@ApiTags('Indicators')
@Controller('indicators')
export class IndicatorCatalogController {
  constructor(private readonly catalog: IndicatorCatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List public indicator definitions' })
  @ApiOkResponse({ type: IndicatorCatalogListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid catalog filter' })
  list(
    @Query() query: IndicatorCatalogQueryDto,
    @Req() request: Request,
  ): IndicatorCatalogListResponseDto {
    const items = [...this.catalog.list(query)];
    return {
      data: { items, total: items.length },
      meta: { requestId: getRequestId(request) },
    };
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get indicator definition and supported versions' })
  @ApiParam({ name: 'code', example: 'RSI' })
  @ApiOkResponse({ type: IndicatorCatalogDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Indicator was not found' })
  detail(
    @Param('code') code: string,
    @Req() request: Request,
  ): IndicatorCatalogDetailResponseDto {
    const detail = this.catalog.detail(code);
    return {
      data: { ...detail, versions: [...detail.versions] },
      meta: { requestId: getRequestId(request) },
    };
  }
}
