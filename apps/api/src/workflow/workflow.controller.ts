import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { WorkflowService } from './workflow.service.js';

const commentSchema = z.object({ comment: z.string().trim().min(1).max(5000).optional() }).strict();
const rejectSchema = z.object({ comment: z.string().trim().min(3).max(5000) }).strict();
const editSchema = z
  .object({
    content: z.record(z.string(), z.unknown()),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()
  .refine((value) => JSON.stringify(value.content).length <= 500_000);
const decisionSchema = z
  .object({ decision: z.enum(['extend', 'pass']), reason: z.string().trim().min(10).max(1000) })
  .strict();
const answerSchema = z.object({ answer: z.string().trim().min(1).max(4000).nullable() }).strict();
const cancelSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const tasksQuery = z
  .object({ status: z.enum(['pending', 'resolved', 'cancelled']).default('pending') })
  .strict();

function invalid() {
  return badRequest('WORKFLOW_INVALID_REQUEST', 'Provide a valid workflow request.');
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
    throw badRequest('WORKFLOW_INVALID_REQUEST', 'The Idempotency-Key header is invalid.');
  }
  return header;
}

@ApiTags('workflow')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService) {}

  @Get('projects/:projectId/workflow')
  @ApiOperation({ summary: 'Workflow run, stages, pending gates and human tasks of a project' })
  @RequireWorkspacePermission('project.read')
  async overview(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return { workflow: await this.workflow.overview(workspaceContext(request), id(raw)) };
  }

  @Post('projects/:projectId/workflow/start')
  @HttpCode(202)
  @ApiOperation({ summary: 'Start the workflow of an active project (idempotent)' })
  @RequireWorkspacePermission('project.run')
  async start(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return { workflow: await this.workflow.start(workspaceContext(request), id(raw)) };
  }

  @Post('projects/:projectId/workflow/sync')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Re-send the signal the project state implies (after an engine outage)',
  })
  @RequireWorkspacePermission('project.run')
  async sync(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return { workflow: await this.workflow.sync(workspaceContext(request), id(raw)) };
  }

  @Post('projects/:projectId/workflow/cancel')
  @HttpCode(202)
  @ApiOperation({ summary: 'Cancel the live run; outputs are kept but not used downstream' })
  @RequireWorkspacePermission('workflow.cancel')
  async cancel(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Body() body: unknown,
  ) {
    const { reason } = parse(cancelSchema, body);
    return { workflow: await this.workflow.cancel(workspaceContext(request), id(raw), reason) };
  }

  @Get('projects/:projectId/stages/:stageRunId')
  @ApiOperation({ summary: 'Stage outputs (all versions), reviews, gates and attempts' })
  @RequireWorkspacePermission('project.read')
  async stage(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Param('stageRunId') stage: string,
  ) {
    return { stage: await this.workflow.stage(workspaceContext(request), id(raw), id(stage)) };
  }

  @Post('projects/:projectId/stages/:stageRunId/outputs/:outputId/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve the current output; the workflow continues' })
  @RequireWorkspacePermission('workflow.approve')
  async approve(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Param('stageRunId') stage: string,
    @Param('outputId') output: string,
    @Body() body: unknown,
  ) {
    const { comment } = parse(commentSchema, body);
    return {
      review: await this.workflow.review(
        workspaceContext(request),
        id(raw),
        id(stage),
        id(output),
        {
          action: 'approve',
          comment,
          idempotencyKey: idempotencyKey(request),
        },
      ),
    };
  }

  @Post('projects/:projectId/stages/:stageRunId/outputs/:outputId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject the current output with feedback; a new attempt follows' })
  @RequireWorkspacePermission('workflow.reject')
  async reject(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Param('stageRunId') stage: string,
    @Param('outputId') output: string,
    @Body() body: unknown,
  ) {
    const { comment } = parse(rejectSchema, body);
    return {
      review: await this.workflow.review(
        workspaceContext(request),
        id(raw),
        id(stage),
        id(output),
        {
          action: 'reject',
          comment,
          idempotencyKey: idempotencyKey(request),
        },
      ),
    };
  }

  @Post('projects/:projectId/stages/:stageRunId/outputs/:outputId/comment')
  @HttpCode(200)
  @ApiOperation({ summary: 'Comment on an output without deciding' })
  @RequireWorkspacePermission('project.update')
  async comment(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Param('stageRunId') stage: string,
    @Param('outputId') output: string,
    @Body() body: unknown,
  ) {
    const { comment } = parse(rejectSchema, body);
    return {
      review: await this.workflow.review(
        workspaceContext(request),
        id(raw),
        id(stage),
        id(output),
        {
          action: 'comment',
          comment,
          idempotencyKey: idempotencyKey(request),
        },
      ),
    };
  }

  @Post('projects/:projectId/stages/:stageRunId/outputs/:outputId/edit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Edit the output as a new version; earlier approval and evaluation are invalidated',
  })
  @RequireWorkspacePermission('project.update')
  async edit(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Param('stageRunId') stage: string,
    @Param('outputId') output: string,
    @Body() body: unknown,
  ) {
    const input = parse(editSchema, body);
    return {
      edit: await this.workflow.edit(workspaceContext(request), id(raw), id(stage), id(output), {
        ...input,
        idempotencyKey: idempotencyKey(request),
      }),
    };
  }

  @Post('projects/:projectId/stages/:stageRunId/attempt-decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Decide past the attempt limit: one more attempt or pass the stage' })
  @RequireWorkspacePermission('workflow.override')
  async decision(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Param('stageRunId') stage: string,
    @Body() body: unknown,
  ) {
    const input = parse(decisionSchema, body);
    return {
      decision: await this.workflow.attemptDecision(workspaceContext(request), id(raw), id(stage), {
        ...input,
        idempotencyKey: idempotencyKey(request),
      }),
    };
  }

  @Post('projects/:projectId/agent-questions/:questionId/answer')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Answer a question an agent asked in a stage, or decline it with a null answer',
  })
  @RequireWorkspacePermission('project.update')
  async answerQuestion(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Param('questionId') question: string,
    @Body() body: unknown,
  ) {
    const input = parse(answerSchema, body);
    return {
      answer: await this.workflow.answerAgentQuestion(
        workspaceContext(request),
        id(raw),
        id(question),
        { answer: input.answer, idempotencyKey: idempotencyKey(request) },
      ),
    };
  }

  @Get('human-tasks')
  @ApiOperation({ summary: 'Human tasks of the workspace' })
  @RequireWorkspacePermission('workspace.read')
  async tasks(@Req() request: FastifyRequest, @Query() query: unknown) {
    const { status } = parse(tasksQuery, query);
    return { items: await this.workflow.humanTasks(workspaceContext(request), status) };
  }
}
