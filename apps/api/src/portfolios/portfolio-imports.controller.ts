import type { Request, Response } from 'express';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { PORTFOLIO_CSV_LIMITS } from '@atlas/domain';

import {
  AUTHENTICATED_USER_RESOLVER,
  type AuthenticatedUserResolver,
} from '../common/auth/authenticated-user';
import { getRequestId } from '../common/http/request-context';
import {
  FeatureFlagRuntimeService,
  KILL_SWITCHES,
} from '../operations/feature-flag-runtime.service';
import {
  CommitPortfolioImportDto,
  PortfolioImportResponseDto,
  PortfolioImportRowsQueryDto,
  PortfolioImportRowsResponseDto,
} from './portfolio-imports.dto';
import {
  importJobDto,
  PortfolioImportsService,
} from './portfolio-imports.service';

interface CsvUpload {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

@ApiTags('Portfolio Imports and Exports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@Controller('portfolios/:portfolioId')
export class PortfolioImportsController {
  constructor(
    private readonly service: PortfolioImportsService,
    @Inject(AUTHENTICATED_USER_RESOLVER)
    private readonly authenticatedUser: AuthenticatedUserResolver,
    @Optional() private readonly flags?: FeatureFlagRuntimeService,
  ) {}

  @Post('imports')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: PORTFOLIO_CSV_LIMITS.maximumBytes },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: PortfolioImportResponseDto })
  async preview(
    @Req() request: Request,
    @Param('portfolioId') portfolioId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @UploadedFile() file: CsvUpload | undefined,
  ) {
    const userId = this.user(request);
    await this.flags?.assertWriteAllowed(KILL_SWITCHES.portfolioImports, {
      resourceId: portfolioId,
      userId,
    });
    const result = await this.service.preview(
      userId,
      portfolioId,
      idempotencyKey,
      file
        ? {
            filename: file.originalname,
            contentType: file.mimetype,
            size: file.size,
            bytes: file.buffer,
          }
        : undefined,
    );
    return {
      data: importJobDto(result.job),
      meta: { requestId: getRequestId(request), replayed: result.replayed },
    };
  }

  @Get('imports/:jobId')
  @ApiOkResponse({ type: PortfolioImportResponseDto })
  @ApiForbiddenResponse({ description: 'Import belongs to another user' })
  async get(
    @Req() request: Request,
    @Param('portfolioId') portfolioId: string,
    @Param('jobId') jobId: string,
  ) {
    return this.response(
      request,
      importJobDto(
        await this.service.get(this.user(request), portfolioId, jobId),
      ),
    );
  }

  @Get('imports/:jobId/rows')
  @ApiOkResponse({ type: PortfolioImportRowsResponseDto })
  async rows(
    @Req() request: Request,
    @Param('portfolioId') portfolioId: string,
    @Param('jobId') jobId: string,
    @Query() query: PortfolioImportRowsQueryDto,
  ) {
    const result = await this.service.rows(
      this.user(request),
      portfolioId,
      jobId,
      query,
    );
    return {
      data: { items: result.items },
      meta: {
        requestId: getRequestId(request),
        nextCursor: result.nextCursor,
      },
    };
  }

  @Post('imports/:jobId/commit')
  @HttpCode(200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiUnprocessableEntityResponse({
    description: 'Atomic validation or ledger validation failed',
  })
  @ApiOkResponse({ type: PortfolioImportResponseDto })
  async commit(
    @Req() request: Request,
    @Param('portfolioId') portfolioId: string,
    @Param('jobId') jobId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CommitPortfolioImportDto,
  ) {
    const userId = this.user(request);
    await this.flags?.assertWriteAllowed(KILL_SWITCHES.portfolioImports, {
      resourceId: portfolioId,
      userId,
    });
    const result = await this.service.commit(
      userId,
      portfolioId,
      jobId,
      idempotencyKey,
      body,
    );
    return {
      data: importJobDto(result.job),
      meta: { requestId: getRequestId(request), replayed: result.replayed },
    };
  }

  @Post('imports/:jobId/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: PortfolioImportResponseDto })
  async cancel(
    @Req() request: Request,
    @Param('portfolioId') portfolioId: string,
    @Param('jobId') jobId: string,
  ) {
    return this.response(
      request,
      importJobDto(
        await this.service.cancel(this.user(request), portfolioId, jobId),
      ),
    );
  }

  @Get('exports/transactions')
  @ApiOperation({ summary: 'Download an owned portfolio transaction CSV' })
  async exportTransactions(
    @Req() request: Request,
    @Res() response: Response,
    @Param('portfolioId') portfolioId: string,
  ) {
    await this.assertExportAllowed(request, portfolioId);
    return this.csv(
      response,
      `portfolio-${portfolioId}-transactions.csv`,
      await this.service.exportTransactions(this.user(request), portfolioId),
    );
  }

  @Get('exports/positions')
  async exportPositions(
    @Req() request: Request,
    @Res() response: Response,
    @Param('portfolioId') portfolioId: string,
  ) {
    await this.assertExportAllowed(request, portfolioId);
    return this.csv(
      response,
      `portfolio-${portfolioId}-positions.csv`,
      await this.service.exportPositions(this.user(request), portfolioId),
    );
  }

  @Get('exports/performance')
  async exportPerformance(
    @Req() request: Request,
    @Res() response: Response,
    @Param('portfolioId') portfolioId: string,
  ) {
    await this.assertExportAllowed(request, portfolioId);
    return this.csv(
      response,
      `portfolio-${portfolioId}-performance.csv`,
      await this.service.exportPerformance(this.user(request), portfolioId),
    );
  }

  private user(request: Request): string {
    return this.authenticatedUser(request);
  }

  private async assertExportAllowed(
    request: Request,
    portfolioId: string,
  ): Promise<void> {
    await this.flags?.assertWriteAllowed(KILL_SWITCHES.exports, {
      resourceId: portfolioId,
      userId: this.user(request),
    });
  }

  private response(request: Request, data: unknown) {
    return { data, meta: { requestId: getRequestId(request) } };
  }

  private csv(response: Response, filename: string, content: string) {
    response
      .status(200)
      .set({
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Content-Type': 'text/csv; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(content);
  }
}
