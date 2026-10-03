import { Body, Controller, Get, HttpCode, Post, Put, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { workspaceContext } from '../common/request-context.js';
import { ConfigService } from './config.service.js';

const scopeSchema = {
  scopeType: z.enum(['workspace', 'topic', 'project']),
  scopeId: z.uuid().transform((value) => value.toLowerCase()),
};
const keySchema = z.string().regex(/^[a-z][a-z0-9_.]{2,99}$/);
const reasonSchema = z.string().trim().min(1).max(1000);
const scalarValue = z.union([z.boolean(), z.number(), z.string().max(10_000)]);
const jsonValue = z.union([scalarValue, z.array(scalarValue).max(100), z.null()]);

const scopeQuerySchema = z.object(scopeSchema).strict();
const historyQuerySchema = z.object({ ...scopeSchema, key: keySchema }).strict();
const setSchema = z
  .object({
    ...scopeSchema,
    key: keySchema,
    value: jsonValue,
    reason: reasonSchema,
    expectedSequence: z.number().int().min(0).optional(),
  })
  .strict();
const restoreSchema = z
  .object({
    ...scopeSchema,
    key: keySchema,
    sequence: z.number().int().min(1),
    reason: reasonSchema,
  })
  .strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success)
    throw badRequest('CONFIG_INVALID_REQUEST', 'Provide a valid settings request.');
  return parsed.data;
}

@ApiTags('settings')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/settings')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get('definitions')
  @ApiOperation({ summary: 'List setting definitions with defaults and allowed scopes' })
  @RequireWorkspacePermission('workspace.read')
  async definitions(@Req() request: FastifyRequest) {
    return { items: await this.configService.definitions(workspaceContext(request)) };
  }

  @Get('assignments')
  @ApiOperation({ summary: 'Current values set directly on a scope' })
  @RequireWorkspacePermission('workspace.read')
  async assignments(@Req() request: FastifyRequest, @Query() query: unknown) {
    const { scopeType, scopeId } = parse(scopeQuerySchema, query);
    const items = await this.configService.currentAssignments(
      workspaceContext(request),
      scopeType,
      scopeId,
    );
    return { items };
  }

  @Get('assignments/history')
  @ApiOperation({ summary: 'Every version of one setting on one scope' })
  @RequireWorkspacePermission('workspace.read')
  async history(@Req() request: FastifyRequest, @Query() query: unknown) {
    const { key, scopeType, scopeId } = parse(historyQuerySchema, query);
    const items = await this.configService.history(
      workspaceContext(request),
      key,
      scopeType,
      scopeId,
    );
    return { items };
  }

  @Put('assignments')
  @ApiOperation({ summary: 'Set or clear (value: null) a setting; appends a new version' })
  @RequireWorkspacePermission('workspace.configure')
  async set(@Req() request: FastifyRequest, @Body() body: unknown) {
    const assignment = await this.configService.set(
      workspaceContext(request),
      parse(setSchema, body),
    );
    return { assignment };
  }

  @Post('assignments/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore an earlier version as a new version' })
  @RequireWorkspacePermission('workspace.configure')
  async restore(@Req() request: FastifyRequest, @Body() body: unknown) {
    const assignment = await this.configService.restore(
      workspaceContext(request),
      parse(restoreSchema, body),
    );
    return { assignment };
  }

  @Get('effective')
  @ApiOperation({ summary: 'Effective values and the source of each value for a scope' })
  @RequireWorkspacePermission('workspace.read')
  async effective(@Req() request: FastifyRequest, @Query() query: unknown) {
    const { scopeType, scopeId } = parse(scopeQuerySchema, query);
    return {
      config: await this.configService.effective(workspaceContext(request), scopeType, scopeId),
    };
  }
}
