import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Put,
  Req,
} from '@nestjs/common';
import { PRIVACY_MODES } from '@docoo/providers';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { workspaceContext } from '../common/request-context.js';
import { ProjectPrivacyService } from './project-privacy.service.js';

const policySchema = z
  .object({
    mode: z.enum(PRIVACY_MODES),
    blockedWords: z
      .array(z.string().trim().min(1).max(120))
      .max(100)
      .transform((words) => [...new Set(words)]),
  })
  .strict();

@Controller('workspaces/:workspaceId/projects/:projectId/privacy')
export class ProjectPrivacyController {
  constructor(@Inject(ProjectPrivacyService) private readonly privacy: ProjectPrivacyService) {}

  private id(value: string): string {
    const parsed = z.uuid().safeParse(value);
    if (!parsed.success) throw new BadRequestException('Invalid project id');
    return parsed.data.toLowerCase();
  }

  @Get()
  @RequireWorkspacePermission('project.read')
  async get(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    return { privacy: await this.privacy.get(workspaceContext(request), this.id(projectId)) };
  }

  @Put()
  @RequireWorkspacePermission('project.update')
  async set(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const parsed = policySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid privacy policy');
    return {
      privacy: await this.privacy.set(workspaceContext(request), this.id(projectId), parsed.data),
    };
  }
}
