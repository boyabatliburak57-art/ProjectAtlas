import { randomUUID } from 'node:crypto';

import {
  authSessions,
  passwordResetTokens,
  securityUsers,
} from '@atlas/database';
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ApiDatabase } from '../scanner/scanner-runtime.infrastructure';
import {
  assertPasswordPolicy,
  hashPassword,
  hashSecurityContext,
  hashToken,
  randomSecurityToken,
  verifyPassword,
} from './security-crypto';

const loginInput = z.object({
  email: z.email().max(320),
  password: z.string().min(1).max(128),
});
const resetRequestInput = z.object({ email: z.email().max(320) });
const resetConfirmInput = z.object({
  token: z.string().min(32).max(512),
  password: z.string().min(12).max(128),
});
const DUMMY_PASSWORD_HASH =
  'scrypt-v1$AAAAAAAAAAAAAAAAAAAAAA$E848yD4ay48a4SNGmcL4p1X2Ijvu3nVRIK0Jy07tI1UOzJl8rUViFPa9ttuPS82icJhT3z2ZmfX-gUFlSyMFfw';

export interface AuthenticatedSession {
  readonly authenticationAt: Date;
  readonly csrfTokenHash: string;
  readonly id: string;
  readonly roles: readonly string[];
  readonly userId: string;
}

export interface IssuedSession extends AuthenticatedSession {
  readonly csrfToken: string;
  readonly expiresAt: Date;
  readonly token: string;
}

@Injectable()
export class AuthSessionService {
  private readonly contextHashKey: string;
  private readonly idleTtlSeconds: number;
  private readonly maximumSessions: number;
  private readonly resetTtlSeconds: number;
  private readonly sessionTtlSeconds: number;

  constructor(
    private readonly connection: ApiDatabase,
    config: ConfigService,
  ) {
    this.contextHashKey = config.getOrThrow<string>('AUTH_SESSION_HMAC_KEY');
    this.idleTtlSeconds = config.getOrThrow<number>('AUTH_IDLE_TTL_SECONDS');
    this.maximumSessions = config.getOrThrow<number>(
      'AUTH_MAX_CONCURRENT_SESSIONS',
    );
    this.resetTtlSeconds = config.getOrThrow<number>(
      'AUTH_PASSWORD_RESET_TTL_SECONDS',
    );
    this.sessionTtlSeconds = config.getOrThrow<number>(
      'AUTH_SESSION_TTL_SECONDS',
    );
  }

  async authenticate(
    rawToken: string,
    now = new Date(),
  ): Promise<AuthenticatedSession | null> {
    const rows = await this.connection.database
      .select({ session: authSessions, user: securityUsers })
      .from(authSessions)
      .innerJoin(securityUsers, eq(securityUsers.id, authSessions.userId))
      .where(eq(authSessions.tokenHash, hashToken(rawToken)))
      .limit(1);
    const row = rows[0];
    if (
      row === undefined ||
      row.session.revokedAt !== null ||
      row.session.expiresAt <= now ||
      row.session.idleExpiresAt <= now ||
      row.user.accountStatus !== 'active' ||
      row.session.sessionVersion !== row.user.sessionVersion
    )
      return null;
    const idleExpiresAt = new Date(now.getTime() + this.idleTtlSeconds * 1_000);
    await this.connection.database
      .update(authSessions)
      .set({ idleExpiresAt, lastSeenAt: now })
      .where(eq(authSessions.id, row.session.id));
    return {
      authenticationAt: row.session.authenticationAt,
      csrfTokenHash: row.session.csrfTokenHash,
      id: row.session.id,
      roles: parseRoles(row.user.roles),
      userId: row.user.id,
    };
  }

  async login(
    body: unknown,
    context: { readonly ip: string; readonly userAgent: string },
    now = new Date(),
  ): Promise<IssuedSession> {
    const value = parse(loginInput, body);
    const normalizedEmail = value.email.trim().toLowerCase();
    const rows = await this.connection.database
      .select()
      .from(securityUsers)
      .where(eq(securityUsers.normalizedEmail, normalizedEmail))
      .limit(1);
    const user = rows[0];
    const valid = await verifyPassword(
      value.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (user === undefined || !valid || user.accountStatus !== 'active') {
      throw invalidCredentials();
    }
    return this.issue(user, context, now);
  }

  async rotate(
    rawToken: string,
    context: { readonly ip: string; readonly userAgent: string },
    now = new Date(),
  ): Promise<IssuedSession> {
    const authenticated = await this.authenticate(rawToken, now);
    if (authenticated === null) throw invalidCredentials();
    return this.connection.database.transaction(async (transaction) => {
      const revoked = await transaction
        .update(authSessions)
        .set({ revokeReason: 'rotated', revokedAt: now })
        .where(
          and(
            eq(authSessions.id, authenticated.id),
            isNull(authSessions.revokedAt),
          ),
        )
        .returning({ id: authSessions.id });
      if (revoked.length !== 1) throw invalidCredentials();
      const rows = await transaction
        .select()
        .from(securityUsers)
        .where(eq(securityUsers.id, authenticated.userId))
        .limit(1);
      const user = rows[0];
      if (user === undefined || user.accountStatus !== 'active')
        throw invalidCredentials();
      const issued = await this.insertSession(transaction, user, context, now);
      await transaction
        .update(authSessions)
        .set({ replacedBySessionId: issued.id })
        .where(eq(authSessions.id, authenticated.id));
      return issued;
    });
  }

  async logout(rawToken: string, now = new Date()): Promise<void> {
    await this.connection.database
      .update(authSessions)
      .set({ revokeReason: 'logout', revokedAt: now })
      .where(
        and(
          eq(authSessions.tokenHash, hashToken(rawToken)),
          isNull(authSessions.revokedAt),
        ),
      );
  }

  async requestPasswordReset(
    body: unknown,
    now = new Date(),
  ): Promise<{ readonly token?: string }> {
    const value = parse(resetRequestInput, body);
    const rows = await this.connection.database
      .select({ id: securityUsers.id, status: securityUsers.accountStatus })
      .from(securityUsers)
      .where(
        eq(securityUsers.normalizedEmail, value.email.trim().toLowerCase()),
      )
      .limit(1);
    const user = rows[0];
    if (user === undefined || user.status !== 'active') return {};
    const token = randomSecurityToken();
    await this.connection.database.insert(passwordResetTokens).values({
      expiresAt: new Date(now.getTime() + this.resetTtlSeconds * 1_000),
      tokenHash: hashToken(token),
      userId: user.id,
    });
    return process.env['ATLAS_ENV'] === 'test' ? { token } : {};
  }

  async confirmPasswordReset(body: unknown, now = new Date()): Promise<void> {
    const value = parse(resetConfirmInput, body);
    try {
      assertPasswordPolicy(value.password);
    } catch {
      throw new BadRequestException({
        code: 'PASSWORD_POLICY_VIOLATION',
        message: 'Password does not meet the security policy',
      });
    }
    const encodedPassword = await hashPassword(value.password);
    await this.connection.database.transaction(async (transaction) => {
      const tokens = await transaction
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hashToken(value.token)),
            isNull(passwordResetTokens.usedAt),
            gt(passwordResetTokens.expiresAt, now),
          ),
        )
        .returning({ userId: passwordResetTokens.userId });
      const token = tokens[0];
      if (token === undefined)
        throw new BadRequestException({
          code: 'PASSWORD_RESET_TOKEN_INVALID',
          message: 'Password reset token is invalid or expired',
        });
      await transaction
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.userId, token.userId),
            isNull(passwordResetTokens.usedAt),
          ),
        );
      await transaction
        .update(securityUsers)
        .set({
          passwordChangedAt: now,
          passwordHash: encodedPassword,
          sessionVersion: sql`${securityUsers.sessionVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(securityUsers.id, token.userId));
      await transaction
        .update(authSessions)
        .set({ revokeReason: 'password_reset', revokedAt: now })
        .where(
          and(
            eq(authSessions.userId, token.userId),
            isNull(authSessions.revokedAt),
          ),
        );
    });
  }

  private async issue(
    user: typeof securityUsers.$inferSelect,
    context: { readonly ip: string; readonly userAgent: string },
    now: Date,
  ): Promise<IssuedSession> {
    return this.connection.database.transaction(async (transaction) => {
      await transaction
        .select({ id: securityUsers.id })
        .from(securityUsers)
        .where(eq(securityUsers.id, user.id))
        .for('update');
      const active = await transaction
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(
          and(
            eq(authSessions.userId, user.id),
            isNull(authSessions.revokedAt),
            gt(authSessions.expiresAt, now),
          ),
        )
        .orderBy(asc(authSessions.createdAt));
      const revokeCount = Math.max(0, active.length - this.maximumSessions + 1);
      for (const session of active.slice(0, revokeCount)) {
        await transaction
          .update(authSessions)
          .set({ revokeReason: 'concurrent_session_limit', revokedAt: now })
          .where(eq(authSessions.id, session.id));
      }
      return this.insertSession(transaction, user, context, now);
    });
  }

  private async insertSession(
    transaction: Parameters<
      Parameters<typeof this.connection.database.transaction>[0]
    >[0],
    user: typeof securityUsers.$inferSelect,
    context: { readonly ip: string; readonly userAgent: string },
    now: Date,
  ): Promise<IssuedSession> {
    const id = randomUUID();
    const token = randomSecurityToken();
    const csrfToken = randomSecurityToken();
    const expiresAt = new Date(now.getTime() + this.sessionTtlSeconds * 1_000);
    await transaction.insert(authSessions).values({
      authenticationAt: now,
      createdAt: now,
      csrfTokenHash: hashToken(csrfToken),
      expiresAt,
      id,
      idleExpiresAt: new Date(now.getTime() + this.idleTtlSeconds * 1_000),
      ipHash: hashSecurityContext(this.contextHashKey, context.ip),
      lastSeenAt: now,
      sessionVersion: user.sessionVersion,
      tokenHash: hashToken(token),
      userAgentHash: hashSecurityContext(
        this.contextHashKey,
        context.userAgent.slice(0, 512),
      ),
      userId: user.id,
    });
    return {
      authenticationAt: now,
      csrfToken,
      csrfTokenHash: hashToken(csrfToken),
      expiresAt,
      id,
      roles: parseRoles(user.roles),
      token,
      userId: user.id,
    };
  }
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: 'AUTH_REQUEST_INVALID',
      details: result.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join('.'),
      })),
      message: 'Authentication request is invalid',
    });
  return result.data;
}

function parseRoles(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((role): role is string => typeof role === 'string')
    : [];
}

function invalidCredentials(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'AUTHENTICATION_FAILED',
    message: 'Authentication failed',
  });
}
