import type { Request, Response } from 'express';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
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
  ApiDataResponseDto,
  BacktestSummaryResponseDto,
  BacktestCreateDto,
  ExperimentCreateDto,
  ListQueryDto,
  SeriesQueryDto,
  StrategyCreateDto,
  StrategyListQueryDto,
  StrategyUpdateDto,
  StrategyValidateDto,
  TradesQueryDto,
} from './backtests.dto';
import {
  BacktestsService,
  ExperimentsService,
  StrategiesService,
  strategyDto,
} from './backtests.service';

@ApiTags('Strategies')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@Controller('strategies')
export class StrategiesController {
  constructor(
    private readonly service: StrategiesService,
    @Inject(AUTHENTICATED_USER_RESOLVER)
    private readonly auth: AuthenticatedUserResolver,
  ) {}

  @Get()
  @ApiOkResponse({ type: ApiDataResponseDto })
  async list(@Req() request: Request, @Query() query: StrategyListQueryDto) {
    return this.response(request, {
      items: (
        await this.service.list(this.user(request), query.includeDeleted)
      ).map(strategyDto),
    });
  }

  @Post()
  @ApiCreatedResponse({ type: ApiDataResponseDto })
  async create(@Req() request: Request, @Body() body: StrategyCreateDto) {
    return this.response(
      request,
      strategyDto(await this.service.create(this.user(request), body)),
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: ApiDataResponseDto })
  @ApiForbiddenResponse({ description: 'Strategy ownership denied' })
  async get(@Req() request: Request, @Param('id') id: string) {
    return this.response(
      request,
      strategyDto(await this.service.get(this.user(request), id)),
    );
  }

  @Patch(':id')
  @ApiConflictResponse({ description: 'Expected revision conflict' })
  async update(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: StrategyUpdateDto,
  ) {
    return this.response(
      request,
      strategyDto(await this.service.update(this.user(request), id, body)),
    );
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Req() request: Request, @Param('id') id: string) {
    return this.response(
      request,
      strategyDto(await this.service.remove(this.user(request), id)),
    );
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@Req() request: Request, @Param('id') id: string) {
    return this.response(
      request,
      strategyDto(await this.service.restore(this.user(request), id)),
    );
  }

  @Post(':id/clone')
  @ApiCreatedResponse({ type: ApiDataResponseDto })
  async clone(@Req() request: Request, @Param('id') id: string) {
    return this.response(
      request,
      strategyDto(await this.service.clone(this.user(request), id)),
    );
  }

  @Get(':id/revisions')
  async revisions(@Req() request: Request, @Param('id') id: string) {
    return this.response(request, {
      items: await this.service.revisions(this.user(request), id),
    });
  }

  @Post('validate')
  @HttpCode(200)
  validate(@Req() request: Request, @Body() body: StrategyValidateDto) {
    return this.response(request, this.service.validate(body.definition));
  }

  private user(request: Request) {
    return this.auth(request);
  }
  private response(request: Request, data: unknown) {
    return { data, meta: { requestId: getRequestId(request) } };
  }
}

@ApiTags('Backtests')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@Controller('backtests')
export class BacktestsController {
  constructor(
    private readonly service: BacktestsService,
    @Inject(AUTHENTICATED_USER_RESOLVER)
    private readonly auth: AuthenticatedUserResolver,
  ) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ApiDataResponseDto })
  @ApiConflictResponse({ description: 'Same key with different payload' })
  @ApiTooManyRequestsResponse({ description: 'Complexity or run rate limit' })
  async create(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: BacktestCreateDto,
  ) {
    const result = await this.service.create(
      this.user(request),
      idempotencyKey,
      body,
    );
    response.status(result.replayed ? 200 : 201);
    return {
      data: result.run,
      meta: {
        requestId: getRequestId(request),
        replayed: result.replayed,
        dispatched: result.dispatched,
      },
    };
  }

  @Get()
  async list(@Req() request: Request, @Query() query: ListQueryDto) {
    const result = await this.service.list(this.user(request), query);
    return {
      data: { items: result.items },
      meta: { requestId: getRequestId(request), nextCursor: result.nextCursor },
    };
  }
  @Get(':id') async get(@Req() request: Request, @Param('id') id: string) {
    return this.response(
      request,
      await this.service.get(this.user(request), id),
    );
  }
  @Post(':id/cancel') @HttpCode(200) async cancel(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.response(
      request,
      await this.service.cancel(this.user(request), id),
    );
  }
  @Get(':id/summary')
  @ApiOkResponse({ type: BacktestSummaryResponseDto })
  async summary(@Req() request: Request, @Param('id') id: string) {
    return this.response(
      request,
      await this.service.summary(this.user(request), id),
    );
  }
  @Get(':id/series') async series(
    @Req() request: Request,
    @Param('id') id: string,
    @Query() query: SeriesQueryDto,
  ) {
    return this.response(request, {
      items: await this.service.series(this.user(request), id, query),
    });
  }
  @Get(':id/trades') async trades(
    @Req() request: Request,
    @Param('id') id: string,
    @Query() query: TradesQueryDto,
  ) {
    const result = await this.service.trades(this.user(request), id, query);
    return {
      data: { items: result.items },
      meta: { requestId: getRequestId(request), nextCursor: result.nextCursor },
    };
  }
  @Get(':id/orders') async orders(
    @Req() request: Request,
    @Param('id') id: string,
    @Query() query: ListQueryDto,
  ) {
    return this.response(request, {
      items: await this.service.orders(this.user(request), id, query),
    });
  }
  @Get(':id/fills') async fills(
    @Req() request: Request,
    @Param('id') id: string,
    @Query() query: ListQueryDto,
  ) {
    return this.response(request, {
      items: await this.service.fills(this.user(request), id, query),
    });
  }
  @Get(':id/methodology') async methodology(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.response(
      request,
      await this.service.methodology(this.user(request), id),
    );
  }
  private user(request: Request) {
    return this.auth(request);
  }
  private response(request: Request, data: unknown) {
    return { data, meta: { requestId: getRequestId(request) } };
  }
}

@ApiTags('Research Experiments')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@Controller('experiments')
export class ExperimentsController {
  constructor(
    private readonly service: ExperimentsService,
    @Inject(AUTHENTICATED_USER_RESOLVER)
    private readonly auth: AuthenticatedUserResolver,
  ) {}
  @Get() async list(@Req() request: Request) {
    return this.response(request, {
      items: await this.service.list(this.user(request)),
    });
  }
  @Post() @ApiCreatedResponse({ type: ApiDataResponseDto }) async create(
    @Req() request: Request,
    @Body() body: ExperimentCreateDto,
  ) {
    return this.response(
      request,
      await this.service.create(this.user(request), body),
    );
  }
  @Get(':id')
  @ApiForbiddenResponse({ description: 'Experiment ownership denied' })
  async get(@Req() request: Request, @Param('id') id: string) {
    return this.response(
      request,
      await this.service.get(this.user(request), id),
    );
  }
  @Post(':id/cancel') @HttpCode(200) async cancel(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.response(
      request,
      await this.service.cancel(this.user(request), id),
    );
  }
  @Get(':id/results') async results(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.response(request, {
      items: await this.service.results(this.user(request), id),
    });
  }
  @Get(':id/matrix') async matrix(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return this.response(request, {
      items: await this.service.matrix(this.user(request), id),
    });
  }
  @Post(':id/export')
  @HttpCode(200)
  @ApiTooManyRequestsResponse({ description: 'Export rate limit exceeded' })
  async export(
    @Req() request: Request,
    @Res() response: Response,
    @Param('id') id: string,
  ) {
    const csv = await this.service.export(this.user(request), id);
    response
      .status(200)
      .type('text/csv')
      .attachment(`experiment-${id}.csv`)
      .send(csv);
  }
  private user(request: Request) {
    return this.auth(request);
  }
  private response(request: Request, data: unknown) {
    return { data, meta: { requestId: getRequestId(request) } };
  }
}
