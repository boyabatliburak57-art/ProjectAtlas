import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import { AuthController } from './auth.controller';
import { OperationalControlsService } from '../operations/operational-controls.service';
import type { AuthSessionService, IssuedSession } from './auth-session.service';
import { parseBearer, parseCookies } from './authentication.middleware';
import { hashPassword, verifyPassword, hashToken } from './security-crypto';
import {
  requireOperationsPrincipal,
  type SecurityPrincipalResolver,
} from './security-principal';
import { securityHeaders } from './security-headers';

describe('security runtime primitives', () => {
  it('hashes passwords and tokens without persisting plaintext', async () => {
    const encoded = await hashPassword('Secure-Password-2026!');
    expect(encoded).not.toContain('Secure-Password-2026!');
    await expect(
      verifyPassword('Secure-Password-2026!', encoded),
    ).resolves.toBe(true);
    await expect(verifyPassword('wrong', encoded)).resolves.toBe(false);
    expect(hashToken('token')).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('parses cookies defensively and rejects malformed bearer syntax', () => {
    expect(
      parseCookies('atlas_session=abc%20123; malformed; safe=value'),
    ).toEqual({
      atlas_session: 'abc 123',
      safe: 'value',
    });
    expect(() => parseBearer('Basic unsafe')).toThrow();
  });

  it('sets the mandatory browser security headers', () => {
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
    } as unknown as Response;
    securityHeaders('production')({} as Request, response, () => undefined);
    expect(headers.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers.get('Strict-Transport-Security')).toContain(
      'max-age=31536000',
    );
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
  });

  it('uses only a server-side operations role and requires recent authentication', () => {
    const request = {} as Request;
    const regular: SecurityPrincipalResolver = () => ({
      authenticatedAt: new Date(),
      method: 'bearer',
      roles: [],
      sessionId: 'session',
      userId: 'user',
    });
    expect(() => requireOperationsPrincipal(request, regular, 900)).toThrow();
    const stale: SecurityPrincipalResolver = () => ({
      authenticatedAt: new Date('2026-01-01T00:00:00Z'),
      method: 'bearer',
      roles: ['operations_admin'],
      sessionId: 'session',
      userId: 'user',
    });
    expect(() =>
      requireOperationsPrincipal(
        request,
        stale,
        900,
        new Date('2026-01-01T01:00:00Z'),
      ),
    ).toThrow();
  });

  it('rejects operational changes targeting another deployment environment', async () => {
    const service = new OperationalControlsService(
      { database: {} } as never,
      new ConfigService({ ATLAS_ENV: 'staging' }),
    );
    await expect(
      service.createRelease(
        { userId: 'admin' },
        {
          commitSha: 'abcdef1234567890',
          confirmation: 'CONFIRM_RELEASE_RECORD',
          environment: 'production',
          imageDigest: `sha256:${'a'.repeat(64)}`,
          version: 'v0.9',
        },
      ),
    ).rejects.toMatchObject({
      response: { code: 'OPERATIONAL_ENVIRONMENT_MISMATCH' },
    });
  });

  it('issues Secure, HttpOnly and SameSite cookies in staging', async () => {
    const session: IssuedSession = {
      authenticationAt: new Date(),
      csrfToken: 'csrf-token',
      csrfTokenHash: hashToken('csrf-token'),
      expiresAt: new Date(Date.now() + 60_000),
      id: 'session-id',
      roles: [],
      token: 'session-token',
      userId: 'user-id',
    };
    const sessions = {
      login: vi.fn().mockResolvedValue(session),
    } as unknown as AuthSessionService;
    const controller = new AuthController(
      sessions,
      new ConfigService({
        ATLAS_ENV: 'staging',
        AUTH_COOKIE_NAME: 'atlas_session',
        AUTH_CSRF_COOKIE_NAME: 'atlas_csrf',
      }),
    );
    const cookies: Array<{ name: string; options: Record<string, unknown> }> =
      [];
    const response = {
      cookie: (
        name: string,
        _value: string,
        options: Record<string, unknown>,
      ) => cookies.push({ name, options }),
    } as unknown as Response;
    await controller.login(
      {
        headers: { 'user-agent': 'test' },
        ip: '127.0.0.1',
        requestId: 'request-id',
        socket: {},
        get: (name: string) =>
          name.toLowerCase() === 'user-agent' ? 'test' : undefined,
      } as unknown as Request,
      response,
      { email: 'user@example.test', password: 'irrelevant' },
    );
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatchObject({
      name: 'atlas_session',
      options: { httpOnly: true, sameSite: 'strict', secure: true },
    });
    expect(cookies[1]).toMatchObject({
      name: 'atlas_csrf',
      options: { httpOnly: false, sameSite: 'strict', secure: true },
    });
  });
});
