import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  appendLiveMessagesSchema,
  confirmLiveActionSchema,
  endLiveSessionSchema,
  proposeLiveActionSchema,
  reportLiveUsageSchema,
  startLiveSessionSchema,
} from '@docoo/contracts';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { LiveAssistantService } from './live-assistant.service.js';

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw badRequest('LIVE_INVALID_REQUEST', 'Provide a valid live assistant request.');
  }
  return parsed.data;
}

function idOf(raw: string): string {
  if (!isUuid(raw))
    throw badRequest('LIVE_INVALID_REQUEST', 'Provide a valid live assistant request.');
  return raw.toLowerCase();
}

/**
 * The live voice assistant (ADR-0055). Only a super administrator may use it, and every route is
 * about their own sessions and proposals. A change is proposed, then confirmed by a person; the
 * routes here never run anything on a model's say-so alone.
 */
@ApiTags('live-assistant')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/live-assistant')
export class LiveAssistantController {
  constructor(private readonly assistant: LiveAssistantService) {}

  @Get('config')
  @ApiOperation({ summary: 'Whether the assistant can start, its names and limits (no secrets)' })
  @RequireWorkspacePermission('live_assistant.use')
  config(@Req() request: FastifyRequest) {
    return this.assistant.clientConfig(workspaceContext(request));
  }

  @Post('sessions')
  @HttpCode(201)
  @ApiOperation({ summary: 'Start a live session (ends one left running by this person)' })
  @RequireWorkspacePermission('live_assistant.use')
  start(@Req() request: FastifyRequest, @Body() body: unknown) {
    parse(startLiveSessionSchema, body);
    return this.assistant.startSession(workspaceContext(request));
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Own live conversations, newest first' })
  @RequireWorkspacePermission('live_assistant.use')
  sessions(@Req() request: FastifyRequest) {
    return this.assistant.listSessions(workspaceContext(request));
  }

  @Get('sessions/:sessionId')
  @ApiOperation({ summary: 'One own live conversation with its transcript and proposed changes' })
  @RequireWorkspacePermission('live_assistant.use')
  session(@Req() request: FastifyRequest, @Param('sessionId') raw: string) {
    return this.assistant.getSession(workspaceContext(request), idOf(raw));
  }

  @Post('sessions/:sessionId/usage')
  @HttpCode(200)
  @ApiOperation({ summary: 'Report usage totals (also the heartbeat); the server checks the caps' })
  @RequireWorkspacePermission('live_assistant.use')
  usage(@Req() request: FastifyRequest, @Param('sessionId') raw: string, @Body() body: unknown) {
    return this.assistant.reportUsage(
      workspaceContext(request),
      idOf(raw),
      parse(reportLiveUsageSchema, body),
    );
  }

  @Post('sessions/:sessionId/messages')
  @HttpCode(200)
  @ApiOperation({ summary: 'Add lines to the transcript of an open session' })
  @RequireWorkspacePermission('live_assistant.use')
  messages(@Req() request: FastifyRequest, @Param('sessionId') raw: string, @Body() body: unknown) {
    return this.assistant.appendMessages(
      workspaceContext(request),
      idOf(raw),
      parse(appendLiveMessagesSchema, body).messages,
    );
  }

  @Post('sessions/:sessionId/end')
  @HttpCode(200)
  @ApiOperation({ summary: 'End a live session; its unconfirmed proposals are cancelled' })
  @RequireWorkspacePermission('live_assistant.use')
  end(@Req() request: FastifyRequest, @Param('sessionId') raw: string, @Body() body: unknown) {
    return this.assistant.endSession(
      workspaceContext(request),
      idOf(raw),
      parse(endLiveSessionSchema, body).reason,
    );
  }

  @Post('actions')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Propose a capability: refused, run at once if a read, else waits to be confirmed',
  })
  @RequireWorkspacePermission('live_assistant.use')
  propose(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.assistant.propose(workspaceContext(request), parse(proposeLiveActionSchema, body));
  }

  @Get('actions/:actionId')
  @ApiOperation({ summary: 'One proposed change and where its confirmation stands' })
  @RequireWorkspacePermission('live_assistant.use')
  action(@Req() request: FastifyRequest, @Param('actionId') raw: string) {
    return this.assistant.getAction(workspaceContext(request), idOf(raw));
  }

  @Post('actions/:actionId/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'A person confirms by voice or click; the last confirmation runs it' })
  @RequireWorkspacePermission('live_assistant.use')
  confirm(@Req() request: FastifyRequest, @Param('actionId') raw: string, @Body() body: unknown) {
    return this.assistant.confirm(
      workspaceContext(request),
      idOf(raw),
      parse(confirmLiveActionSchema, body),
    );
  }

  @Post('actions/:actionId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a proposed change that has not run' })
  @RequireWorkspacePermission('live_assistant.use')
  cancel(@Req() request: FastifyRequest, @Param('actionId') raw: string) {
    return this.assistant.cancel(workspaceContext(request), idOf(raw));
  }
}
