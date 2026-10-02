import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Environment } from '@docoo/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { API_CONFIG } from '../tokens.js';
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from './auth.cookies.js';
import {
  PASSWORD_RESET_DELIVERY,
  resetUrl,
  type PasswordResetDelivery,
} from './auth.reset-delivery.js';
import { AuthService, PASSWORD_MAX_LENGTH, type AuthRequestMetadata } from './auth.service.js';

const identifierSchema = z.string().trim().email().max(320);
const loginSchema = z.object({
  identifier: identifierSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
const resetRequestSchema = z.object({ identifier: identifierSchema }).strict();
const resetSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/),
    newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

function invalid(code: string, detail: string): BadRequestException {
  return new BadRequestException({ status: 400, title: 'Invalid request', code, detail });
}

export function requestMetadata(request: FastifyRequest): AuthRequestMetadata {
  const userAgent = request.headers['user-agent'];
  const origin = request.headers.origin;
  const fetchSite = request.headers['sec-fetch-site'];
  return {
    correlationId: request.id,
    ...(origin ? { origin } : {}),
    ...(typeof fetchSite === 'string' ? { fetchSite } : {}),
    ...(request.ip ? { ip: request.ip } : {}),
    ...(typeof userAgent === 'string' ? { userAgent } : {}),
  };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    @Inject(PASSWORD_RESET_DELIVERY) private readonly resetDelivery: PasswordResetDelivery,
    @Inject(API_CONFIG) private readonly config: Environment,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create an administrator session' })
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw invalid('AUTH_INVALID_REQUEST', 'Provide a valid email address and password.');
    }

    const metadata = requestMetadata(request);
    this.authService.assertSameOrigin(metadata);
    const result = await this.authService.login(
      parsed.data.identifier,
      parsed.data.password,
      metadata,
    );
    setSessionCookie(reply, result.token, result.maxAgeSeconds, this.authService.secureCookies);
    return { user: result.user, workspaces: result.workspaces };
  }

  @Get('session')
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOperation({ summary: 'Get the current administrator session' })
  async session(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const token = request.cookies[SESSION_COOKIE];
    const session = await this.authService.currentSession(token);
    if (token) {
      setSessionCookie(reply, token, session.maxAgeSeconds, this.authService.secureCookies);
    }
    return { user: session.user, workspaces: session.workspaces };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOperation({ summary: 'Revoke the current administrator session' })
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    const metadata = requestMetadata(request);
    this.authService.assertSameOrigin(metadata);
    await this.authService.logout(request.cookies[SESSION_COOKIE], metadata);
    clearSessionCookie(reply, this.authService.secureCookies);
  }

  @Post('password/reset-request')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a password reset link (generic response)' })
  async requestReset(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    const parsed = resetRequestSchema.safeParse(body);
    if (!parsed.success) throw invalid('AUTH_INVALID_REQUEST', 'Provide a valid email address.');
    const metadata = requestMetadata(request);
    this.authService.assertSameOrigin(metadata);
    const issued = await this.authService.requestPasswordReset(parsed.data.identifier, metadata);
    if (issued) {
      await this.resetDelivery.deliver({
        email: issued.email,
        resetUrl: resetUrl(this.config.WEB_ORIGIN, issued.token),
      });
    }
    return { accepted: true };
  }

  @Post('password/reset')
  @HttpCode(204)
  @ApiOperation({ summary: 'Set a new password with a single-use reset token' })
  async reset(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) {
      throw invalid('AUTH_RESET_TOKEN_INVALID', 'The reset link is invalid or has expired.');
    }
    const metadata = requestMetadata(request);
    this.authService.assertSameOrigin(metadata);
    await this.authService.resetPassword(parsed.data.token, parsed.data.newPassword, metadata);
    clearSessionCookie(reply, this.authService.secureCookies);
  }
}

@ApiTags('auth')
@ApiCookieAuth(SESSION_COOKIE)
@Controller('me')
export class MeController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'Get the signed-in administrator' })
  async me(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const session = await this.authService.currentSession(request.cookies[SESSION_COOKIE]);
    return { user: session.user, workspaces: session.workspaces };
  }

  @Delete('sessions')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke every session of the signed-in administrator' })
  async revokeSessions(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    const metadata = requestMetadata(request);
    this.authService.assertSameOrigin(metadata);
    await this.authService.revokeAllSessions(request.cookies[SESSION_COOKIE], metadata);
    clearSessionCookie(reply, this.authService.secureCookies);
  }

  @Post('password')
  @HttpCode(204)
  @ApiOperation({ summary: 'Change the password; revokes all sessions and rotates this one' })
  async changePassword(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw invalid('AUTH_INVALID_REQUEST', 'Provide the current and the new password.');
    }
    const metadata = requestMetadata(request);
    this.authService.assertSameOrigin(metadata);
    const issued = await this.authService.changePassword(
      request.cookies[SESSION_COOKIE],
      parsed.data.currentPassword,
      parsed.data.newPassword,
      metadata,
    );
    setSessionCookie(reply, issued.token, issued.maxAgeSeconds, this.authService.secureCookies);
  }
}
