import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { getCorrelationId, getRequestId } from './request-context';
import { TelemetryService } from '../../observability/telemetry.service';

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function safeHeaderId(value: string | undefined): string | undefined {
  return value !== undefined && SAFE_ID_PATTERN.test(value) ? value : undefined;
}

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly telemetry: TelemetryService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = safeHeaderId(request.get('x-request-id')) ?? randomUUID();
    const correlationId =
      safeHeaderId(request.get('x-correlation-id')) ?? requestId;
    const startedAt = performance.now();

    request.requestId = requestId;
    request.correlationId = correlationId;
    response.setHeader('x-request-id', requestId);
    response.setHeader('x-correlation-id', correlationId);

    this.telemetry.runWithHttpContext(
      {
        correlationId,
        requestId,
        ...(request.get('traceparent') === undefined
          ? {}
          : { incomingTraceparent: request.get('traceparent')! }),
      },
      () => {
        const context = this.telemetry.currentContext();
        if (context !== undefined) {
          request.traceId = context.traceId;
          request.traceparent = context.traceparent;
          response.setHeader('traceparent', context.traceparent);
        }
        response.once('finish', () => {
          const durationMs =
            Math.round((performance.now() - startedAt) * 100) / 100;
          const route = resolveRouteTemplate(request);
          const outcome = response.statusCode < 400 ? 'success' : 'error';
          this.telemetry.log('info', 'http.request.completed', {
            correlationId: getCorrelationId(request),
            durationMs,
            method: request.method,
            outcome,
            requestId: getRequestId(request),
            route,
            statusCode: response.statusCode,
          });
          this.telemetry.metric({
            kind: 'histogram',
            labels: {
              environment: process.env['ATLAS_ENV'] ?? 'local',
              method: request.method,
              outcome,
              route,
              service: 'atlas-api',
              status_class: `${Math.floor(response.statusCode / 100)}xx`,
            },
            name: 'http.server.duration.ms',
            value: durationMs,
          });
          this.telemetry.metric({
            kind: 'counter',
            labels: {
              environment: process.env['ATLAS_ENV'] ?? 'local',
              method: request.method,
              outcome,
              route,
              service: 'atlas-api',
              status_class: `${Math.floor(response.statusCode / 100)}xx`,
            },
            name: 'http.server.requests.total',
            value: 1,
          });
        });
        next();
      },
    );
  }
}

function resolveRouteTemplate(request: Request): string {
  const routePath = (request.route as { path?: unknown } | undefined)?.path;
  return typeof routePath === 'string'
    ? `${request.baseUrl}${routePath}`
    : 'unmatched';
}
