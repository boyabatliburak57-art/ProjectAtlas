import {
  ConsoleLogger,
  RequestMethod,
  type INestApplication,
  type LogLevel,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { setupOpenApi } from '../openapi/openapi';
import { securityHeaders } from '../security/security-headers';

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
  const corsOrigins = configService
    .getOrThrow<string>('API_CORS_ORIGIN')
    .split(',');
  const logLevel = configService.getOrThrow<LogLevel>('LOG_LEVEL');
  const environment = configService.getOrThrow<string>('ATLAS_ENV');

  application.useLogger(
    new ConsoleLogger({
      colors: false,
      json: true,
      logLevels: [...LOG_LEVELS[logLevel]],
      prefix: 'atlas-api',
    }),
  );
  application.use(securityHeaders(environment));
  const expressApplication = application as NestExpressApplication;
  expressApplication.useBodyParser('json', { limit: '6mb', strict: true });
  expressApplication.useBodyParser('urlencoded', {
    extended: false,
    limit: '1mb',
    parameterLimit: 32,
  });
  application.enableCors({
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin(
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) {
      if (origin === undefined || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });
  application.setGlobalPrefix('api/v1', {
    exclude: [
      { method: RequestMethod.GET, path: 'health/live' },
      { method: RequestMethod.GET, path: 'health/ready' },
      { method: RequestMethod.GET, path: 'health/startup' },
      { method: RequestMethod.GET, path: 'metrics' },
    ],
  });
  application.enableShutdownHooks();
  setupOpenApi(application);
}
