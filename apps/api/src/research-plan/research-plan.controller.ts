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
const followupBody = z
  .object({
    questionIds: z
      .array(z.string().regex(/^Q\d{1,2}$/u))
      .min(1)
      .max(12)
      .optional(),
  })
  .strict();
const decisionBody = z
  .object({
    decision: z.enum(['trust', 'dismiss']),
    trustedRef: z
      .string()
      .regex(/^[KWkw]\d{1,4}$/u)
      .optional(),
    note: z.string().trim().max(500).optional(),
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

function idempotencyKey(request: FastifyRequest): string | undefined {
  const header = request.headers['idempotency-key'];
  if (header === undefined) return undefined;
  if (typeof header !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/u.test(header)) {
    throw badRequest('RESEARCH_PLAN_INVALID_REQUEST', 'The Idempotency-Key header is invalid.');
  }
  return header;
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

  @Post('projects/:projectId/research-plan/followup')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Start a follow-up research round for the open questions (a rejection: a new attempt that counts against the limit)',
  })
  @RequireWorkspacePermission('workflow.reject')
  async followup(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Body() body: unknown,
  ) {
    return this.plans.followup(workspaceContext(request), id(project), {
      ...parse(followupBody, body),
      idempotencyKey: idempotencyKey(request),
    });
  }

  @Post('projects/:projectId/research-plan/requirement-gaps')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check the research against the "must" output requirements (costs a model call)',
  })
  @RequireWorkspacePermission('project.run')
  async requirementGaps(@Req() request: FastifyRequest, @Param('projectId') project: string) {
    return this.plans.requirementGaps(workspaceContext(request), id(project));
  }

  @Get('projects/:projectId/research-conflicts')
  @ApiOperation({ summary: 'The conflicts the research reports and the decisions on them' })
  @RequireWorkspacePermission('project.read')
  async conflicts(@Req() request: FastifyRequest, @Param('projectId') project: string) {
    return this.plans.conflicts(workspaceContext(request), id(project));
  }

  @Post('projects/:projectId/research-conflicts/:fingerprint/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Trust one source of a research conflict, or dismiss the conflict' })
  @RequireWorkspacePermission('project.update')
  async decide(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Param('fingerprint') fingerprint: string,
    @Body() body: unknown,
  ) {
    if (!/^[0-9a-f]{16}$/u.test(fingerprint)) throw invalid();
    return this.plans.decideConflict(
      workspaceContext(request),
      id(project),
      fingerprint,
      parse(decisionBody, body),
    );
  }
}
