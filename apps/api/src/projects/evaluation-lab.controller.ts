import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import {
  evaluationBlindReviewInputSchema,
  evaluationExperimentIdSchema,
  evaluationReviewCommandKeySchema,
} from '@docoo/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { EvaluationLabService } from './evaluation-lab.service.js';
import { workspaceContext, type WorkspaceRequestContext } from '../common/request-context.js';

const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(1024).optional(),
  })
  .strict();

@ApiTags('evaluation-lab')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/projects/:projectId/evaluation-experiments')
export class EvaluationLabController {
  constructor(@Inject(EvaluationLabService) private readonly service: EvaluationLabService) {}

  @Get()
  @RequireWorkspacePermission('project.read')
  list(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Query() query: unknown,
  ) {
    const parsed = listQuery.safeParse(query);
    if (!parsed.success) throw this.invalid();
    return this.service.list(
      this.context(request),
      this.project(projectId),
      parsed.data.limit,
      parsed.data.cursor,
    );
  }

  @Get(':experimentId/review-pack')
  @RequireWorkspacePermission('project.read')
  reviewPack(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('experimentId') experimentId: string,
  ) {
    return this.service.reviewPack(
      this.context(request),
      this.project(projectId),
      this.experiment(experimentId),
    );
  }

  @Get(':experimentId/comparisons')
  @RequireWorkspacePermission('project.read')
  comparisons(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('experimentId') experimentId: string,
  ) {
    return this.service.comparisons(
      this.context(request),
      this.project(projectId),
      this.experiment(experimentId),
    );
  }

  @Post(':experimentId/reviews')
  @HttpCode(200)
  @RequireWorkspacePermission('project.update')
  review(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('experimentId') experimentId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') rawKey: unknown,
  ) {
    const input = evaluationBlindReviewInputSchema.safeParse(body);
    const key = evaluationReviewCommandKeySchema.safeParse(rawKey);
    if (!input.success || !key.success) throw this.invalid();
    return this.service.review(
      this.context(request),
      this.project(projectId),
      this.experiment(experimentId),
      input.data,
      key.data,
    );
  }

  private context(request: FastifyRequest): WorkspaceRequestContext {
    const authorization = request.workspaceAuthorization;
    if (!authorization)
      throw new ForbiddenException({
        status: 403,
        code: 'AUTH_PERMISSION_DENIED',
        detail: 'A project session is required.',
      });
    return workspaceContext(request);
  }
  private project(value: string) {
    const parsed = z.uuid().safeParse(value);
    if (!parsed.success) throw this.invalid();
    return parsed.data;
  }
  private experiment(value: string) {
    const parsed = evaluationExperimentIdSchema.safeParse(value);
    if (!parsed.success) throw this.invalid();
    return parsed.data;
  }
  private invalid() {
    return new BadRequestException({
      status: 400,
      code: 'EVALUATION_LAB_INVALID_REQUEST',
      detail: 'Provide valid experiment identifiers and human review labels.',
    });
  }
}
