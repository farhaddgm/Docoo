import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { TopicsService, type TopicRequestContext } from './topics.service.js';

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  })
  .strict();

const createTopicSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10_000).default(''),
    language: z.enum(['fa', 'en']).default('fa'),
  })
  .strict();

@ApiTags('topics')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/topics')
export class TopicsController {
  constructor(private readonly topicsService: TopicsService) {}

  @Get()
  @ApiOperation({ summary: 'List active topics in an authorized workspace' })
  @RequireWorkspacePermission('topic.read')
  async list(@Req() request: FastifyRequest, @Query() query: unknown) {
    const parsed = listQuerySchema.safeParse(query);
    if (!parsed.success) throw this.invalidRequest();
    return this.topicsService.list(this.context(request), parsed.data);
  }

  @Post()
  @ApiOperation({ summary: 'Create a topic in an authorized workspace' })
  @RequireWorkspacePermission('topic.create')
  async create(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = createTopicSchema.safeParse(body);
    if (!parsed.success) throw this.invalidRequest();
    const topic = await this.topicsService.create(this.context(request), parsed.data);
    return { topic };
  }

  private context(request: FastifyRequest): TopicRequestContext {
    const authorization = request.workspaceAuthorization;
    if (!authorization) {
      throw new ForbiddenException({
        status: 403,
        title: 'Forbidden',
        code: 'AUTH_PERMISSION_DENIED',
        detail: 'The requested action is not permitted.',
      });
    }
    return {
      workspaceId: authorization.workspace.id,
      actorId: authorization.user.id,
      correlationId: request.id,
    };
  }

  private invalidRequest(): BadRequestException {
    return new BadRequestException({
      status: 400,
      title: 'Invalid request',
      code: 'TOPIC_INVALID_REQUEST',
      detail: 'Provide a valid topic or page request.',
    });
  }
}
