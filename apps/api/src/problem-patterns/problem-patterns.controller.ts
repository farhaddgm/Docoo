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
  Req,
  Query,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { UsesAi, RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { ProblemPatternsService } from './problem-patterns.service.js';

@ApiTags('problem-patterns')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/problem-patterns')
export class ProblemPatternsController {
  constructor(@Inject(ProblemPatternsService) private readonly patterns: ProblemPatternsService) {}
  @Get()
  @RequireWorkspacePermission('workspace.configure')
  list(@Req() request: FastifyRequest) {
    return this.patterns.list(this.context(request));
  }
  @Get('published-versions')
  @RequireWorkspacePermission('project.create')
  listPublished(@Req() request: FastifyRequest) {
    return this.patterns.listPublished(this.context(request));
  }
  @Post()
  @RequireWorkspacePermission('workspace.configure')
  create(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.patterns.create(this.context(request), body);
  }
  @Get(':patternId')
  @RequireWorkspacePermission('workspace.configure')
  get(@Req() request: FastifyRequest, @Param('patternId') id: string, @Query() query: unknown) {
    const parsed = z.object({ before: z.uuid().optional() }).strict().safeParse(query);
    if (!parsed.success) throw new BadRequestException({ code: 'PATTERN_INVALID_CURSOR' });
    return this.patterns.get(this.context(request), this.id(id), parsed.data.before ?? null);
  }
  @Get(':patternId/versions/:versionId')
  @RequireWorkspacePermission('workspace.configure')
  version(
    @Req() request: FastifyRequest,
    @Param('patternId') id: string,
    @Param('versionId') versionId: string,
  ) {
    return this.patterns.getVersion(this.context(request), this.id(id), this.id(versionId));
  }
  @Put(':patternId/draft')
  @RequireWorkspacePermission('workspace.configure')
  update(@Req() request: FastifyRequest, @Param('patternId') id: string, @Body() body: unknown) {
    return this.patterns.update(this.context(request), this.id(id), body);
  }
  @Post(':patternId/archive')
  @RequireWorkspacePermission('workspace.configure')
  archive(@Req() request: FastifyRequest, @Param('patternId') id: string, @Body() body: unknown) {
    return this.patterns.archive(this.context(request), this.id(id), body);
  }
  @Post(':patternId/versions')
  @RequireWorkspacePermission('workspace.configure')
  publish(@Req() request: FastifyRequest, @Param('patternId') id: string, @Body() body: unknown) {
    return this.patterns.publish(this.context(request), this.id(id), body);
  }
  @UsesAi()
  @Post(':patternId/messages')
  @RequireWorkspacePermission('workspace.configure')
  chat(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('patternId') id: string,
    @Body() body: unknown,
  ) {
    return this.run(request, reply, this.id(id), 'chat', body);
  }
  @UsesAi()
  @Post(':patternId/tests')
  @RequireWorkspacePermission('workspace.configure')
  test(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('patternId') id: string,
    @Body() body: unknown,
  ) {
    return this.run(request, reply, this.id(id), 'test', body);
  }

  private async run(
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
    kind: 'chat' | 'test',
    body: unknown,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once('aborted', abort);
    const onClose = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once('close', onClose);
    try {
      return await this.patterns.run(this.context(request), id, kind, body, controller.signal);
    } finally {
      request.raw.off('aborted', abort);
      reply.raw.off('close', onClose);
    }
  }
  private id(id: string) {
    if (!z.uuid().safeParse(id).success)
      throw new BadRequestException({ code: 'PATTERN_INVALID_ID' });
    return id;
  }
  private context(request: FastifyRequest) {
    const authorization = request.workspaceAuthorization;
    if (!authorization) throw new ForbiddenException();
    return {
      workspaceId: authorization.workspace.id,
      actorId: authorization.user.id,
      correlationId: request.id,
    };
  }
}
