import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiCookieAuth } from '@nestjs/swagger';
import { createMonitorShareLinkSchema, unlockMonitorShareSchema } from '@docoo/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { MonitorShareService } from './monitor-share.service.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/u;

function tokenOf(raw: string): string {
  if (!TOKEN.test(raw)) throw badRequest('MONITOR_INVALID_REQUEST', 'This link is not valid.');
  return raw;
}

/** The cookie of one link, so several links can be open in one browser. */
export const shareCookieName = (token: string): string => `docoo_ms_${token.slice(0, 16)}`;

/** The owner's side: make, list and end the share links of the monitors. */
@ApiTags('monitor')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/monitor/links')
export class MonitorShareAdminController {
  constructor(private readonly shares: MonitorShareService) {}

  @Get()
  @ApiOperation({ summary: 'The share links of the monitors' })
  @RequireWorkspacePermission('monitor.use')
  list(@Req() request: FastifyRequest) {
    return this.shares.list(workspaceContext(request));
  }

  @Post()
  @ApiOperation({ summary: 'Make a share link with a password, an expiry and a screen limit' })
  @RequireWorkspacePermission('monitor.use')
  create(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = createMonitorShareLinkSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw badRequest(
        'MONITOR_INVALID_REQUEST',
        'Provide a password of 8 to 128 characters, a future expiry or none, and 1 to 100 screens.',
      );
    }
    return this.shares.create(workspaceContext(request), parsed.data);
  }

  @Delete(':linkId')
  @HttpCode(204)
  @ApiOperation({ summary: 'End a share link now' })
  @RequireWorkspacePermission('monitor.use')
  async revoke(@Req() request: FastifyRequest, @Param('linkId') raw: string) {
    if (!isUuid(raw)) throw badRequest('MONITOR_INVALID_REQUEST', 'Provide a valid link id.');
    await this.shares.revoke(workspaceContext(request), raw.toLowerCase());
  }
}

/**
 * The visitor's side. No account: the address is the secret, the password and the room left are
 * checked here, and the answer is the same projection the owner's window uses.
 */
@ApiTags('monitor')
@Controller('public/monitor/:token')
export class MonitorSharePublicController {
  constructor(private readonly shares: MonitorShareService) {}

  @Get()
  @ApiOperation({ summary: 'Which monitor a share link opens (before the password)' })
  async info(@Param('token') raw: string, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    return this.shares.info(tokenOf(raw));
  }

  @Post('unlock')
  @HttpCode(204)
  @ApiOperation({ summary: 'Give the password and start watching' })
  async unlock(
    @Param('token') raw: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    const token = tokenOf(raw);
    const parsed = unlockMonitorShareSchema.safeParse(body ?? {});
    if (!parsed.success) throw badRequest('MONITOR_INVALID_REQUEST', 'Enter the password.');
    const { sessionToken, maxAgeS } = await this.shares.unlock(
      token,
      parsed.data.password,
      request.ip,
    );
    reply.setCookie(shareCookieName(token), sessionToken, {
      httpOnly: true,
      secure: this.shares.secureCookies,
      sameSite: 'strict',
      path: '/',
      maxAge: maxAgeS,
    });
  }

  @Get('view')
  @ApiOperation({ summary: 'What the shared monitor shows now' })
  async view(
    @Param('token') raw: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.header('Cache-Control', 'no-store');
    const token = tokenOf(raw);
    return this.shares.view(token, request.cookies?.[shareCookieName(token)]);
  }
}
