import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

export const AUTHENTICATED_USER_RESOLVER = Symbol(
  'AUTHENTICATED_USER_RESOLVER',
);

export type AuthenticatedUserResolver = (request: Request) => string;

export const trustedRequestUserResolver: AuthenticatedUserResolver = (
  request,
) => {
  if (request.authenticatedUserId === undefined) {
    throw new UnauthorizedException({
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Authentication is required',
    });
  }
  return request.authenticatedUserId;
};
