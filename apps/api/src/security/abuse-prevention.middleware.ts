import { createHmac } from 'node:crypto';

import { securityRateLimitBuckets } from '@atlas/database';
import {
  HttpException,
  HttpStatus,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';

import { TelemetryService } from '../observability/telemetry.service';
import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';

type LimitClass =
  | 'auth'
  | 'normal_read'
  | 'write'
  | 'scanner_create'
  | 'portfolio_recalculate'
  | 'import_export'
  | 'backtest'
  | 'experiment'
  | 'admin';

const POLICIES: Readonly<
  Record<LimitClass, { limit: number; windowMs: number }>
> = {
  admin: { limit: 30, windowMs: 60_000 },
  auth: { limit: 5, windowMs: 60_000 },
  backtest: { limit: 10, windowMs: 60_000 },
  experiment: { limit: 5, windowMs: 60_000 },
  import_export: { limit: 10, windowMs: 60_000 },
  normal_read: { limit: 300, windowMs: 60_000 },
  portfolio_recalculate: { limit: 5, windowMs: 60_000 },
  scanner_create: { limit: 10, windowMs: 60_000 },
  write: { limit: 120, windowMs: 60_000 },
};

@Injectable()
export class AbusePreventionMiddleware implements NestMiddleware {
  private readonly enabled: boolean;
  private readonly hashKey: string;

  constructor(
    private readonly connection: ApiDatabase,
    private readonly telemetry: TelemetryService,
    config: ConfigService,
  ) {
    this.enabled = config.getOrThrow<boolean>('SECURITY_RATE_LIMIT_ENABLED');
    this.hashKey = config.getOrThrow<string>('AUTH_SESSION_HMAC_KEY');
  }

  async use(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    enforceRequestShape(request);
    if (!this.enabled) {
      next();
      return;
    }
    const limitClass = classify(request);
    const policy = POLICIES[limitClass];
    const now = new Date();
    const subjects = [
      `ip:${request.ip || request.socket.remoteAddress || 'unknown'}`,
      ...(request.authenticatedUserId === undefined
        ? []
        : [`user:${request.authenticatedUserId}`]),
      ...loginIdentitySubjects(request),
    ];
    for (const subject of subjects) {
      const count = await this.consume(
        hashSubject(this.hashKey, subject),
        limitClass,
        policy.windowMs,
        now,
      );
      if (count > policy.limit) {
        const retryAfter = Math.max(
          1,
          Math.ceil(
            (policy.windowMs - (now.getTime() % policy.windowMs)) / 1_000,
          ),
        );
        response.setHeader('Retry-After', String(retryAfter));
        this.telemetry.metric({
          kind: 'counter',
          labels: {
            environment: process.env['ATLAS_ENV'] ?? 'local',
            operation: limitClass,
            outcome: 'rejected',
            service: 'atlas-api',
          },
          name: 'security.rate_limit.total',
          value: 1,
        });
        throw new HttpException(
          {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Request rate limit exceeded',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    next();
  }

  private async consume(
    subjectHash: string,
    limitClass: LimitClass,
    windowMs: number,
    now: Date,
  ): Promise<number> {
    const windowStartedAt = new Date(
      Math.floor(now.getTime() / windowMs) * windowMs,
    );
    const expiresAt = new Date(windowStartedAt.getTime() + windowMs * 2);
    const result = await this.connection.database.execute(sql`
      insert into ${securityRateLimitBuckets}
        (subject_hash, limit_class, window_started_at, request_count, expires_at)
      values (${subjectHash}, ${limitClass}, ${windowStartedAt}, 1, ${expiresAt})
      on conflict (subject_hash, limit_class, window_started_at)
      do update set request_count = security_rate_limit_buckets.request_count + 1
      returning request_count
    `);
    const value = result.rows[0]?.['request_count'];
    return typeof value === 'number' ? value : Number(value);
  }
}

function loginIdentitySubjects(request: Request): readonly string[] {
  if (request.method !== 'POST' || request.path !== '/api/v1/auth/login')
    return [];
  const body = request.body as unknown;
  if (body === null || typeof body !== 'object') return [];
  const email = (body as Record<string, unknown>)['email'];
  if (typeof email !== 'string' || email.length > 320) return [];
  return [`login:${email.trim().toLowerCase()}`];
}

function classify(request: Request): LimitClass {
  const path = request.path;
  if (path.startsWith('/api/v1/auth/')) return 'auth';
  if (path.startsWith('/api/v1/admin/')) return 'admin';
  if (request.method === 'POST' && path === '/api/v1/scanner/runs')
    return 'scanner_create';
  if (/^\/api\/v1\/portfolios\/[^/]+\/recalculate$/u.test(path))
    return 'portfolio_recalculate';
  if (/\/imports|\/exports/u.test(path)) return 'import_export';
  if (path.startsWith('/api/v1/backtests')) return 'backtest';
  if (path.startsWith('/api/v1/experiments')) return 'experiment';
  return ['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    ? 'normal_read'
    : 'write';
}

function hashSubject(key: string, value: string): string {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function enforceRequestShape(request: Request): void {
  const contentLength = Number(request.get('content-length') ?? '0');
  const importRequest = /\/imports/u.test(request.path);
  const limit = importRequest ? 6 * 1024 * 1024 : 1024 * 1024;
  if (
    !Number.isFinite(contentLength) ||
    contentLength < 0 ||
    contentLength > limit
  )
    throw new HttpException(
      { code: 'REQUEST_BODY_TOO_LARGE', message: 'Request body is too large' },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  if (Object.keys(request.query).length > 32)
    throw new HttpException(
      { code: 'QUERY_TOO_COMPLEX', message: 'Query is too complex' },
      HttpStatus.BAD_REQUEST,
    );
}

export const SECURITY_RATE_LIMIT_POLICIES = POLICIES;
