import type { Request } from 'express';

export function getRequestId(request: Request): string {
  return request.requestId ?? 'request-id-unavailable';
}

export function getCorrelationId(request: Request): string {
  return request.correlationId ?? getRequestId(request);
}
