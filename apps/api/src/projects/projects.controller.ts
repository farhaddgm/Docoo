import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { projectStatuses, type ProjectCommand } from '@docoo/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission, roleHasPermission } from '../auth/auth.authorization.js';
import { requireIfMatch, setVersionHeader } from '../common/concurrency.js';
import { pageQuerySchema } from '../common/pagination.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { ConfigService } from '../config/config.service.js';
import { WorkflowService } from '../workflow/workflow.service.js';
import { PROJECT_MAX_TOPICS, ProjectsService } from './projects.service.js';

const codeSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const titleSchema = z.string().trim().min(1).max(200);
const descriptionSchema = z.string().trim().max(10_000);
const problemSchema = z.string().trim().min(1).max(50_000);
const languageSchema = z.enum(['fa', 'en']);
const reasonSchema = z.string().trim().min(1).max(1000);
const topicsSchema = z
  .array(
    z
      .object({
        topicId: z.uuid().transform((value) => value.toLowerCase()),
        conflictInstruction: z.string().trim().min(1).max(2000).optional(),
      })
      .strict(),
  )
  .max(PROJECT_MAX_TOPICS);

const listQuerySchema = z
  .object({
    ...pageQuerySchema,
    status: z.enum([...projectStatuses, 'current', 'all']).default('current'),
    topicId: z
      .uuid()
      .transform((value) => value.toLowerCase())
      .optional(),
    language: z.enum(['fa', 'en']).optional(),
    updatedFrom: z.iso.date().optional(),
    updatedTo: z.iso.date().optional(),
    waiting: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const pageSchema = z.object(pageQuerySchema).strict();

const settingScalar = z.union([z.boolean(), z.number(), z.string().max(10_000)]);
const settingsSchema = z
  .array(
    z
      .object({
        key: z.string().regex(/^[a-z][a-z0-9_.]{2,99}$/),
        value: z.union([settingScalar, z.array(settingScalar).max(100)]),
      })
      .strict(),
  )
  .max(40);

const createSchema = z
  .object({
    code: codeSchema,
    title: titleSchema,
    description: descriptionSchema.default(''),
    initialProblem: problemSchema,
    outputLanguage: languageSchema.default('fa'),
    topics: topicsSchema.default([]),
    settings: settingsSchema.default([]),
    // The id of a business in Contenter; the project is linked to it as it is created.
    businessId: z.string().trim().min(1).max(100).optional(),
    solutionCriteria: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(64),
            label: z.string().trim().min(1).max(200),
            weight: z.number().int().min(0).max(100),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .optional(),
  })
  .strict();

const updateSchema = z
  .object({
    code: codeSchema.optional(),
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    initialProblem: problemSchema.optional(),
    outputLanguage: languageSchema.optional(),
    topics: topicsSchema.optional(),
    reason: reasonSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'reason'));

const commandSchema = z
  .object({ expectedVersion: z.number().int().min(1), reason: reasonSchema.optional() })
  .strict();
const cloneSchema = z.object({ code: codeSchema, title: titleSchema.optional() }).strict();

function invalidRequest() {
  return badRequest('PROJECT_INVALID_REQUEST', 'Provide a valid project request.');
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

function projectId(raw: string): string {
  if (!isUuid(raw)) throw invalidRequest();
  return raw.toLowerCase();
}

@ApiTags('projects')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
    private readonly workflowService: WorkflowService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List projects (default: every status except deleted)' })
  @RequireWorkspacePermission('project.read')
  async list(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.projectsService.list(workspaceContext(request), parse(listQuerySchema, query));
  }

  @Post()
  @ApiOperation({ summary: 'Create a draft project with prioritized topics' })
  @RequireWorkspacePermission('project.create')
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parse(createSchema, body);
    // Starting values are settings: whoever may create projects but not configure the
    // workspace cannot use the project form to change them.
    const authorization = request.workspaceAuthorization;
    if (
      input.settings.length > 0 &&
      (!authorization || !roleHasPermission(authorization.workspace.role, 'workspace.configure'))
    ) {
      throw new ForbiddenException(
        'Setting values needs the permission to configure the workspace.',
      );
    }
    if (
      input.solutionCriteria &&
      (!authorization || !roleHasPermission(authorization.workspace.role, 'project.update'))
    ) {
      throw new ForbiddenException('Choosing criteria needs the permission to edit projects.');
    }
    if (
      input.businessId &&
      (!authorization || !roleHasPermission(authorization.workspace.role, 'business.link'))
    ) {
      throw new ForbiddenException('Linking a business needs the permission to link businesses.');
    }
    const project = await this.projectsService.create(workspaceContext(request), input);
    setVersionHeader(reply, project.version);
    return { project };
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Read a project with stage, pause reason, next action and topics' })
  @RequireWorkspacePermission('project.read')
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') rawId: string,
  ) {
    const project = await this.projectsService.get(workspaceContext(request), projectId(rawId));
    setVersionHeader(reply, project.version);
    return { project };
  }

  @Patch(':projectId')
  @ApiOperation({ summary: 'Edit a project; requires If-Match with the current version' })
  @RequireWorkspacePermission('project.update')
  async update(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('projectId') rawId: string,
    @Body() body: unknown,
  ) {
    const id = projectId(rawId);
    const input = parse(updateSchema, body);
    const project = await this.projectsService.update(
      workspaceContext(request),
      id,
      requireIfMatch(request, 'PROJECT'),
      input,
    );
    setVersionHeader(reply, project.version);
    return { project };
  }

  @Post(':projectId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'draft → active; pins the effective config' })
  @RequireWorkspacePermission('project.run')
  activate(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.command(request, id, 'activate', body);
  }

  @Post(':projectId/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'active → paused (reason required)' })
  @RequireWorkspacePermission('project.pause')
  pause(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.command(request, id, 'pause', body);
  }

  @Post(':projectId/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'paused → active; pins the effective config again' })
  @RequireWorkspacePermission('project.resume')
  resume(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.command(request, id, 'resume', body);
  }

  @Post(':projectId/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'active/paused → completed (reason required)' })
  @RequireWorkspacePermission('project.run')
  complete(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.command(request, id, 'complete', body);
  }

  @Post(':projectId/reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'completed → active (reason required)' })
  @RequireWorkspacePermission('project.run')
  reopen(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.command(request, id, 'reopen', body);
  }

  @Post(':projectId/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive a project (read-only until unarchived)' })
  @RequireWorkspacePermission('project.archive')
  archive(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.command(request, id, 'archive', body);
  }

  @Post(':projectId/unarchive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Return an archived project to its previous status' })
  @RequireWorkspacePermission('project.archive')
  unarchive(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.command(request, id, 'unarchive', body);
  }

  @Post(':projectId/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore a deleted project within 30 days' })
  @RequireWorkspacePermission('project.restore')
  restore(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.command(request, id, 'restore', body);
  }

  @Delete(':projectId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Soft-delete a project; recoverable for 30 days' })
  @RequireWorkspacePermission('project.delete')
  delete(@Req() request: FastifyRequest, @Param('projectId') id: string, @Body() body: unknown) {
    return this.command(request, id, 'delete', body);
  }

  @Post(':projectId/clone')
  @ApiOperation({ summary: 'Clone settings and topics into a new draft (no history or audit)' })
  @RequireWorkspacePermission('project.create')
  async clone(
    @Req() request: FastifyRequest,
    @Param('projectId') rawId: string,
    @Body() body: unknown,
  ) {
    const id = projectId(rawId);
    return this.projectsService.clone(workspaceContext(request), id, parse(cloneSchema, body));
  }

  @Get(':projectId/timeline')
  @ApiOperation({ summary: 'Project timeline from the audit log' })
  @RequireWorkspacePermission('project.read')
  async timeline(
    @Req() request: FastifyRequest,
    @Param('projectId') rawId: string,
    @Query() query: unknown,
  ) {
    const id = projectId(rawId);
    return this.projectsService.timeline(workspaceContext(request), id, parse(pageSchema, query));
  }

  @Get(':projectId/effective-config')
  @ApiOperation({ summary: 'Effective settings of the project with the source of each value' })
  @RequireWorkspacePermission('project.read')
  async effectiveConfig(@Req() request: FastifyRequest, @Param('projectId') rawId: string) {
    const id = projectId(rawId);
    return { config: await this.configService.effective(workspaceContext(request), 'project', id) };
  }

  @Get(':projectId/config-snapshots')
  @ApiOperation({ summary: 'Config snapshots pinned at activation and resume boundaries' })
  @RequireWorkspacePermission('project.read')
  async snapshots(@Req() request: FastifyRequest, @Param('projectId') rawId: string) {
    const id = projectId(rawId);
    return { items: await this.configService.snapshots(workspaceContext(request), 'project', id) };
  }

  private async command(
    request: FastifyRequest,
    rawId: string,
    command: ProjectCommand,
    body: unknown,
  ) {
    const id = projectId(rawId);
    const input = parse(commandSchema, body);
    const context = workspaceContext(request);
    const project = await this.projectsService.command(context, id, command, input);
    // Start, pause, resume or cancel the project workflow to match (WF-001, WF-004).
    await this.workflowService.onProjectCommand(context, id, command);
    return { project };
  }
}
