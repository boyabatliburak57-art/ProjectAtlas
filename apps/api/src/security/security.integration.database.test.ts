import 'reflect-metadata';

import type { Server } from 'node:http';

import {
  authSessions,
  createDatabase,
  operationalAuditEvents,
  runMigrations,
  securityRateLimitBuckets,
  securityUsers,
} from '@atlas/database';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../app.module';
import { configureApplication } from '../bootstrap/configure-application';
import { TelemetryService } from '../observability/telemetry.service';
import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';
import { AbusePreventionMiddleware } from './abuse-prevention.middleware';
import { AuthSessionService } from './auth-session.service';
import { hashPassword } from './security-crypto';

const regularUserId = '00000000-0000-4000-8000-000000007501';
const adminUserId = '00000000-0000-4000-8000-000000007502';
const deletionUserId = '00000000-0000-4000-8000-000000007503';
const password = 'Secure-Password-2026!';

describe('production security authority', () => {
  const { db, pool } = createDatabase(requireTestDatabaseUrl());
  let application: INestApplication;
  let sessions: AuthSessionService;

  beforeAll(async () => {
    await pool.query('drop schema if exists public cascade');
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('create schema public');
    await runMigrations(db);
    const passwordHash = await hashPassword(password);
    await db.insert(securityUsers).values([
      {
        email: 'regular@example.test',
        id: regularUserId,
        normalizedEmail: 'regular@example.test',
        passwordHash,
        roles: [],
      },
      {
        email: 'admin@example.test',
        id: adminUserId,
        normalizedEmail: 'admin@example.test',
        passwordHash,
        roles: ['operations_admin'],
      },
      {
        email: 'deletion@example.test',
        id: deletionUserId,
        normalizedEmail: 'deletion@example.test',
        passwordHash,
        roles: [],
      },
    ]);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ApiDatabase)
      .useValue({ database: db, pool })
      .compile();
    application = module.createNestApplication({ logger: false });
    configureApplication(application);
    await application.init();
    sessions = application.get(AuthSessionService);
  }, 30_000);

  afterAll(async () => {
    await Promise.allSettled([application?.close(), pool.end()]);
  });

  it('rotates sessions, rejects fixation/replay and invalidates logout', async () => {
    const issued = await sessions.login(
      { email: 'regular@example.test', password },
      { ip: '127.0.0.1', userAgent: 'security-test' },
    );
    const rotated = await sessions.rotate(issued.token, {
      ip: '127.0.0.1',
      userAgent: 'security-test',
    });
    expect(rotated.token).not.toBe(issued.token);
    await expect(sessions.authenticate(issued.token)).resolves.toBeNull();
    await expect(sessions.authenticate(rotated.token)).resolves.toMatchObject({
      userId: regularUserId,
    });
    await sessions.logout(rotated.token);
    await expect(sessions.authenticate(rotated.token)).resolves.toBeNull();
  });

  it('enforces concurrent-session policy and disabled accounts', async () => {
    const created = [];
    for (let index = 0; index < 6; index += 1)
      created.push(
        await sessions.login(
          { email: 'regular@example.test', password },
          { ip: `127.0.0.${index + 1}`, userAgent: 'security-test' },
        ),
      );
    await expect(sessions.authenticate(created[0]!.token)).resolves.toBeNull();
    await db
      .update(securityUsers)
      .set({ accountStatus: 'disabled' })
      .where(eq(securityUsers.id, regularUserId));
    await expect(
      sessions.authenticate(created.at(-1)!.token),
    ).resolves.toBeNull();
    await db
      .update(securityUsers)
      .set({ accountStatus: 'active' })
      .where(eq(securityUsers.id, regularUserId));
  });

  it('expires reset tokens, accepts one use and revokes the session family', async () => {
    const previousEnvironment = process.env['ATLAS_ENV'];
    process.env['ATLAS_ENV'] = 'test';
    try {
      const issued = await sessions.login(
        { email: 'regular@example.test', password },
        { ip: '127.0.0.1', userAgent: 'security-test' },
      );
      const requested = await sessions.requestPasswordReset({
        email: 'regular@example.test',
      });
      const superseded = await sessions.requestPasswordReset({
        email: 'regular@example.test',
      });
      expect(requested.token).toBeDefined();
      await sessions.confirmPasswordReset({
        password: 'New-Secure-Password-2026!',
        token: requested.token,
      });
      await expect(sessions.authenticate(issued.token)).resolves.toBeNull();
      await expect(
        sessions.confirmPasswordReset({
          password: 'Another-Secure-Password-2026!',
          token: requested.token,
        }),
      ).rejects.toMatchObject({
        response: { code: 'PASSWORD_RESET_TOKEN_INVALID' },
      });
      await expect(
        sessions.confirmPasswordReset({
          password: 'Another-Secure-Password-2026!',
          token: superseded.token,
        }),
      ).rejects.toMatchObject({
        response: { code: 'PASSWORD_RESET_TOKEN_INVALID' },
      });
      const expired = await sessions.requestPasswordReset({
        email: 'regular@example.test',
      });
      await expect(
        sessions.confirmPasswordReset(
          {
            password: 'Another-Secure-Password-2026!',
            token: expired.token,
          },
          new Date(Date.now() + 3_600_000),
        ),
      ).rejects.toMatchObject({
        response: { code: 'PASSWORD_RESET_TOKEN_INVALID' },
      });
    } finally {
      if (previousEnvironment === undefined) delete process.env['ATLAS_ENV'];
      else process.env['ATLAS_ENV'] = previousEnvironment;
    }
  });

  it('denies caller-asserted admin roles and audits authorized admin mutations', async () => {
    const regular = await sessions.login(
      { email: 'regular@example.test', password: 'New-Secure-Password-2026!' },
      { ip: '127.0.0.1', userAgent: 'security-test' },
    );
    const admin = await sessions.login(
      { email: 'admin@example.test', password },
      { ip: '127.0.0.1', userAgent: 'security-test' },
    );
    const server = application.getHttpServer() as Server;
    await request(server)
      .post('/api/v1/admin/incidents')
      .set('authorization', `Bearer ${regular.token}`)
      .set('x-atlas-admin-role', 'operations')
      .send({ severity: 'SEV-3', summary: 'denied', title: 'denied' })
      .expect(403);
    const created = await request(server)
      .post('/api/v1/admin/incidents')
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        severity: 'SEV-3',
        summary: 'Security integration incident',
        title: 'Security integration',
      })
      .expect(201);
    const createdBody = created.body as {
      data: { commanderUserId: string; id: string };
    };
    expect(createdBody.data.commanderUserId).toBe(adminUserId);
    const audits = await db
      .select()
      .from(operationalAuditEvents)
      .where(eq(operationalAuditEvents.resourceId, createdBody.data.id));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'incident.create',
      actorUserId: adminUserId,
    });
  });

  it('denies identity-header spoofing across every private API resource family', async () => {
    const server = application.getHttpServer() as Server;
    const portfolioId = '00000000-0000-4000-8000-000000007599';
    const privatePaths = [
      '/api/v1/saved-scans',
      '/api/v1/scanner/runs/00000000-0000-4000-8000-000000007598',
      '/api/v1/alerts',
      '/api/v1/watchlists',
      '/api/v1/notifications',
      '/api/v1/portfolios',
      `/api/v1/portfolios/${portfolioId}/transactions`,
      `/api/v1/portfolios/${portfolioId}/imports/00000000-0000-4000-8000-000000007597`,
      `/api/v1/portfolios/${portfolioId}/exports/transactions`,
      '/api/v1/strategies',
      '/api/v1/backtests',
      '/api/v1/experiments',
      '/api/v1/admin/incidents',
      '/api/v1/admin/operations/feature-flags',
      '/api/v1/admin/operations/releases',
    ];
    for (const path of privatePaths)
      await request(server)
        .get(path)
        .set('x-user-id', regularUserId)
        .set('x-test-user-id', regularUserId)
        .set('x-atlas-admin-role', 'operations_admin')
        .expect(401);
  });

  it('enforces CSRF for cookie authentication and explicit CORS allowlist', async () => {
    const server = application.getHttpServer() as Server;
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.test', password })
      .expect(200);
    const cookies = login.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieHeader = Array.isArray(cookies)
      ? cookies.map(firstCookie).join('; ')
      : firstCookie(cookies!);
    await request(server)
      .post('/api/v1/admin/incidents')
      .set('cookie', cookieHeader)
      .send({ severity: 'SEV-3', summary: 'csrf', title: 'csrf' })
      .expect(403);
    const csrf = cookieValue(cookieHeader, 'atlas_csrf');
    await request(server)
      .post('/api/v1/admin/incidents')
      .set('cookie', cookieHeader)
      .set('origin', 'http://localhost:3000')
      .set('x-csrf-token', csrf)
      .send({ severity: 'SEV-3', summary: 'csrf pass', title: 'csrf pass' })
      .expect(201);
    const deniedCors = await request(server)
      .options('/api/v1/portfolios')
      .set('origin', 'https://evil.example');
    expect(deniedCors.headers['access-control-allow-origin']).toBeUndefined();
    const allowedCors = await request(server)
      .options('/api/v1/portfolios')
      .set('origin', 'http://localhost:3000')
      .expect(204);
    expect(allowedCors.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(allowedCors.headers['access-control-allow-credentials']).toBe(
      'true',
    );
  });

  it('requires admin re-authentication, explicit confirmation and environment isolation', async () => {
    const admin = await sessions.login(
      { email: 'admin@example.test', password },
      { ip: '127.0.0.1', userAgent: 'security-test' },
    );
    const server = application.getHttpServer() as Server;
    const created = await request(server)
      .post('/api/v1/admin/operations/feature-flags')
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        description: 'Emergency scanner disable control',
        flagType: 'kill_switch',
        key: 'scanner.emergency-disable',
        owner: 'platform-security',
      })
      .expect(201);
    const flag = created.body as { data: { id: string } };
    await request(server)
      .post(`/api/v1/admin/operations/feature-flags/${flag.data.id}/versions`)
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        enabled: true,
        environment: 'test',
        reason: 'Security integration validation',
      })
      .expect(400);
    await request(server)
      .post(`/api/v1/admin/operations/feature-flags/${flag.data.id}/versions`)
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        confirmation: 'CONFIRM_OPERATIONAL_CHANGE',
        enabled: true,
        environment: 'test',
        reason: 'Security integration validation',
        targetingRules: { password: 'must-never-be-a-rule' },
      })
      .expect(400);
    await request(server)
      .post(`/api/v1/admin/operations/feature-flags/${flag.data.id}/versions`)
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        confirmation: 'CONFIRM_OPERATIONAL_CHANGE',
        enabled: true,
        environment: 'test',
        reason: 'Security integration validation',
        rolloutPercentage: 100,
        targetingRules: { cohort: 'security-fixture' },
      })
      .expect(201);
    await request(server)
      .post('/api/v1/admin/operations/releases')
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        commitSha: 'abcdef1234567890',
        confirmation: 'CONFIRM_RELEASE_RECORD',
        environment: 'staging',
        imageDigest: `sha256:${'a'.repeat(64)}`,
        version: 'v0.9-security-fixture',
      })
      .expect(201);
    const audit = await request(server)
      .get('/api/v1/admin/operations/audit')
      .set('authorization', `Bearer ${admin.token}`)
      .expect(200);
    const body = audit.body as { data: { items: readonly unknown[] } };
    expect(body.data.items.length).toBeGreaterThanOrEqual(3);
  });

  it('enforces optimistic flag versions and a kill switch on the real backtest create path', async () => {
    const admin = await sessions.login(
      { email: 'admin@example.test', password },
      { ip: '127.0.0.1', userAgent: 'feature-flag-test' },
    );
    const user = await sessions.login(
      {
        email: 'regular@example.test',
        password: 'New-Secure-Password-2026!',
      },
      { ip: '127.0.0.1', userAgent: 'feature-flag-test' },
    );
    const server = application.getHttpServer() as Server;
    await request(server)
      .post('/api/v1/admin/feature-flags/backtests.creation.disabled/versions')
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        confirmation: 'CONFIRM_OPERATIONAL_CHANGE',
        enabled: true,
        environment: 'test',
        expectedVersion: 0,
        reason: 'Reject stale operations version',
      })
      .expect(409);
    await request(server)
      .post('/api/v1/backtests')
      .set('authorization', `Bearer ${user.token}`)
      .set('idempotency-key', 'task-077-cache-prewarm')
      .send({})
      .expect(400);
    await request(server)
      .post('/api/v1/admin/feature-flags/backtests.creation.disabled/versions')
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        confirmation: 'CONFIRM_OPERATIONAL_CHANGE',
        enabled: true,
        environment: 'test',
        expectedVersion: 1,
        reason: 'Incident mitigation test switch',
      })
      .expect(201);
    await request(server)
      .post('/api/v1/backtests')
      .set('authorization', `Bearer ${user.token}`)
      .set('idempotency-key', 'task-077-kill-switch-path')
      .send({})
      .expect(503);
    const history = await request(server)
      .get('/api/v1/admin/feature-flags/backtests.creation.disabled/history')
      .set('authorization', `Bearer ${admin.token}`)
      .expect(200);
    const historyBody = history.body as {
      data: { flag: { id: string }; versions: readonly unknown[] };
    };
    expect(historyBody.data.versions).toHaveLength(2);
    const flagAudits = await db
      .select()
      .from(operationalAuditEvents)
      .where(eq(operationalAuditEvents.resourceId, historyBody.data.flag.id));
    const enabledAudit = flagAudits.find(
      (event) => event.action === 'feature_flag.enable',
    );
    expect(enabledAudit).toMatchObject({
      action: 'feature_flag.enable',
      actorUserId: adminUserId,
      reason: 'Incident mitigation test switch',
      resourceType: 'feature_flag',
    });
    expect(enabledAudit?.afterState).not.toBeNull();
    expect(enabledAudit?.beforeState).not.toBeNull();
    expect(enabledAudit?.correlationId).toBeTruthy();
    expect(enabledAudit?.requestId).toBeTruthy();
    await request(server)
      .post('/api/v1/admin/feature-flags/backtests.creation.disabled/versions')
      .set('authorization', `Bearer ${admin.token}`)
      .send({
        confirmation: 'CONFIRM_OPERATIONAL_CHANGE',
        enabled: false,
        environment: 'test',
        expectedVersion: 2,
        reason: 'Restore safe test state',
      })
      .expect(201);
  });

  it('enforces shared IP rate limits with Retry-After', async () => {
    await db.delete(securityRateLimitBuckets);
    const middleware = new AbusePreventionMiddleware(
      { database: db } as ApiDatabase,
      application.get(TelemetryService),
      new ConfigService({
        AUTH_SESSION_HMAC_KEY: 'test-auth-session-hmac-key-000000',
        SECURITY_RATE_LIMIT_ENABLED: true,
      }),
    );
    const headers = new Map<string, string>();
    const response = {
      setHeader: (name: string, value: string) => headers.set(name, value),
    };
    const fakeRequest = {
      get: (name: string) => (name === 'content-length' ? '0' : undefined),
      ip: '198.51.100.10',
      method: 'POST',
      path: '/api/v1/auth/login',
      query: {},
      socket: {},
    };
    for (let index = 0; index < 5; index += 1)
      await middleware.use(
        fakeRequest as never,
        response as never,
        () => undefined,
      );
    await expect(
      middleware.use(fakeRequest as never, response as never, () => undefined),
    ).rejects.toMatchObject({ status: 429 });
    expect(headers.get('Retry-After')).toMatch(/^\d+$/u);
  });

  it('cannot bypass the user limiter by rotating forwarded IP context', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-21T12:00:30.000Z'));
    await db.delete(securityRateLimitBuckets);
    const middleware = new AbusePreventionMiddleware(
      { database: db } as ApiDatabase,
      application.get(TelemetryService),
      new ConfigService({
        AUTH_SESSION_HMAC_KEY: 'test-auth-session-hmac-key-000000',
        SECURITY_RATE_LIMIT_ENABLED: true,
      }),
    );
    const response = { setHeader: () => undefined };
    try {
      for (let index = 0; index < 5; index += 1) {
        await middleware.use(
          {
            authenticatedUserId: regularUserId,
            get: () => undefined,
            ip: `198.51.100.${index + 1}`,
            method: 'POST',
            path: '/api/v1/experiments',
            query: {},
            socket: {},
          } as never,
          response as never,
          () => undefined,
        );
      }
      await expect(
        middleware.use(
          {
            authenticatedUserId: regularUserId,
            get: () => undefined,
            ip: '203.0.113.250',
            method: 'POST',
            path: '/api/v1/experiments',
            query: {},
            socket: {},
          } as never,
          response as never,
          () => undefined,
        ),
      ).rejects.toMatchObject({ status: 429 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('limits a login identity across distinct source IP addresses', async () => {
    await db.delete(securityRateLimitBuckets);
    const middleware = new AbusePreventionMiddleware(
      { database: db } as ApiDatabase,
      application.get(TelemetryService),
      new ConfigService({
        AUTH_SESSION_HMAC_KEY: 'test-auth-session-hmac-key-000000',
        SECURITY_RATE_LIMIT_ENABLED: true,
      }),
    );
    const response = { setHeader: () => undefined };
    const loginRequest = (index: number) => ({
      body: { email: 'TARGET@EXAMPLE.TEST', password: 'invalid' },
      get: () => undefined,
      ip: `203.0.113.${index + 1}`,
      method: 'POST',
      path: '/api/v1/auth/login',
      query: {},
      socket: {},
    });
    for (let index = 0; index < 5; index += 1)
      await middleware.use(
        loginRequest(index) as never,
        response as never,
        () => undefined,
      );
    await expect(
      middleware.use(
        loginRequest(20) as never,
        response as never,
        () => undefined,
      ),
    ).rejects.toMatchObject({ status: 429 });
  });

  it('uses only hashed session and context material in persistence', async () => {
    const rows = await db.select().from(authSessions);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(row.csrfTokenHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(row.ipHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(row.userAgentHash).toMatch(/^[a-f0-9]{64}$/u);
    }
  });

  it('disables only the authenticated account and rejects deletion IDOR input', async () => {
    const issued = await sessions.login(
      { email: 'deletion@example.test', password },
      { ip: '127.0.0.1', userAgent: 'deletion-security-test' },
    );
    await request(application.getHttpServer() as Server)
      .post('/api/v1/account/deletion')
      .set('authorization', `Bearer ${issued.token}`)
      .send({
        idempotencyKey: 'account-deletion-security-076',
        targetUserId: adminUserId,
      })
      .expect(201);
    const users = await db
      .select()
      .from(securityUsers)
      .where(eq(securityUsers.id, deletionUserId));
    expect(users[0]?.accountStatus).toBe('disabled');
    const admins = await db
      .select()
      .from(securityUsers)
      .where(eq(securityUsers.id, adminUserId));
    expect(admins[0]?.accountStatus).toBe('active');
    await request(application.getHttpServer() as Server)
      .post('/api/v1/account/deletion')
      .send({ idempotencyKey: 'unauthenticated-deletion-076' })
      .expect(401);
  });
});

function requireTestDatabaseUrl(): string {
  const value = process.env['TEST_DATABASE_URL'];
  if (
    value === undefined ||
    !new URL(value).pathname.slice(1).endsWith('_test')
  )
    throw new Error('TEST_DATABASE_URL with an _test database is required');
  return value;
}

function firstCookie(value: string): string {
  return value.split(';')[0]!;
}

function cookieValue(header: string, name: string): string {
  const item = header.split('; ').find((value) => value.startsWith(`${name}=`));
  if (item === undefined) throw new Error(`Cookie ${name} was not issued`);
  return decodeURIComponent(item.slice(name.length + 1));
}
