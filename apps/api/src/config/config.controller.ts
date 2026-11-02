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
const setManySchema = z
  .object({
    ...scopeSchema,
    items: z
      .array(z.object({ key: keySchema, value: jsonValue }).strict())
      .min(1)
      .max(20)
      .refine((items) => new Set(items.map((item) => item.key)).size === items.length),
    reason: reasonSchema,
  })
  .strict();
const previewSchema = z
  .object({
    topicIds: z
      .array(z.uuid().transform((value) => value.toLowerCase()))
      .max(20)
      .default([]),
    settings: z
      .array(z.object({ key: keySchema, value: jsonValue }).strict())
      .max(40)
      .default([]),
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

  @Put('assignments/batch')
  @ApiOperation({
    summary: 'Set or clear several settings of one scope together, all or none (a preset)',
  })
  @RequireWorkspacePermission('workspace.configure')
  async setMany(@Req() request: FastifyRequest, @Body() body: unknown) {
    const assignments = await this.configService.setMany(
      workspaceContext(request),
      parse(setManySchema, body),
    );
    return { assignments };
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

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Effective values a new project would start with, before it is created',
  })
  @RequireWorkspacePermission('workspace.read')
  async preview(@Req() request: FastifyRequest, @Body() body: unknown) {
    return {
      config: await this.configService.preview(
        workspaceContext(request),
        parse(previewSchema, body),
      ),
    };
  }

  @Get('research-estimate')
  @ApiOperation({
    summary: 'What one unit of research costs here, from completed research stages (or null)',
  })
  @RequireWorkspacePermission('workspace.read')
  async researchEstimate(@Req() request: FastifyRequest) {
    return { unit: await this.configService.researchUnitCost(workspaceContext(request)) };
  }

  @Get('research-quality')
  @ApiOperation({
    summary: 'How each research mode fared in this workspace, from its completed research stages',
  })
  @RequireWorkspacePermission('workspace.read')
  async researchQuality(@Req() request: FastifyRequest) {
    return { modes: await this.configService.researchQuality(workspaceContext(request)) };
  }

  @Get('research-source-suggestions')
  @ApiOperation({
    summary: 'Domains trusted again and again in research conflicts, not yet on the official list',
  })
  @RequireWorkspacePermission('workspace.read')
  async researchSourceSuggestions(@Req() request: FastifyRequest) {
    return { items: await this.configService.researchSourceSuggestions(workspaceContext(request)) };
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
