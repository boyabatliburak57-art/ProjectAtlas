import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  type NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import { constantTimeTokenMatch } from './security-crypto';
import { AuthSessionService } from './auth-session.service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AuthenticationMiddleware implements NestMiddleware {
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly cookieName: string;
  private readonly csrfCookieName: string;

  constructor(
    private readonly sessions: AuthSessionService,
    config: ConfigService,
  ) {
    this.allowedOrigins = new Set(
      config.getOrThrow<string>('API_CORS_ORIGIN').split(','),
    );
    this.cookieName = config.getOrThrow<string>('AUTH_COOKIE_NAME');
    this.csrfCookieName = config.getOrThrow<string>('AUTH_CSRF_COOKIE_NAME');
  }

  async use(
    request: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    const authorization = request.get('authorization');
    const bearer = parseBearer(authorization);
    const cookies = parseCookies(request.get('cookie'));
    const cookieToken = cookies[this.cookieName];
    const rawToken = bearer ?? cookieToken;
    if (rawToken === undefined) {
      next();
      return;
    }
    const session = await this.sessions.authenticate(rawToken);
    if (session === null)
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: 'Session is invalid or expired',
      });
    const method = bearer === undefined ? 'cookie' : 'bearer';
    if (method === 'cookie' && !SAFE_METHODS.has(request.method)) {
      const origin = request.get('origin');
      const headerToken = request.get('x-csrf-token');
      const cookieCsrf = cookies[this.csrfCookieName];
      if (
        origin === undefined ||
        !this.allowedOrigins.has(origin) ||
        headerToken === undefined ||
        cookieCsrf === undefined ||
        headerToken !== cookieCsrf ||
        !constantTimeTokenMatch(headerToken, session.csrfTokenHash)
      )
        throw new ForbiddenException({
          code: 'CSRF_VALIDATION_FAILED',
          message: 'CSRF validation failed',
        });
    }
    request.authenticatedUserId = session.userId;
    request.authenticatedSessionId = session.id;
    request.authenticatedRoles = session.roles;
    request.authenticationAt = session.authenticationAt;
    request.authenticationMethod = method;
    next();
  }
}

export function parseCookies(
  value: string | undefined,
): Record<string, string> {
  if (value === undefined) return {};
  const result: Record<string, string> = {};
  for (const part of value.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    try {
      result[key] = decodeURIComponent(raw);
    } catch {
      // Malformed cookies are ignored and can never authenticate a request.
    }
  }
  return result;
}

export function parseBearer(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]{32,512})$/u.exec(value);
  if (match === null)
    throw new UnauthorizedException({
      code: 'AUTHORIZATION_HEADER_INVALID',
      message: 'Authorization header is invalid',
    });
  return match[1];
}
