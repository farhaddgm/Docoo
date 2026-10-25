import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission, UsesAi } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { OutputRequirementsService } from './output-requirements.service.js';

const kind = z.enum(['must', 'must_not']);
const stage = z.enum(['analysis', 'research', 'ideation', 'documentation', 'evaluation']);
const createBody = z
  .object({
    kind,
    text: z.string().max(4000),
    stage: stage.optional(),
    // The stage the requirement binds; absent: the final output as a whole.
    target: stage.nullish(),
  })
  .strict();
const fromMessageBody = z
  .object({ kind, text: z.string().max(4000).optional(), target: stage.nullish() })
  .strict();
const editBody = z
  .object({
    kind: kind.optional(),
    text: z.string().max(4000).optional(),
    // null moves it to the final output as a whole; absent leaves it where it is.
    target: stage.nullable().optional(),
  })
  .strict();
const withdrawBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();

function invalid() {
  return badRequest(
    'OUTPUT_REQUIREMENT_INVALID_REQUEST',
    'Provide a valid output requirement request.',
  );
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

@ApiTags('output-requirements')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class OutputRequirementsController {
  constructor(private readonly requirements: OutputRequirementsService) {}

  @Get('projects/:projectId/output-requirements')
  @ApiOperation({ summary: 'The requirements of the final output, their history and last check' })
  @RequireWorkspacePermission('project.read')
  async list(@Req() request: FastifyRequest, @Param('projectId') project: string) {
    return this.requirements.list(workspaceContext(request), id(project));
  }

  @Post('projects/:projectId/output-requirements')
  @ApiOperation({ summary: 'Add a requirement the final output must or must not meet' })
  @RequireWorkspacePermission('project.update')
  async add(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Body() body: unknown,
  ) {
    return this.requirements.add(workspaceContext(request), id(project), parse(createBody, body));
  }

  @Post('projects/:projectId/output-requirements/check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check which requirements the output covers (costs a model call)' })
  @UsesAi()
  @RequireWorkspacePermission('project.run')
  async check(@Req() request: FastifyRequest, @Param('projectId') project: string) {
    return this.requirements.check(workspaceContext(request), id(project));
  }

  @Patch('projects/:projectId/output-requirements/:requirementId')
  @ApiOperation({ summary: 'Edit a requirement; it replaces the old one, which stays in history' })
  @RequireWorkspacePermission('project.update')
  async edit(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Body() body: unknown,
  ) {
    return this.requirements.edit(
      workspaceContext(request),
      id(project),
      id(requirement),
      parse(editBody, body),
    );
  }

  @Post('projects/:projectId/output-requirements/:requirementId/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw a requirement; it stays in the history' })
  @RequireWorkspacePermission('project.update')
  async withdraw(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Body() body: unknown,
  ) {
    return this.requirements.withdraw(
      workspaceContext(request),
      id(project),
      id(requirement),
      parse(withdrawBody, body),
    );
  }

  @Post('projects/:projectId/stages/:stageRunId/messages/:messageId/requirements')
  @ApiOperation({ summary: 'Turn a message of a stage conversation into a requirement' })
  @RequireWorkspacePermission('project.update')
  async fromMessage(
    @Req() request: FastifyRequest,
    @Param('projectId') project: string,
    @Param('stageRunId') stage: string,
    @Param('messageId') message: string,
    @Body() body: unknown,
  ) {
    return this.requirements.addFromMessage(
      workspaceContext(request),
      id(project),
      id(stage),
      id(message),
      parse(fromMessageBody, body),
    );
  }
}
