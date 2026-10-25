import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission, UsesAi } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { DeliverablesService } from './deliverables.service.js';

const itemSchema = z
  .object({
    kind: z.string().max(40),
    title: z.string().max(400),
    purpose: z.string().max(4000).optional(),
    scopeIn: z.string().max(4000).optional(),
    scopeOut: z.string().max(4000).optional(),
  })
  .strict();
const saveBody = z
  .object({
    items: z.array(itemSchema).min(1).max(20),
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
  return badRequest('DELIVERABLES_INVALID_REQUEST', 'Provide a valid deliverables request.');
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

@ApiTags('deliverables')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class DeliverablesController {
  constructor(private readonly deliverables: DeliverablesService) {}

  @Get('projects/:projectId/deliverables')
  @ApiOperation({ summary: 'The newest plan of expected deliverables and whether it is confirmed' })
  @RequireWorkspacePermission('project.read')
  async get(@Req() request: FastifyRequest, @Param('projectId') project: string) {
    return this.deliverables.get(workspaceContext(request), id(project));
  }

  @Put('projects/:projectId/deliverables')
  @ApiOperation({ summary: 'Save the plan as a new version; it must be confirmed again' })
  @RequireWorkspacePermission('project.update')
  async save(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Body() body: unknown,
  ) {
    return this.deliverables.save(workspaceContext(request), id(project), parse(saveBody, body));
  }

  @Post('projects/:projectId/deliverables/propose')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask the model to propose a plan (a new version; costs a model call)' })
  @UsesAi()
  @RequireWorkspacePermission('project.run')
  async propose(@Req() request: FastifyRequest, @Param('projectId') project: string) {
    return this.deliverables.propose(workspaceContext(request), id(project));
  }

  @Post('projects/:projectId/deliverables/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the newest plan; ideation goes on' })
  @RequireWorkspacePermission('workflow.approve')
  async confirm(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Body() body: unknown,
  ) {
    return this.deliverables.confirm(
      workspaceContext(request),
      id(project),
      parse(confirmBody, body),
    );
  }
}
