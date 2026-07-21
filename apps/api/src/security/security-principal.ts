import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

export interface SecurityPrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly roles: readonly string[];
  readonly authenticatedAt: Date;
  readonly method: 'bearer' | 'cookie';
}

export const SECURITY_PRINCIPAL_RESOLVER = Symbol(
  'SECURITY_PRINCIPAL_RESOLVER',
);

export type SecurityPrincipalResolver = (request: Request) => SecurityPrincipal;

export const requestSecurityPrincipal: SecurityPrincipalResolver = (
  request,
) => {
  if (
    request.authenticatedUserId === undefined ||
    request.authenticatedSessionId === undefined ||
    request.authenticationMethod === undefined ||
    request.authenticationAt === undefined
  )
    throw new UnauthorizedException({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required',
    });
  return {
    authenticatedAt: request.authenticationAt,
    method: request.authenticationMethod,
    roles: request.authenticatedRoles ?? [],
    sessionId: request.authenticatedSessionId,
    userId: request.authenticatedUserId,
  };
};

export function requireOperationsPrincipal(
  request: Request,
  resolve: SecurityPrincipalResolver,
  maximumAuthenticationAgeSeconds: number,
  now = new Date(),
): SecurityPrincipal {
  const principal = resolve(request);
  if (!principal.roles.includes('operations_admin'))
    throw new ForbiddenException({
      code: 'OPERATIONS_ROLE_REQUIRED',
      message: 'Operations role is required',
    });
  if (
    now.getTime() - principal.authenticatedAt.getTime() >
    maximumAuthenticationAgeSeconds * 1_000
  )
    throw new ForbiddenException({
      code: 'RECENT_AUTHENTICATION_REQUIRED',
      message: 'Recent authentication is required',
    });
  return principal;
}
