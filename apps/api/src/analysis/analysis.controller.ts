import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { answerStatuses } from '@docoo/domain';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { AnalysisService } from './analysis.service.js';

const answerSchema = z
  .object({
    questionId: z.uuid(),
    status: z.enum(answerStatuses),
    text: z.string().max(20_000).optional(),
    attachments: z
      .array(z.object({ sourceId: z.uuid() }).strict())
      .max(10)
      .optional(),
  })
  .strict();
const answersBody = z
  .object({ answers: z.array(answerSchema).min(1).max(40) })
  .strict()
  .refine(
    (value) =>
      new Set(value.answers.map((answer) => answer.questionId)).size === value.answers.length,
  );
const finishBody = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

function invalid() {
  return badRequest('ANALYSIS_INVALID_REQUEST', 'Provide a valid analysis request.');
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
    throw badRequest('ANALYSIS_INVALID_REQUEST', 'The Idempotency-Key header is invalid.');
  }
  return header;
}

@ApiTags('analysis')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Get('projects/:projectId/analysis')
  @ApiOperation({
    summary: 'Progress, coverage, the analyst reading, contradictions, follow-ups and definition',
  })
  @RequireWorkspacePermission('project.read')
  async overview(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return this.analysis.overview(workspaceContext(request), id(raw));
  }

  @Get('projects/:projectId/analysis/question-batches')
  @ApiOperation({ summary: 'Question batches of the current analysis with their answers' })
  @RequireWorkspacePermission('project.read')
  async batches(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return this.analysis.batches(workspaceContext(request), id(raw));
  }

  @Get('projects/:projectId/problem-definitions')
  @ApiOperation({ summary: 'Versions of the problem definition and which one is approved' })
  @RequireWorkspacePermission('project.read')
  async definitions(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return this.analysis.definitions(workspaceContext(request), id(raw));
  }

  @Post('question-batches/:batchId/answers')
  @HttpCode(200)
  @ApiOperation({ summary: 'Answer questions of a batch, all or nothing (idempotent)' })
  @RequireWorkspacePermission('analysis.answer')
  async answers(
    @Req() request: FastifyRequest,
    @Param('batchId') raw: string,
    @Body() body: unknown,
  ) {
    const { answers } = parse(answersBody, body);
    return {
      result: await this.analysis.submitAnswers(workspaceContext(request), id(raw), {
        answers,
        idempotencyKey: idempotencyKey(request),
      }),
    };
  }

  @Post('projects/:projectId/analysis/finish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask the analyst to write the problem definition now' })
  @RequireWorkspacePermission('workflow.approve')
  async finish(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Body() body: unknown,
  ) {
    const { reason } = parse(finishBody, body);
    return {
      result: await this.analysis.finish(workspaceContext(request), id(raw), {
        reason,
        idempotencyKey: idempotencyKey(request),
      }),
    };
  }
}
