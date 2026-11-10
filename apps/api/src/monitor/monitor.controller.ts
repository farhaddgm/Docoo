import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { monitorAliasSchema, reportMonitorEventSchema } from '@docoo/contracts';
import type { FastifyRequest } from 'fastify';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { MonitorService } from './monitor.service.js';

function projectIdOf(raw: string): string {
  if (!isUuid(raw)) throw badRequest('MONITOR_INVALID_REQUEST', 'Provide a valid project id.');
  return raw.toLowerCase();
}

/**
 * The monitors (ADR-0056). Only a super administrator may use them. Writing the settings goes
 * through the general settings route, which is already for the owner alone.
 */
@ApiTags('monitor')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/monitor')
export class MonitorController {
  constructor(private readonly monitor: MonitorService) {}

  @Get('config')
  @ApiOperation({ summary: 'Whether each monitor is on, and how it should look (no secrets)' })
  @RequireWorkspacePermission('monitor.use')
  config(@Req() request: FastifyRequest) {
    return this.monitor.clientConfig(workspaceContext(request));
  }

  @Get('voice')
  @ApiOperation({
    summary: 'What the voice assistant monitor shows now, filtered by the monitor settings',
  })
  @RequireWorkspacePermission('monitor.use')
  voice(@Req() request: FastifyRequest) {
    return this.monitor.voiceView(workspaceContext(request));
  }

  @Get('viewer')
  @ApiOperation({
    summary: 'What the viewer monitor shows now: the steps of the project on the projector',
  })
  @RequireWorkspacePermission('monitor.use')
  viewer(@Req() request: FastifyRequest) {
    return this.monitor.viewerView(workspaceContext(request));
  }

  @Get('alias/:projectId')
  @ApiOperation({ summary: 'The display name a project has on the monitors, if any' })
  @RequireWorkspacePermission('monitor.use')
  alias(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return this.monitor.alias(workspaceContext(request), projectIdOf(raw));
  }

  @Put('alias/:projectId')
  @ApiOperation({ summary: 'Set the display name of a project on the monitors; empty removes it' })
  @RequireWorkspacePermission('monitor.use')
  setAlias(@Req() request: FastifyRequest, @Param('projectId') raw: string, @Body() body: unknown) {
    const parsed = monitorAliasSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw badRequest(
        'MONITOR_INVALID_REQUEST',
        'Provide a display name of at most 80 characters.',
      );
    }
    return this.monitor.setAlias(workspaceContext(request), projectIdOf(raw), parsed.data.alias);
  }

  @Post('events')
  @HttpCode(204)
  @ApiOperation({ summary: 'Record a control the owner used (opened, blackout, stopped, ...)' })
  @RequireWorkspacePermission('monitor.use')
  async event(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = reportMonitorEventSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw badRequest('MONITOR_INVALID_REQUEST', 'Provide a valid monitor control event.');
    }
    await this.monitor.report(workspaceContext(request), parsed.data);
  }
}
