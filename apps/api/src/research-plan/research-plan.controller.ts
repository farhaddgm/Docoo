import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { ResearchPlanService } from './research-plan.service.js';

const questionSchema = z
  .object({
    question: z.string().max(800),
    why: z.string().max(1200).optional(),
    channel: z.string().max(20),
  })
  .strict();
const saveBody = z
  .object({
    questions: z.array(questionSchema).max(12),
    basedOnVersionNo: z.number().int().min(0).max(100_000),
  })
  .strict();
const confirmBody = z
  .object({
    versionNo: z.number().int().min(1).max(100_000),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

function invalid() {
  return badRequest('RESEARCH_PLAN_INVALID_REQUEST', 'Provide a valid research plan request.');
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

@ApiTags('research-plan')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class ResearchPlanController {
  constructor(private readonly plans: ResearchPlanService) {}

  @Get('projects/:projectId/research-plan')
  @ApiOperation({ summary: 'The newest research plan and whether it is confirmed' })
  @RequireWorkspacePermission('project.read')
  async get(@Req() request: FastifyRequest, @Param('projectId') project: string) {
    return this.plans.get(workspaceContext(request), id(project));
  }

  @Put('projects/:projectId/research-plan')
  @ApiOperation({ summary: 'Save the plan as a new version; it must be confirmed again' })
  @RequireWorkspacePermission('project.update')
  async save(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Body() body: unknown,
  ) {
    return this.plans.save(workspaceContext(request), id(project), parse(saveBody, body));
  }

  @Post('projects/:projectId/research-plan/propose')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask the model to propose a plan (a new version; costs a model call)' })
  @RequireWorkspacePermission('project.run')
  async propose(@Req() request: FastifyRequest, @Param('projectId') project: string) {
    return this.plans.propose(workspaceContext(request), id(project));
  }

  @Post('projects/:projectId/research-plan/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the newest plan; research goes on' })
  @RequireWorkspacePermission('workflow.approve')
  async confirm(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Body() body: unknown,
  ) {
    return this.plans.confirm(workspaceContext(request), id(project), parse(confirmBody, body));
  }
}
