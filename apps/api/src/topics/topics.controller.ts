import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { requireIfMatch, setVersionHeader } from '../common/concurrency.js';
import { pageQuerySchema } from '../common/pagination.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { TopicsService } from './topics.service.js';

const codeSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const titleSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().max(10_000);
const languageSchema = z.enum(['fa', 'en']);
const reasonSchema = z.string().trim().min(1).max(1000);

const listQuerySchema = z
  .object({
    ...pageQuerySchema,
    status: z.enum(['active', 'archived', 'deleted', 'all']).default('active'),
  })
  .strict();

const createTopicSchema = z
  .object({
    code: codeSchema,
    title: titleSchema,
    description: descriptionSchema.default(''),
    language: languageSchema.default('fa'),
  })
  .strict();

const updateTopicSchema = z
  .object({
    code: codeSchema.optional(),
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    language: languageSchema.optional(),
    reason: reasonSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.code !== undefined ||
      value.title !== undefined ||
      value.description !== undefined ||
      value.language !== undefined,
  );

const stateCommandSchema = z
  .object({
    expectedVersion: z.number().int().min(1).optional(),
    reason: reasonSchema.optional(),
  })
  .strict();

function invalidRequest() {
  return badRequest('TOPIC_INVALID_REQUEST', 'Provide a valid topic or page request.');
}

function topicId(raw: string): string {
  if (!isUuid(raw)) throw invalidRequest();
  return raw.toLowerCase();
}

@ApiTags('topics')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/topics')
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get()
  @ApiOperation({ summary: 'List topics by status (default: active)' })
  @RequireWorkspacePermission('topic.read')
  async list(@Req() request: FastifyRequest, @Query() query: unknown) {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) throw invalidRequest();
    return this.topicsService.list(workspaceContext(request), parsed.data);
  }

  @Post()
  @ApiOperation({ summary: 'Create a topic' })
  @RequireWorkspacePermission('topic.create')
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const parsed = createTopicSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest();
    const topic = await this.topicsService.create(workspaceContext(request), parsed.data);
    setVersionHeader(reply, topic.version);
    return { topic };
  }

  @Get(':topicId')
  @ApiOperation({ summary: 'Read a topic; ETag carries its version' })
  @RequireWorkspacePermission('topic.read')
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('topicId') rawId: string,
  ) {
    const topic = await this.topicsService.get(workspaceContext(request), topicId(rawId));
    setVersionHeader(reply, topic.version);
    return { topic };
  }

  @Patch(':topicId')
  @ApiOperation({ summary: 'Edit a topic; requires If-Match with the current version' })
  @RequireWorkspacePermission('topic.update')
  async update(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('topicId') rawId: string,
    @Body() body: unknown,
  ) {
    const id = topicId(rawId);
    const parsed = updateTopicSchema.safeParse(body);
    if (!parsed.success) throw invalidRequest();
    const expectedVersion = requireIfMatch(request, 'TOPIC');
    const topic = await this.topicsService.update(
      workspaceContext(request),
      id,
      expectedVersion,
      parsed.data,
    );
    setVersionHeader(reply, topic.version);
    return { topic };
  }

  @Get(':topicId/versions')
  @ApiOperation({ summary: 'List every saved version of a topic' })
  @RequireWorkspacePermission('topic.read')
  async versions(@Req() request: FastifyRequest, @Param('topicId') rawId: string) {
    const items = await this.topicsService.versions(workspaceContext(request), topicId(rawId));
    return { items };
  }

  @Get(':topicId/dependencies')
  @ApiOperation({ summary: 'List projects that use this topic' })
  @RequireWorkspacePermission('topic.read')
  async dependencies(@Req() request: FastifyRequest, @Param('topicId') rawId: string) {
    const items = await this.topicsService.dependencies(workspaceContext(request), topicId(rawId));
    return { items };
  }

  @Post(':topicId/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a topic' })
  @RequireWorkspacePermission('topic.archive')
  async archive(
    @Req() request: FastifyRequest,
    @Param('topicId') rawId: string,
    @Body() body: unknown,
  ) {
    const command = this.stateCommand(body);
    const topic = await this.topicsService.archive(
      workspaceContext(request),
      topicId(rawId),
      command,
    );
    return { topic };
  }

  @Post(':topicId/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore an archived or deleted topic' })
  @RequireWorkspacePermission('topic.restore')
  async restore(
    @Req() request: FastifyRequest,
    @Param('topicId') rawId: string,
    @Body() body: unknown,
  ) {
    const command = this.stateCommand(body);
    const topic = await this.topicsService.restore(
      workspaceContext(request),
      topicId(rawId),
      command,
    );
    return { topic };
  }

  @Delete(':topicId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete a topic that no live project uses' })
  @RequireWorkspacePermission('topic.delete')
  async delete(
    @Req() request: FastifyRequest,
    @Param('topicId') rawId: string,
    @Body() body: unknown,
  ) {
    const command = this.stateCommand(body);
    const topic = await this.topicsService.delete(
      workspaceContext(request),
      topicId(rawId),
      command,
    );
    return { topic };
  }

  private stateCommand(body: unknown) {
    const parsed = stateCommandSchema.safeParse(body ?? {});
    if (!parsed.success) throw invalidRequest();
    return parsed.data;
  }
}
