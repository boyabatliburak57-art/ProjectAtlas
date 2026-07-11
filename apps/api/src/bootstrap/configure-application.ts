import {
  ConsoleLogger,
  RequestMethod,
  type INestApplication,
  type LogLevel,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { setupOpenApi } from '../openapi/openapi';

const LOG_LEVELS: Record<LogLevel, readonly LogLevel[]> = {
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  error: ['fatal', 'error'],
  fatal: ['fatal'],
  log: ['fatal', 'error', 'warn', 'log'],
  verbose: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
  warn: ['fatal', 'error', 'warn'],
};

export function configureApplication(application: INestApplication): void {
  const configService = application.get(ConfigService);
  const corsOrigin = configService.getOrThrow<string>('API_CORS_ORIGIN');
  const logLevel = configService.getOrThrow<LogLevel>('LOG_LEVEL');

  application.useLogger(
    new ConsoleLogger({
      colors: false,
      json: true,
      logLevels: [...LOG_LEVELS[logLevel]],
      prefix: 'atlas-api',
    }),
  );
  application.enableCors({ credentials: true, origin: corsOrigin });
  application.setGlobalPrefix('api/v1', {
    exclude: [
      { method: RequestMethod.GET, path: 'health/live' },
      { method: RequestMethod.GET, path: 'health/ready' },
    ],
  });
  application.enableShutdownHooks();
  setupOpenApi(application);
}
