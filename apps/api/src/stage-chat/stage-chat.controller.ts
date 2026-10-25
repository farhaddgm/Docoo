import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { StageChatService } from './stage-chat.service.js';

const messageBody = z
  .object({
    kind: z.enum(['ask', 'revision_request']),
    content: z.string().trim().min(1).max(4000),
    attachments: z
      .array(z.object({ sourceId: z.uuid() }).strict())
      .max(5)
      .optional(),
  })
  .strict();
const sendBody = z
  .object({
    messageIds: z.array(z.uuid()).min(1).max(10),
    comment: z.string().trim().min(3).max(5000).optional(),
  })
  .strict();

function invalid() {
  return badRequest('STAGE_CHAT_INVALID_REQUEST', 'Provide a valid stage conversation request.');
}
function id(raw: string): string {
  if (!isUuid(raw)) throw invalid();
  return raw.toLowerCase();
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw invalid();
  return parsed.data;
}
function idempotencyKey(request: FastifyRequest): string | undefined {
  const header = request.headers['idempotency-key'];
  if (header === undefined) return undefined;
  if (typeof header !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/u.test(header)) {
    throw badRequest('STAGE_CHAT_INVALID_REQUEST', 'The Idempotency-Key header is invalid.');
  }
  return header;
}

@ApiTags('stage-chat')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class StageChatController {
  constructor(private readonly chat: StageChatService) {}

  @Get('projects/:projectId/stages/:stageRunId/messages')
  @ApiOperation({ summary: 'The conversation with the agent of a stage' })
  @RequireWorkspacePermission('project.read')
  async list(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Param('stageRunId') stage: string,
  ) {
    return this.chat.list(workspaceContext(request), id(project), id(stage));
  }

  @Post('projects/:projectId/stages/:stageRunId/messages')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Ask the agent of a stage or state a revision request (costs a model call)',
  })
  @RequireWorkspacePermission('project.update')
  async post(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Param('stageRunId') stage: string,
    @Body() body: unknown,
  ) {
    return this.chat.post(
      workspaceContext(request),
      id(project),
      id(stage),
      parse(messageBody, body),
    );
  }

  @Post('projects/:projectId/stages/:stageRunId/messages/send-as-rejection')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Send revision requests back as the rejection of the current output (a new attempt)',
  })
  @RequireWorkspacePermission('workflow.reject')
  async sendAsRejection(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Param('stageRunId') stage: string,
    @Body() body: unknown,
  ) {
    return this.chat.sendAsRejection(workspaceContext(request), id(project), id(stage), {
      ...parse(sendBody, body),
      idempotencyKey: idempotencyKey(request),
    });
  }
}
