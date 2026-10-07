import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { pageQuerySchema } from '../common/pagination.js';
import { badRequest, notFound } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { NotificationsService } from './notifications.service.js';

const listQuery = z
  .object({
    status: z.enum(['unread', 'all']).default('unread'),
    ...pageQuerySchema,
  })
  .strict();

@ApiTags('notifications')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'How many notifications are unread' })
  @RequireWorkspacePermission('workspace.read')
  async summary(@Req() request: FastifyRequest) {
    return this.notifications.summary(workspaceContext(request));
  }

  @Get()
  @ApiOperation({ summary: 'Notifications, newest first' })
  @RequireWorkspacePermission('workspace.read')
  async list(@Req() request: FastifyRequest, @Query() query: unknown) {
    const parsed = listQuery.safeParse(query ?? {});
    if (!parsed.success) {
      throw badRequest('NOTIFICATION_INVALID_REQUEST', 'Provide a valid notification request.');
    }
    return this.notifications.list(workspaceContext(request), parsed.data);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark every notification read' })
  @RequireWorkspacePermission('workspace.read')
  async readAll(@Req() request: FastifyRequest) {
    return this.notifications.markAllRead(workspaceContext(request));
  }

  @Post(':notificationId/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one notification read' })
  @RequireWorkspacePermission('workspace.read')
  async read(@Req() request: FastifyRequest, @Param('notificationId') raw: string) {
    if (!isUuid(raw)) {
      throw badRequest('NOTIFICATION_INVALID_REQUEST', 'Provide a valid notification request.');
    }
    const { found } = await this.notifications.markRead(
      workspaceContext(request),
      raw.toLowerCase(),
    );
    if (!found) throw notFound('NOTIFICATION_NOT_FOUND', 'The notification was not found.');
    return { read: true };
  }
}
