import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AGENT_ROLES } from '@docoo/domain';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { BusinessService } from './business.service.js';

const webAddress = z.url({ protocol: /^https?$/u }).max(500);
const connectionSchema = z
  .object({
    apiUrl: webAddress,
    webUrl: webAddress.nullable().optional(),
    // Write-only: left out when only the addresses change.
    token: z.string().trim().min(32).max(512).optional(),
  })
  .strict();
const linkSchema = z
  .object({
    externalBusinessId: z.string().trim().min(1).max(100),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();
const reasonSchema = z.object({ reason: z.string().trim().max(1000).optional() }).strict();
const browseQuery = z
  .object({
    q: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const contextQuery = z.object({ role: z.enum(AGENT_ROLES).optional() }).strict();

function invalid() {
  return badRequest('BUSINESS_INVALID_REQUEST', 'Provide a valid business request.');
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

@ApiTags('business')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class BusinessController {
  constructor(private readonly business: BusinessService) {}

  // ---- the connection to Contenter --------------------------------------------------------

  @Get('integrations/contenter')
  @ApiOperation({ summary: 'The connection to Contenter (the token is never returned)' })
  @RequireWorkspacePermission('integration.read')
  async connection(@Req() request: FastifyRequest) {
    return { connection: await this.business.connection(workspaceContext(request)) };
  }

  @Put('integrations/contenter')
  @ApiOperation({ summary: 'Set the address and the write-only service token of Contenter' })
  @RequireWorkspacePermission('integration.configure')
  async save(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parse(connectionSchema, body);
    return {
      connection: await this.business.saveConnection(workspaceContext(request), {
        apiUrl: input.apiUrl,
        webUrl: input.webUrl ?? null,
        token: input.token,
      }),
    };
  }

  @Post('integrations/contenter/test')
  @HttpCode(200)
  @ApiOperation({ summary: 'Try the connection to Contenter' })
  @RequireWorkspacePermission('integration.configure')
  async test(@Req() request: FastifyRequest) {
    return { connection: await this.business.testConnection(workspaceContext(request)) };
  }

  @Delete('integrations/contenter')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove the connection to Contenter (saved snapshots stay)' })
  @RequireWorkspacePermission('integration.configure')
  async remove(@Req() request: FastifyRequest) {
    await this.business.removeConnection(workspaceContext(request));
  }

  // ---- browsing Contenter ----------------------------------------------------------------------

  @Get('contenter-businesses')
  @ApiOperation({ summary: 'The businesses of Contenter a project can be linked to' })
  @RequireWorkspacePermission('business.read')
  async browse(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.business.browse(workspaceContext(request), parse(browseQuery, query));
  }

  // ---- the business of a project ---------------------------------------------------------------

  @Get('projects/:projectId/business')
  @ApiOperation({ summary: 'The business of a project with the snapshot its agents read' })
  @RequireWorkspacePermission('business.read')
  async get(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return this.business.get(workspaceContext(request), id(raw));
  }

  @Put('projects/:projectId/business')
  @ApiOperation({ summary: 'Link the project to a business of Contenter (or change the link)' })
  @RequireWorkspacePermission('business.link')
  async link(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Body() body: unknown,
  ) {
    return this.business.link(workspaceContext(request), id(raw), parse(linkSchema, body));
  }

  @Post('projects/:projectId/business/unlink')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove the link of the project to its business' })
  @RequireWorkspacePermission('business.link')
  async unlink(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Body() body: unknown,
  ) {
    const { reason } = parse(reasonSchema, body);
    return this.business.unlink(workspaceContext(request), id(raw), reason ?? null);
  }

  @Post('projects/:projectId/business/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask Contenter again; a change becomes a new snapshot' })
  @RequireWorkspacePermission('business.link')
  async sync(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    const context = workspaceContext(request);
    const projectId = id(raw);
    const outcome = await this.business.sync(context, projectId);
    return { ...outcome, ...(await this.business.get(context, projectId)) };
  }

  @Get('projects/:projectId/business/snapshots')
  @ApiOperation({ summary: 'The versions of the business Docoo has kept' })
  @RequireWorkspacePermission('business.read')
  async snapshots(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return this.business.snapshots(workspaceContext(request), id(raw));
  }

  @Get('projects/:projectId/business/snapshots/:snapshotId')
  @ApiOperation({ summary: 'One version of the business with its full content' })
  @RequireWorkspacePermission('business.read')
  async snapshot(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Param('snapshotId') snapshotRaw: string,
  ) {
    return this.business.snapshot(workspaceContext(request), id(raw), id(snapshotRaw));
  }

  @Get('projects/:projectId/business/context')
  @ApiOperation({ summary: 'What each agent role is given from the business' })
  @RequireWorkspacePermission('business.read')
  async contextPreview(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Query() query: unknown,
  ) {
    const { role } = parse(contextQuery, query);
    return this.business.contextPreview(workspaceContext(request), id(raw), role ?? null);
  }
}
