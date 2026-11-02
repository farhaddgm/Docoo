import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { workspaceContext } from '../common/request-context.js';
import { ResearchMemoryService } from './research-memory.service.js';

const listQuery = z.object({ outputId: z.uuid() }).strict();
const saveBody = z
  .object({
    outputId: z.uuid(),
    findingIndex: z.number().int().min(0).max(1000),
    title: z.string().trim().min(1).max(300).optional(),
    confidentiality: z.enum(['internal', 'confidential', 'restricted']).default('internal'),
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    throw badRequest('RESEARCH_MEMORY_INVALID_REQUEST', 'Provide a valid research memory request.');
  }
  return parsed.data;
}

const projectId = (raw: string): string => parse(z.uuid(), raw).toLowerCase();

/** Keeping a verified research finding as a draft of the organization's knowledge (ADR-0053). */
@ApiTags('research-memory')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/projects/:projectId/research-memory')
export class ResearchMemoryController {
  constructor(private readonly memory: ResearchMemoryService) {}

  @Get()
  @ApiOperation({ summary: 'Which findings of a research output can be kept, are kept, or cannot' })
  @RequireWorkspacePermission('project.read')
  async list(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Query() query: unknown,
  ) {
    const { outputId } = parse(listQuery, query);
    return this.memory.list(workspaceContext(request), projectId(project), outputId.toLowerCase());
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Keep a verified finding as a draft knowledge item (to be audited)' })
  @RequireWorkspacePermission('knowledge.create')
  async save(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Body() body: unknown,
  ) {
    const input = parse(saveBody, body);
    return this.memory.save(workspaceContext(request), projectId(project), {
      ...input,
      outputId: input.outputId.toLowerCase(),
    });
  }
}
