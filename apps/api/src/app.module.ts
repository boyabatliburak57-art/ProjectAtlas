import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { createCoreIndicatorRegistry } from '@atlas/domain';

import { CorrelationIdMiddleware } from './common/http/correlation-id.middleware';
import { GlobalExceptionFilter } from './common/http/global-exception.filter';
import { parseEnvironment } from './config/environment';
import { HealthController } from './health/health.controller';
import { IndicatorCatalogController } from './indicators/indicator-catalog.controller';
import {
  INDICATOR_REGISTRY,
  IndicatorCatalogService,
} from './indicators/indicator-catalog.service';

@Module({
  controllers: [HealthController, IndicatorCatalogController],
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: parseEnvironment,
    }),
  ],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: INDICATOR_REGISTRY, useFactory: createCoreIndicatorRegistry },
    IndicatorCatalogService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}
