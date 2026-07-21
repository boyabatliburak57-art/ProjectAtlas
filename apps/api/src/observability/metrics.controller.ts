import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';

import { TelemetryService } from './telemetry.service';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  snapshot(@Headers('authorization') authorization?: string): string {
    const expected = this.config.get<string>('METRICS_BEARER_TOKEN');
    if (expected !== undefined && authorization !== `Bearer ${expected}`)
      throw new ForbiddenException({
        code: 'METRICS_ACCESS_DENIED',
        message: 'Metrics access denied',
      });
    return this.telemetry.prometheusSnapshot();
  }
}
