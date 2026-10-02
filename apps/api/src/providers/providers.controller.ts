import {
  Body,
  Controller,
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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { requireIfMatch, setVersionHeader } from '../common/concurrency.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { ProvidersService } from './providers.service.js';

const providerSchema = z.enum(['openai', 'gemini', 'anthropic', 'fake']);
const nameSchema = z.string().trim().min(1).max(100);
const baseUrlSchema = z.url({ protocol: /^https?$/u }).max(500);
const secretSchema = z.string().min(8).max(4096);
const reasonSchema = z.string().trim().min(3).max(1000);

const createSchema = z
  .object({
    provider: providerSchema,
    name: nameSchema,
    baseUrl: baseUrlSchema.optional(),
    secret: secretSchema.optional(),
    storeContent: z.boolean().default(false),
  })
  .strict();
const updateSchema = z
  .object({
    name: nameSchema.optional(),
    baseUrl: baseUrlSchema.nullable().optional(),
    storeContent: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const rotateSchema = z.object({ secret: secretSchema, reason: reasonSchema }).strict();
const disableSchema = z.object({ reason: reasonSchema }).strict();
const priceSchema = z
  .object({
    provider: providerSchema,
    model: z.string().trim().min(1).max(200),
    inputPerMillion: z.number().min(0).max(10_000),
    outputPerMillion: z.number().min(0).max(10_000),
    cachedInputPerMillion: z.number().min(0).max(10_000).optional(),
    reasoningPerMillion: z.number().min(0).max(10_000).optional(),
    effectiveFrom: z.iso.datetime({ offset: true }),
  })
  .strict();
const invocationsQuery = z
  .object({
    projectId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
const usageQuery = z
  .object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

function invalid() {
  return badRequest('PROVIDER_INVALID_REQUEST', 'Provide a valid provider request.');
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

@ApiTags('providers')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get('provider-connections')
  @ApiOperation({ summary: 'List provider connections (secrets are never returned)' })
  @RequireWorkspacePermission('provider.read')
  async list(@Req() request: FastifyRequest) {
    return { items: await this.providers.list(workspaceContext(request)) };
  }

  @Post('provider-connections')
  @ApiOperation({ summary: 'Create a provider connection; the secret is encrypted and write-only' })
  @RequireWorkspacePermission('provider.configure')
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const connection = await this.providers.create(
      workspaceContext(request),
      parse(createSchema, body),
    );
    setVersionHeader(reply, connection.version);
    return { connection };
  }

  @Get('provider-connections/:connectionId')
  @ApiOperation({ summary: 'Read a provider connection with health status' })
  @RequireWorkspacePermission('provider.read')
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('connectionId') raw: string,
  ) {
    const connection = await this.providers.get(workspaceContext(request), id(raw));
    setVersionHeader(reply, connection.version);
    return { connection };
  }

  @Patch('provider-connections/:connectionId')
  @ApiOperation({ summary: 'Edit a provider connection; requires If-Match' })
  @RequireWorkspacePermission('provider.configure')
  async update(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('connectionId') raw: string,
    @Body() body: unknown,
  ) {
    const connectionId = id(raw);
    const input = parse(updateSchema, body);
    const connection = await this.providers.update(
      workspaceContext(request),
      connectionId,
      requireIfMatch(request, 'PROVIDER'),
      input,
    );
    setVersionHeader(reply, connection.version);
    return { connection };
  }

  @Post('provider-connections/:connectionId/rotate-secret')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the secret as a new version' })
  @RequireWorkspacePermission('provider.rotate_secret')
  async rotate(
    @Req() request: FastifyRequest,
    @Param('connectionId') raw: string,
    @Body() body: unknown,
  ) {
    return {
      connection: await this.providers.rotateSecret(
        workspaceContext(request),
        id(raw),
        parse(rotateSchema, body),
      ),
    };
  }

  @Post('provider-connections/:connectionId/disable')
  @HttpCode(200)
  @ApiOperation({ summary: 'Disable a provider connection' })
  @RequireWorkspacePermission('provider.configure')
  async disable(
    @Req() request: FastifyRequest,
    @Param('connectionId') raw: string,
    @Body() body: unknown,
  ) {
    const { reason } = parse(disableSchema, body);
    return { connection: await this.providers.disable(workspaceContext(request), id(raw), reason) };
  }

  @Post('provider-connections/:connectionId/health-check')
  @HttpCode(200)
  @ApiOperation({ summary: 'Check provider health without customer data' })
  @RequireWorkspacePermission('provider.test')
  async health(@Req() request: FastifyRequest, @Param('connectionId') raw: string) {
    return { connection: await this.providers.healthCheck(workspaceContext(request), id(raw)) };
  }

  @Post('provider-connections/:connectionId/models/refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refresh the model catalog into a dated snapshot' })
  @RequireWorkspacePermission('provider.configure')
  async refresh(@Req() request: FastifyRequest, @Param('connectionId') raw: string) {
    return { catalog: await this.providers.refreshModels(workspaceContext(request), id(raw)) };
  }

  @Get('provider-connections/:connectionId/models')
  @ApiOperation({ summary: 'Latest model catalog snapshot' })
  @RequireWorkspacePermission('provider.read')
  async models(@Req() request: FastifyRequest, @Param('connectionId') raw: string) {
    return { catalog: await this.providers.models(workspaceContext(request), id(raw)) };
  }

  @Get('model-prices')
  @ApiOperation({ summary: 'Dated model price snapshots (estimates)' })
  @RequireWorkspacePermission('provider.read')
  async prices(@Req() request: FastifyRequest) {
    return { items: await this.providers.listPrices(workspaceContext(request)) };
  }

  @Post('model-prices')
  @ApiOperation({ summary: 'Add a dated model price snapshot' })
  @RequireWorkspacePermission('provider.configure')
  async addPrice(@Req() request: FastifyRequest, @Body() body: unknown) {
    return {
      price: await this.providers.addPrice(workspaceContext(request), parse(priceSchema, body)),
    };
  }

  @Get('model-invocations')
  @ApiOperation({ summary: 'Model invocations with usage, latency, finish reason and cost' })
  @RequireWorkspacePermission('provider.read')
  async invocations(@Req() request: FastifyRequest, @Query() query: unknown) {
    return {
      items: await this.providers.invocations(
        workspaceContext(request),
        parse(invocationsQuery, query),
      ),
    };
  }

  @Get('projects/:projectId/usage')
  @ApiOperation({ summary: 'Project usage and estimated cost per stage, against the cost ceiling' })
  @RequireWorkspacePermission('project.read')
  async usage(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Query() query: unknown,
  ) {
    return {
      usage: await this.providers.projectUsage(
        workspaceContext(request),
        id(raw),
        parse(usageQuery, query),
      ),
    };
  }
}
