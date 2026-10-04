import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AGENT_LIMITS, AGENT_ROLES, type AgentRole } from '@docoo/domain';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { pageQuerySchema } from '../common/pagination.js';
import { badRequest, notFound } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { AgentsService, type DefinitionChanges } from './agents.service.js';

const reason = z
  .string()
  .trim()
  .min(AGENT_LIMITS.minReasonLength)
  .max(AGENT_LIMITS.maxReasonLength);
const list = z.array(z.string().max(AGENT_LIMITS.maxItemLength * 4)).max(AGENT_LIMITS.maxItems * 2);
const changes = z
  .object({
    principles: list.optional(),
    duties: list.optional(),
    promptTemplate: z
      .string()
      .max(AGENT_LIMITS.maxPromptLength * 2)
      .optional(),
    tools: z.array(z.string().max(60)).max(30).optional(),
    modelPolicy: z
      .union([
        z.null(),
        z
          .object({
            connectionId: z.uuid(),
            model: z
              .string()
              .min(1)
              .max(AGENT_LIMITS.maxModelLength * 2),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const expectedSequence = z.number().int().min(0).optional();
const createBody = z
  .object({ changes, reason, baseVersionId: z.uuid().optional(), expectedSequence })
  .strict();
const reasonBody = z.object({ reason }).strict();
const updateBody = z.object({ changes, reason, expectedSequence }).strict();
const pinBody = z.object({ versionId: z.uuid().optional(), reason }).strict();
const versionsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    before: z.coerce.number().int().min(1).optional(),
  })
  .strict();
const outputsQuery = z.object(pageQuerySchema).strict();

function invalid() {
  return badRequest('AGENT_INVALID_REQUEST', 'Provide a valid agent request.');
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw invalid();
  return parsed.data;
}

function id(raw: string): string {
  if (!isUuid(raw)) throw invalid();
  return raw.toLowerCase();
}

function role(raw: string): AgentRole {
  if (!(AGENT_ROLES as readonly string[]).includes(raw)) {
    throw notFound('AGENT_ROLE_NOT_FOUND', 'There is no such role.');
  }
  return raw as AgentRole;
}

function idempotencyKey(request: FastifyRequest): string | undefined {
  const header = request.headers['idempotency-key'];
  if (header === undefined) return undefined;
  if (typeof header !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/u.test(header)) {
    throw badRequest('AGENT_INVALID_REQUEST', 'The Idempotency-Key header is invalid.');
  }
  return header;
}

function asChanges(value: z.infer<typeof changes>): DefinitionChanges {
  return value as DefinitionChanges;
}

@ApiTags('agents')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get('agent-roles')
  @ApiOperation({ summary: 'The six roles with their active definition' })
  @RequireWorkspacePermission('agent_definition.read')
  async roles(@Req() request: FastifyRequest) {
    return this.agents.listRoles(workspaceContext(request));
  }

  @Get('agent-roles/:role')
  @ApiOperation({
    summary: 'A role: active definition, tool ceiling, output schema, Brain findings',
  })
  @RequireWorkspacePermission('agent_definition.read')
  async getRole(@Req() request: FastifyRequest, @Param('role') raw: string) {
    return this.agents.getRole(workspaceContext(request), role(raw));
  }

  @Get('agent-roles/:role/definitions')
  @ApiOperation({ summary: 'Every version of the role default, newest first' })
  @RequireWorkspacePermission('agent_definition.read')
  async versions(
    @Req() request: FastifyRequest,
    @Param('role') raw: string,
    @Query() query: unknown,
  ) {
    return this.agents.versions(workspaceContext(request), role(raw), parse(versionsQuery, query));
  }

  @Post('agent-roles/:role/definitions')
  @ApiOperation({ summary: 'Append a version (not active until it is activated)' })
  @RequireWorkspacePermission('agent_definition.version')
  async createVersion(
    @Req() request: FastifyRequest,
    @Param('role') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(createBody, body);
    return this.agents.createVersion(workspaceContext(request), role(raw), {
      changes: asChanges(input.changes),
      reason: input.reason,
      baseVersionId: input.baseVersionId?.toLowerCase(),
      expectedSequence: input.expectedSequence,
      idempotencyKey: idempotencyKey(request),
    });
  }

  @Post('agent-roles/:role/definitions/:definitionId/activate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Make a version the default of the role (also restores an earlier one)',
  })
  @RequireWorkspacePermission('agent_definition.activate')
  async activate(
    @Req() request: FastifyRequest,
    @Param('role') raw: string,
    @Param('definitionId') definitionId: string,
    @Body() body: unknown,
  ) {
    return this.agents.activate(workspaceContext(request), role(raw), id(definitionId), {
      reason: parse(reasonBody, body).reason,
      idempotencyKey: idempotencyKey(request),
    });
  }

  @Get('agent-roles/:role/outputs')
  @ApiOperation({ summary: 'Outputs the role produced in the workspace (metadata, no content)' })
  @RequireWorkspacePermission('agent_definition.read')
  async outputs(
    @Req() request: FastifyRequest,
    @Param('role') raw: string,
    @Query() query: unknown,
  ) {
    return this.agents.outputs(workspaceContext(request), role(raw), parse(outputsQuery, query));
  }

  @Get('projects/:projectId/agents')
  @ApiOperation({ summary: 'The definition each role runs with in a project' })
  @RequireWorkspacePermission('agent_definition.read')
  async projectProfiles(@Req() request: FastifyRequest, @Param('projectId') projectId: string) {
    return this.agents.projectProfiles(workspaceContext(request), id(projectId));
  }

  @Get('projects/:projectId/agents/:role')
  @ApiOperation({
    summary: "One role in a project: effective definition, the default and the project's copies",
  })
  @RequireWorkspacePermission('agent_definition.read')
  async projectRole(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('role') raw: string,
  ) {
    return this.agents.projectRole(workspaceContext(request), id(projectId), role(raw));
  }

  @Post('projects/:projectId/agents/:role/copy-default')
  @ApiOperation({ summary: "Give the project its own copy of the role's current default" })
  @RequireWorkspacePermission('agent_definition.update')
  async copyDefault(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('role') raw: string,
    @Body() body: unknown,
  ) {
    return this.agents.copyDefault(workspaceContext(request), id(projectId), role(raw), {
      reason: parse(reasonBody, body).reason,
      idempotencyKey: idempotencyKey(request),
    });
  }

  @Patch('projects/:projectId/agents/:role')
  @ApiOperation({ summary: "Edit the project's own copy (appends a version of it)" })
  @RequireWorkspacePermission('agent_definition.update')
  async updateProjectCopy(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('role') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(updateBody, body);
    return this.agents.updateProjectCopy(workspaceContext(request), id(projectId), role(raw), {
      changes: asChanges(input.changes),
      reason: input.reason,
      expectedSequence: input.expectedSequence,
      idempotencyKey: idempotencyKey(request),
    });
  }

  @Post('projects/:projectId/agents/:role/pin')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Move the project to a default version (the current one) or to an earlier own copy',
  })
  @RequireWorkspacePermission('agent_definition.update')
  async pin(
    @Req() request: FastifyRequest,
    @Param('projectId') projectId: string,
    @Param('role') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(pinBody, body);
    return this.agents.pinProject(workspaceContext(request), id(projectId), role(raw), {
      versionId: input.versionId?.toLowerCase(),
      reason: input.reason,
      idempotencyKey: idempotencyKey(request),
    });
  }
}
