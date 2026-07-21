import type { Request, Response } from 'express';
import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { getRequestId } from '../common/http/request-context';
import { AuthSessionService, type IssuedSession } from './auth-session.service';
import { parseBearer, parseCookies } from './authentication.middleware';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly cookieName: string;
  private readonly csrfCookieName: string;
  private readonly secure: boolean;

  constructor(
    private readonly sessions: AuthSessionService,
    config: ConfigService,
  ) {
    this.cookieName = config.getOrThrow<string>('AUTH_COOKIE_NAME');
    this.csrfCookieName = config.getOrThrow<string>('AUTH_CSRF_COOKIE_NAME');
    this.secure = ['staging', 'production'].includes(
      config.getOrThrow<string>('ATLAS_ENV'),
    );
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate and issue a rotated secure session' })
  @ApiOkResponse({ description: 'Secure session cookie issued' })
  @ApiUnauthorizedResponse({ description: 'Authentication failed' })
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    const session = await this.sessions.login(body, requestContext(request));
    this.writeCookies(response, session);
    return this.response(request, session);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the current session' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = await this.sessions.rotate(
      this.rawToken(request),
      requestContext(request),
    );
    this.writeCookies(response, session);
    return this.response(request, session);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.logout(this.rawToken(request));
    this.clearCookies(response);
  }

  @Post('password-reset/request')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a non-enumerating password reset' })
  async requestReset(@Req() request: Request, @Body() body: unknown) {
    const testing = await this.sessions.requestPasswordReset(body);
    return {
      data: {
        accepted: true,
        ...(testing.token === undefined ? {} : { testToken: testing.token }),
      },
      meta: { requestId: getRequestId(request) },
    };
  }

  @Post('password-reset/confirm')
  @HttpCode(204)
  @ApiBadRequestResponse({ description: 'Reset token invalid or expired' })
  async confirmReset(@Body() body: unknown): Promise<void> {
    await this.sessions.confirmPasswordReset(body);
  }

  private rawToken(request: Request): string {
    const token =
      parseBearer(request.get('authorization')) ??
      parseCookies(request.get('cookie'))[this.cookieName];
    if (token === undefined)
      throw new UnauthorizedException({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication is required',
      });
    return token;
  }

  private writeCookies(response: Response, session: IssuedSession): void {
    const maximumAge = Math.max(0, session.expiresAt.getTime() - Date.now());
    response.cookie(this.cookieName, session.token, {
      httpOnly: true,
      maxAge: maximumAge,
      path: '/',
      sameSite: 'strict',
      secure: this.secure,
    });
    response.cookie(this.csrfCookieName, session.csrfToken, {
      httpOnly: false,
      maxAge: maximumAge,
      path: '/',
      sameSite: 'strict',
      secure: this.secure,
    });
  }

  private clearCookies(response: Response): void {
    const options = {
      path: '/',
      sameSite: 'strict' as const,
      secure: this.secure,
    };
    response.clearCookie(this.cookieName, { ...options, httpOnly: true });
    response.clearCookie(this.csrfCookieName, {
      ...options,
      httpOnly: false,
    });
  }

  private response(request: Request, session: IssuedSession) {
    return {
      data: {
        expiresAt: session.expiresAt.toISOString(),
        roles: session.roles,
        userId: session.userId,
      },
      meta: { requestId: getRequestId(request) },
    };
  }
}

function requestContext(request: Request) {
  return {
    ip: request.ip || request.socket.remoteAddress || 'unknown',
    userAgent: request.get('user-agent') ?? 'unknown',
  } as const;
}
