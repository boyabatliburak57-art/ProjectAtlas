import { Controller, Get, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { getRequestId } from '../common/http/request-context';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get('live')
  @ApiOperation({ summary: 'Process liveness probe' })
  @ApiOkResponse({ description: 'API process is alive' })
  live(@Req() request: Request) {
    return {
      data: { status: 'live' },
      meta: { requestId: getRequestId(request) },
    } as const;
  }

  @Get('ready')
  @ApiOperation({ summary: 'Application readiness probe' })
  @ApiOkResponse({
    description: 'Configured application dependencies are ready',
  })
  ready(@Req() request: Request) {
    return {
      data: {
        checks: { application: 'ready' },
        status: 'ready',
      },
      meta: { requestId: getRequestId(request) },
    } as const;
  }
}
