import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  conflictSuggestionReviewSchema,
  evidenceLinkInputSchema,
  intelligenceSearchSchema,
  projectResearchPlanSchema,
} from '@docoo/contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { workspaceContext } from '../common/request-context.js';
import { DecisionIntelligenceService } from './decision-intelligence.service.js';

@Controller('workspaces/:workspaceId/projects/:projectId/intelligence')
export class DecisionIntelligenceController {
  constructor(
    @Inject(DecisionIntelligenceService) private readonly intelligence: DecisionIntelligenceService,
  ) {}
  private context(request: FastifyRequest) {
    const auth = request.workspaceAuthorization;
    if (!auth) throw new ForbiddenException();
    return workspaceContext(request);
  }
  private parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid intelligence request');
    return parsed.data;
  }
  @Post('search')
  @RequireWorkspacePermission('knowledge.read')
  search(@Req() r: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.intelligence.search(
      this.context(r),
      this.parse(z.uuid(), id),
      this.parse(intelligenceSearchSchema, body),
    );
  }
  @Get('graph')
  @RequireWorkspacePermission('project.read')
  graph(@Req() r: FastifyRequest, @Param('projectId') id: string) {
    return this.intelligence.graph(this.context(r), this.parse(z.uuid(), id));
  }
  @Get('conflicts')
  @RequireWorkspacePermission('knowledge.read')
  conflicts(@Req() r: FastifyRequest, @Param('projectId') id: string) {
    return this.intelligence.conflicts(this.context(r), this.parse(z.uuid(), id));
  }
  @Post('conflicts/reviews')
  @RequireWorkspacePermission('knowledge.update')
  review(@Req() r: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.intelligence.reviewConflict(
      this.context(r),
      this.parse(z.uuid(), id),
      this.parse(conflictSuggestionReviewSchema, body),
    );
  }
  @Post('evidence-links')
  @RequireWorkspacePermission('project.update')
  link(@Req() r: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.intelligence.linkEvidence(
      this.context(r),
      this.parse(z.uuid(), id),
      this.parse(evidenceLinkInputSchema, body),
    );
  }
  @Post('research/preview')
  @RequireWorkspacePermission('knowledge.read')
  preview(@Req() r: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.intelligence.previewResearch(
      this.context(r),
      this.parse(z.uuid(), id),
      this.parse(projectResearchPlanSchema, body),
    );
  }
  @Post('research/runs')
  @RequireWorkspacePermission('project.update')
  launch(@Req() r: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    const input = this.parse(
      z.object({ plan: projectResearchPlanSchema, idempotencyKey: z.uuid() }).strict(),
      body,
    );
    return this.intelligence.launchResearch(
      this.context(r),
      this.parse(z.uuid(), id),
      input.plan,
      input.idempotencyKey,
    );
  }
  @Get('research/reports')
  @RequireWorkspacePermission('project.read')
  reports(@Req() r: FastifyRequest, @Param('projectId') id: string) {
    return this.intelligence.researchReports(this.context(r), this.parse(z.uuid(), id));
  }
}
