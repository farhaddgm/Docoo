import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { ReportsService } from './reports.service.js';

const MAX_RANGE_MS = 400 * 86_400_000;
const range = {
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
};
const ordered = (value: { from?: string | undefined; to?: string | undefined }) =>
  !value.from ||
  !value.to ||
  (new Date(value.from) < new Date(value.to) &&
    new Date(value.to).getTime() - new Date(value.from).getTime() <= MAX_RANGE_MS);

const dashboardQuery = z.object(range).strict().refine(ordered);
const usageQuery = z
  .object({
    ...range,
    projectId: z.uuid().optional(),
    groupBy: z.enum(['project', 'stage', 'day', 'model']).default('stage'),
  })
  .strict()
  .refine(ordered);
const brainBody = z
  .object({ ...range, projectId: z.uuid().optional() })
  .strict()
  .refine(ordered);
const brainListQuery = z
  .object({
    projectId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

function invalid() {
  return badRequest('REPORT_INVALID_REQUEST', 'Provide a valid report request.');
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw invalid();
  return parsed.data;
}

function lower<T extends { projectId?: string | undefined }>(value: T): T {
  return value.projectId ? { ...value, projectId: value.projectId.toLowerCase() } : value;
}

@ApiTags('reports')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Operational dashboard cards with live data' })
  @RequireWorkspacePermission('workspace.read')
  async dashboard(@Req() request: FastifyRequest, @Query() query: unknown) {
    return {
      dashboard: await this.reports.dashboard(
        workspaceContext(request),
        parse(dashboardQuery, query),
      ),
    };
  }

  @Get('reports/usage')
  @ApiOperation({
    summary: 'Tokens and estimated cost by project, stage, day or model in a period',
  })
  @RequireWorkspacePermission('provider.read')
  async usage(@Req() request: FastifyRequest, @Query() query: unknown) {
    return {
      usage: await this.reports.usage(workspaceContext(request), lower(parse(usageQuery, query))),
    };
  }

  @Post('brain-reports')
  @HttpCode(201)
  @ApiOperation({ summary: 'Generate a project or workspace Brain report (read-only analysis)' })
  @RequireWorkspacePermission('knowledge.audit')
  async generate(@Req() request: FastifyRequest, @Body() body: unknown) {
    return {
      report: await this.reports.generateBrainReport(
        workspaceContext(request),
        lower(parse(brainBody, body)),
      ),
    };
  }

  @Get('brain-reports')
  @ApiOperation({ summary: 'Brain reports, newest first' })
  @RequireWorkspacePermission('knowledge.read')
  async list(@Req() request: FastifyRequest, @Query() query: unknown) {
    return {
      items: await this.reports.brainReports(
        workspaceContext(request),
        lower(parse(brainListQuery, query)),
      ),
    };
  }

  @Get('brain-reports/:reportId')
  @ApiOperation({ summary: 'A Brain report with deviations, evidence and recommendations' })
  @RequireWorkspacePermission('knowledge.read')
  async get(@Req() request: FastifyRequest, @Param('reportId') raw: string) {
    if (!isUuid(raw)) throw invalid();
    return { report: await this.reports.brainReport(workspaceContext(request), raw.toLowerCase()) };
  }
}
