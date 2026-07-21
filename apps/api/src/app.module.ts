import {
  MiddlewareConsumer,
  Module,
  RequestMethod,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { createCoreIndicatorRegistry } from '@atlas/domain';

import { AlertsController } from './alerts/alerts.controller';
import {
  PostgresAlertDryRunEvaluator,
  PostgresAlertStore,
} from './alerts/alerts.infrastructure';
import { ALERT_DRY_RUN_EVALUATOR, ALERT_STORE } from './alerts/alerts.ports';
import { AlertsService } from './alerts/alerts.service';

import {
  AUTHENTICATED_USER_RESOLVER,
  trustedRequestUserResolver,
} from './common/auth/authenticated-user';
import { CorrelationIdMiddleware } from './common/http/correlation-id.middleware';
import { GlobalExceptionFilter } from './common/http/global-exception.filter';
import { parseEnvironment } from './config/environment';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';
import { TelemetryService } from './observability/telemetry.service';
import { MetricsController } from './observability/metrics.controller';
import { IncidentsController } from './operations/incidents.controller';
import { IncidentRepository } from './operations/incidents.repository';
import { IncidentsService } from './operations/incidents.service';
import { OperationalControlsController } from './operations/operational-controls.controller';
import { OperationalControlsService } from './operations/operational-controls.service';
import { AuthController } from './security/auth.controller';
import { AuthSessionService } from './security/auth-session.service';
import { AuthenticationMiddleware } from './security/authentication.middleware';
import { AbusePreventionMiddleware } from './security/abuse-prevention.middleware';
import {
  requestSecurityPrincipal,
  SECURITY_PRINCIPAL_RESOLVER,
} from './security/security-principal';
import { IndicatorCatalogController } from './indicators/indicator-catalog.controller';
import {
  NotificationPreferencesController,
  NotificationsController,
} from './notifications/notifications.controller';
import { PostgresNotificationCenterStore } from './notifications/notifications.infrastructure';
import { NOTIFICATION_CENTER_STORE } from './notifications/notifications.ports';
import { NotificationsService } from './notifications/notifications.service';
import {
  INDICATOR_REGISTRY,
  IndicatorCatalogService,
} from './indicators/indicator-catalog.service';
import { ScannerRuntimeController } from './scanner/scanner-runtime.controller';
import { ScannerCatalogController } from './scanner/scanner-catalog.controller';
import { ScannerCatalogService } from './scanner/scanner-catalog.service';
import {
  ApiDatabase,
  BullMqScannerProgressReader,
  BullMqScannerRunDispatcher,
  createFallbackScannerRuntimeReader,
  createScanRunApplication,
  PostgresScannerRuntimeReader,
} from './scanner/scanner-runtime.infrastructure';
import {
  SCANNER_RUN_DISPATCHER,
  SCANNER_PROGRESS_FAST_READER,
  SCANNER_RUNTIME_READER,
  SCAN_RUN_APPLICATION,
} from './scanner/scanner-runtime.ports';
import { ScannerRuntimeService } from './scanner/scanner-runtime.service';
import { SavedScansController } from './saved-scans/saved-scans.controller';
import { createSavedScanApplication } from './saved-scans/saved-scans.infrastructure';
import { SAVED_SCAN_APPLICATION } from './saved-scans/saved-scans.ports';
import { SavedScansService } from './saved-scans/saved-scans.service';
import { PresetScansController } from './preset-scans/preset-scans.controller';
import { PostgresPresetScanReader } from './preset-scans/preset-scans.infrastructure';
import { PRESET_SCAN_READER } from './preset-scans/preset-scans.ports';
import { PresetScansService } from './preset-scans/preset-scans.service';
import { WatchlistsController } from './watchlists/watchlists.controller';
import {
  createWatchlistApplication,
  PostgresWatchlistMarketSummaryReader,
  PostgresWatchlistRepository,
} from './watchlists/watchlists.infrastructure';
import {
  WATCHLIST_APPLICATION,
  WATCHLIST_MARKET_SUMMARY_READER,
} from './watchlists/watchlists.ports';
import { WatchlistsService } from './watchlists/watchlists.service';
import { PortfoliosController } from './portfolios/portfolios.controller';
import {
  createPortfolioApplication,
  InMemoryPortfolioCommandGuard,
  PostgresPortfolioReadModel,
} from './portfolios/portfolios.infrastructure';
import {
  PORTFOLIO_APPLICATION,
  PORTFOLIO_COMMAND_GUARD,
  PORTFOLIO_READ_MODEL,
} from './portfolios/portfolios.ports';
import { PortfoliosService } from './portfolios/portfolios.service';
import { PortfolioImportsController } from './portfolios/portfolio-imports.controller';
import {
  PostgresPortfolioImportCommitter,
  PostgresPortfolioImportStore,
} from './portfolios/portfolio-imports.infrastructure';
import {
  PORTFOLIO_IMPORT_COMMITTER,
  PORTFOLIO_IMPORT_STORE,
} from './portfolios/portfolio-imports.ports';
import { PortfolioImportsService } from './portfolios/portfolio-imports.service';
import { MarketOverviewController } from './market/market-overview.controller';
import {
  InMemoryMarketRateLimiter,
  MarketResponseCache,
  PostgresMarketOverviewReader,
} from './market/market-overview.infrastructure';
import {
  MARKET_OVERVIEW_READER,
  MARKET_RATE_LIMITER,
} from './market/market-overview.ports';
import { MarketOverviewService } from './market/market-overview.service';
import { SymbolDetailController } from './symbols/symbol-detail.controller';
import {
  PostgresSymbolDetailReader,
  SymbolResponseCache,
} from './symbols/symbol-detail.infrastructure';
import { SYMBOL_DETAIL_READER } from './symbols/symbol-detail.ports';
import { SymbolDetailService } from './symbols/symbol-detail.service';
import { FundamentalsController } from './fundamentals/fundamentals.controller';
import { PostgresFundamentalsReader } from './fundamentals/fundamentals.infrastructure';
import { FUNDAMENTALS_READER } from './fundamentals/fundamentals.ports';
import { FundamentalsService } from './fundamentals/fundamentals.service';
import { PatternsController } from './patterns/patterns.controller';
import { PostgresPatternReadModel } from './patterns/patterns.infrastructure';
import { PATTERN_READ_MODEL } from './patterns/patterns.ports';
import { PatternsService } from './patterns/patterns.service';
import {
  BacktestsController,
  ExperimentsController,
  StrategiesController,
} from './backtests/backtests.controller';
import {
  BullMqBacktestApiDispatcher,
  BullMqExperimentApiDispatcher,
  createBacktestApplication,
  createStrategyApplication,
  InMemoryBacktestCommandGuard,
  PostgresBacktestApiStore,
  PostgresExperimentStore,
  PostgresStrategyApiRepository,
} from './backtests/backtests.infrastructure';
import {
  BACKTEST_ANALYTICS_STORE,
  BACKTEST_COMMAND_GUARD,
  BACKTEST_RUN_REPOSITORY,
  EXPERIMENT_STORE,
  STRATEGY_REPOSITORY,
} from './backtests/backtests.ports';
import {
  BACKTEST_APPLICATION,
  BacktestsService,
  ExperimentsService,
  STRATEGY_APPLICATION,
  StrategiesService,
} from './backtests/backtests.service';

@Module({
  controllers: [
    HealthController,
    AuthController,
    IndicatorCatalogController,
    ScannerRuntimeController,
    ScannerCatalogController,
    SavedScansController,
    PresetScansController,
    WatchlistsController,
    AlertsController,
    NotificationsController,
    NotificationPreferencesController,
    PortfoliosController,
    PortfolioImportsController,
    MarketOverviewController,
    SymbolDetailController,
    FundamentalsController,
    PatternsController,
    StrategiesController,
    BacktestsController,
    ExperimentsController,
    IncidentsController,
    OperationalControlsController,
    MetricsController,
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
    HealthService,
    TelemetryService,
    AuthSessionService,
    AuthenticationMiddleware,
    AbusePreventionMiddleware,
    IncidentRepository,
    { provide: INDICATOR_REGISTRY, useFactory: createCoreIndicatorRegistry },
    {
      provide: AUTHENTICATED_USER_RESOLVER,
      useValue: trustedRequestUserResolver,
    },
    {
      provide: SECURITY_PRINCIPAL_RESOLVER,
      useValue: requestSecurityPrincipal,
    },
    ApiDatabase,
    PostgresScannerRuntimeReader,
    BullMqScannerRunDispatcher,
    BullMqScannerProgressReader,
    PostgresPresetScanReader,
    PostgresWatchlistRepository,
    PostgresWatchlistMarketSummaryReader,
    PostgresAlertStore,
    PostgresAlertDryRunEvaluator,
    PostgresNotificationCenterStore,
    PostgresPortfolioReadModel,
    InMemoryPortfolioCommandGuard,
    PostgresPortfolioImportStore,
    PostgresPortfolioImportCommitter,
    PostgresMarketOverviewReader,
    InMemoryMarketRateLimiter,
    MarketResponseCache,
    PostgresSymbolDetailReader,
    SymbolResponseCache,
    PostgresFundamentalsReader,
    PostgresPatternReadModel,
    PostgresStrategyApiRepository,
    PostgresBacktestApiStore,
    PostgresExperimentStore,
    BullMqBacktestApiDispatcher,
    BullMqExperimentApiDispatcher,
    InMemoryBacktestCommandGuard,
    {
      provide: SCAN_RUN_APPLICATION,
      inject: [ApiDatabase],
      useFactory: createScanRunApplication,
    },
    {
      provide: SAVED_SCAN_APPLICATION,
      inject: [ApiDatabase],
      useFactory: createSavedScanApplication,
    },
    {
      provide: WATCHLIST_APPLICATION,
      inject: [PostgresWatchlistRepository],
      useFactory: createWatchlistApplication,
    },
    {
      provide: WATCHLIST_MARKET_SUMMARY_READER,
      useExisting: PostgresWatchlistMarketSummaryReader,
    },
    { provide: ALERT_STORE, useExisting: PostgresAlertStore },
    {
      provide: ALERT_DRY_RUN_EVALUATOR,
      useExisting: PostgresAlertDryRunEvaluator,
    },
    {
      provide: NOTIFICATION_CENTER_STORE,
      useExisting: PostgresNotificationCenterStore,
    },
    {
      provide: PORTFOLIO_APPLICATION,
      inject: [ApiDatabase],
      useFactory: createPortfolioApplication,
    },
    {
      provide: PORTFOLIO_READ_MODEL,
      useExisting: PostgresPortfolioReadModel,
    },
    {
      provide: PORTFOLIO_COMMAND_GUARD,
      useExisting: InMemoryPortfolioCommandGuard,
    },
    {
      provide: PORTFOLIO_IMPORT_STORE,
      useExisting: PostgresPortfolioImportStore,
    },
    {
      provide: PORTFOLIO_IMPORT_COMMITTER,
      useExisting: PostgresPortfolioImportCommitter,
    },
    {
      provide: MARKET_OVERVIEW_READER,
      useExisting: PostgresMarketOverviewReader,
    },
    {
      provide: MARKET_RATE_LIMITER,
      useExisting: InMemoryMarketRateLimiter,
    },
    {
      provide: SYMBOL_DETAIL_READER,
      useExisting: PostgresSymbolDetailReader,
    },
    {
      provide: FUNDAMENTALS_READER,
      useExisting: PostgresFundamentalsReader,
    },
    { provide: PATTERN_READ_MODEL, useExisting: PostgresPatternReadModel },
    {
      provide: STRATEGY_REPOSITORY,
      useExisting: PostgresStrategyApiRepository,
    },
    {
      provide: STRATEGY_APPLICATION,
      inject: [PostgresStrategyApiRepository],
      useFactory: createStrategyApplication,
    },
    {
      provide: BACKTEST_RUN_REPOSITORY,
      useExisting: PostgresBacktestApiStore,
    },
    {
      provide: BACKTEST_ANALYTICS_STORE,
      useExisting: PostgresBacktestApiStore,
    },
    {
      provide: EXPERIMENT_STORE,
      useExisting: PostgresExperimentStore,
    },
    {
      provide: BACKTEST_COMMAND_GUARD,
      useExisting: InMemoryBacktestCommandGuard,
    },
    {
      provide: BACKTEST_APPLICATION,
      inject: [
        ApiDatabase,
        PostgresBacktestApiStore,
        BullMqBacktestApiDispatcher,
      ],
      useFactory: createBacktestApplication,
    },
    {
      provide: SCANNER_RUNTIME_READER,
      inject: [
        PostgresScannerRuntimeReader,
        SCANNER_PROGRESS_FAST_READER,
        ConfigService,
      ],
      useFactory: createFallbackScannerRuntimeReader,
    },
    {
      provide: SCANNER_PROGRESS_FAST_READER,
      useExisting: BullMqScannerProgressReader,
    },
    {
      provide: PRESET_SCAN_READER,
      useExisting: PostgresPresetScanReader,
    },
    {
      provide: SCANNER_RUN_DISPATCHER,
      useExisting: BullMqScannerRunDispatcher,
    },
    IndicatorCatalogService,
    ScannerRuntimeService,
    ScannerCatalogService,
    SavedScansService,
    PresetScansService,
    WatchlistsService,
    AlertsService,
    NotificationsService,
    PortfoliosService,
    PortfolioImportsService,
    MarketOverviewService,
    SymbolDetailService,
    FundamentalsService,
    PatternsService,
    StrategiesService,
    BacktestsService,
    ExperimentsService,
    IncidentsService,
    OperationalControlsService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        CorrelationIdMiddleware,
        AuthenticationMiddleware,
        AbusePreventionMiddleware,
      )
      .forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}
