import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AuthService, type AuthRequestMetadata } from './auth.service.js';

const loginSchema = z.object({
  identifier: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024),
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
      throw new BadRequestException({
        status: 400,
        title: 'Invalid request',
        code: 'AUTH_INVALID_REQUEST',
        detail: 'Provide a valid email address and password.',
      });
    }

    const metadata = this.requestMetadata(request);
    this.authService.assertSameOrigin(metadata);
    const result = await this.authService.login(
      parsed.data.identifier,
      parsed.data.password,
      metadata,
    );

    reply.setCookie('docoo_session', result.token, {
      httpOnly: true,
      secure: this.authService.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: result.maxAgeSeconds,
    });

    return { user: result.user, workspaces: result.workspaces };
  }

  @Get('session')
  @ApiCookieAuth('docoo_session')
  @ApiOperation({ summary: 'Get the current administrator session' })
  async session(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const token = request.cookies['docoo_session'];
    const session = await this.authService.currentSession(token);
    if (token) {
      reply.setCookie('docoo_session', token, {
        httpOnly: true,
        secure: this.authService.secureCookies,
        sameSite: 'lax',
        path: '/',
        maxAge: session.maxAgeSeconds,
      });
    }
    return { user: session.user, workspaces: session.workspaces };
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth('docoo_session')
  @ApiOperation({ summary: 'Revoke the current administrator session' })
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    reply.header('Cache-Control', 'no-store');
    const metadata = this.requestMetadata(request);
    this.authService.assertSameOrigin(metadata);
    const token = request.cookies['docoo_session'];
    await this.authService.logout(token, metadata);
    reply.clearCookie('docoo_session', {
      httpOnly: true,
      secure: this.authService.secureCookies,
      sameSite: 'lax',
      path: '/',
    });
  }

  private requestMetadata(request: FastifyRequest): AuthRequestMetadata {
    const userAgent = request.headers['user-agent'];
    const origin = request.headers.origin;
    const fetchSite = request.headers['sec-fetch-site'];
    return {
      correlationId: request.id,
      ...(origin ? { origin } : {}),
      ...(fetchSite ? { fetchSite } : {}),
      ...(request.ip ? { ip: request.ip } : {}),
      ...(typeof userAgent === 'string' ? { userAgent } : {}),
    };
  }
}
