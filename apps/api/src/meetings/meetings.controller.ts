import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { UsesAi, RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { MeetingsService } from './meetings.service.js';

@Controller('workspaces/:workspaceId/projects/:projectId/meeting')
export class MeetingsController {
  constructor(@Inject(MeetingsService) private readonly meetings: MeetingsService) {}
  @Get()
  @RequireWorkspacePermission('project.read')
  get(@Req() request: FastifyRequest, @Param('projectId') id: string, @Query() query: unknown) {
    const parsed = z.object({ before: z.uuid().optional() }).strict().safeParse(query);
    if (!parsed.success) throw new BadRequestException();
    return this.meetings.get(this.context(request), this.id(id), parsed.data.before ?? null);
  }
  @Put()
  @RequireWorkspacePermission('project.update')
  save(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.meetings.save(this.context(request), this.id(id), body);
  }
  @UsesAi()
  @Post('messages')
  @RequireWorkspacePermission('project.update')
  async send(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') id: string,
    @Body() body: unknown,
  ) {
    const abort = new AbortController();
    const close = () => {
      if (!reply.raw.writableEnded) abort.abort();
    };
    reply.raw.once('close', close);
    try {
      return await this.meetings.run(this.context(request), this.id(id), body, abort.signal);
    } finally {
      reply.raw.off('close', close);
    }
  }
  private id(value: string) {
    if (!z.uuid().safeParse(value).success) throw new BadRequestException();
    return value;
  }
  private context(request: FastifyRequest) {
    const scope = request.workspaceAuthorization;
    if (!scope) throw new ForbiddenException();
    return { workspaceId: scope.workspace.id, actorId: scope.user.id, correlationId: request.id };
  }
}
