import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { createCoreIndicatorRegistry } from '@atlas/domain';

import {
  AUTHENTICATED_USER_RESOLVER,
  trustedRequestUserResolver,
} from './common/auth/authenticated-user';
import { CorrelationIdMiddleware } from './common/http/correlation-id.middleware';
import { GlobalExceptionFilter } from './common/http/global-exception.filter';
import { parseEnvironment } from './config/environment';
import { HealthController } from './health/health.controller';
import { IndicatorCatalogController } from './indicators/indicator-catalog.controller';
import {
  INDICATOR_REGISTRY,
  IndicatorCatalogService,
} from './indicators/indicator-catalog.service';
import { ScannerRuntimeController } from './scanner/scanner-runtime.controller';
import {
  ApiDatabase,
  BullMqScannerRunDispatcher,
  createScanRunApplication,
  PostgresScannerRuntimeReader,
} from './scanner/scanner-runtime.infrastructure';
import {
  SCANNER_RUN_DISPATCHER,
  SCANNER_RUNTIME_READER,
  SCAN_RUN_APPLICATION,
} from './scanner/scanner-runtime.ports';
import { ScannerRuntimeService } from './scanner/scanner-runtime.service';

@Module({
  controllers: [
    HealthController,
    IndicatorCatalogController,
    ScannerRuntimeController,
  ],
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
    {
      provide: AUTHENTICATED_USER_RESOLVER,
      useValue: trustedRequestUserResolver,
    },
    ApiDatabase,
    PostgresScannerRuntimeReader,
    BullMqScannerRunDispatcher,
    {
      provide: SCAN_RUN_APPLICATION,
      inject: [ApiDatabase],
      useFactory: createScanRunApplication,
    },
    {
      provide: SCANNER_RUNTIME_READER,
      useExisting: PostgresScannerRuntimeReader,
    },
    {
      provide: SCANNER_RUN_DISPATCHER,
      useExisting: BullMqScannerRunDispatcher,
    },
    IndicatorCatalogService,
    ScannerRuntimeService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}
