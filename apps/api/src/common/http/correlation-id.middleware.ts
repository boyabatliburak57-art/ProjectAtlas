import { randomUUID } from 'node:crypto';

import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { getCorrelationId, getRequestId } from './request-context';

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function safeHeaderId(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_ID_PATTERN.test(value) ? value : undefined;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HttpRequest');

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = safeHeaderId(request.get('x-request-id')) ?? randomUUID();
    const correlationId =
      safeHeaderId(request.get('x-correlation-id')) ?? requestId;
    const startedAt = performance.now();

    request.requestId = requestId;
    request.correlationId = correlationId;
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-correlation-id', correlationId);

    response.once('finish', () => {
      this.logger.log({
        correlationId: getCorrelationId(request),
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        method: request.method,
        module: 'http',
        operation: request.path,
        requestId: getRequestId(request),
        result: response.statusCode < 400 ? 'success' : 'error',
        service: 'atlas-api',
        statusCode: response.statusCode,
      });
    });

    next();
  }
}
