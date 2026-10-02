import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { pageQuerySchema } from '../common/pagination.js';
import { badRequest } from '../common/problems.js';
import { workspaceContext } from '../common/request-context.js';
import { AuditService } from './audit.service.js';
import { RetentionService } from './retention.service.js';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const timestamp = z.iso.datetime({ offset: true });
const filterShape = {
  projectId: uuid.optional(),
  targetType: z
    .string()
    .regex(/^[a-z_]{1,40}$/)
    .optional(),
  targetId: uuid.optional(),
  action: z
    .string()
    .regex(/^[a-z_]+(\.[a-z_]+)*(\.\*)?$/)
    .max(100)
    .optional(),
  actorId: uuid.optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  securityRelevant: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
};

const listQuerySchema = z.object({ ...pageQuerySchema, ...filterShape }).strict();
const exportSchema = z
  .object({
    format: z.enum(['json', 'csv']).default('json'),
    filters: z
      .object({ ...filterShape, securityRelevant: z.boolean().optional() })
      .strict()
      .default({}),
  })
  .strict();
const purgeSchema = z
  .object({ reason: z.string().trim().min(1).max(1000), dryRun: z.boolean().default(false) })
  .strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) throw badRequest('AUDIT_INVALID_REQUEST', 'Provide valid audit filters.');
  return parsed.data;
}

@ApiTags('audit')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly retentionService: RetentionService,
  ) {}

  @Get('audit-events')
  @ApiOperation({ summary: 'Filter the append-only audit log (newest first)' })
  @RequireWorkspacePermission('audit.read')
  async list(@Req() request: FastifyRequest, @Query() query: unknown) {
    const { limit, cursor, ...filters } = parse(listQuerySchema, query);
    return this.auditService.list(workspaceContext(request), filters, {
      limit,
      cursor,
    });
  }

  @Post('audit-events/export')
  @HttpCode(200)
  @ApiOperation({ summary: 'Export filtered audit events as JSON or CSV (audited)' })
  @RequireWorkspacePermission('audit.export')
  async export(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const input = parse(exportSchema, body);
    const result = await this.auditService.export(
      workspaceContext(request),
      input.filters,
      input.format,
    );
    reply.header('X-Export-Count', String(result.count));
    reply.header('X-Export-Truncated', String(result.truncated));
    reply.header('Content-Disposition', `attachment; filename="docoo-audit.${input.format}"`);
    reply.type(input.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8');
    return result.body;
  }

  @Post('retention/purge')
  @HttpCode(200)
  @ApiOperation({ summary: 'Purge soft-deleted items whose recovery window ended' })
  @RequireWorkspacePermission('retention.purge')
  async purge(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parse(purgeSchema, body);
    return this.retentionService.purge(workspaceContext(request), input.reason, input.dryRun);
  }
}
