import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { requireIfMatch, setVersionHeader } from '../common/concurrency.js';
import { pageQuerySchema } from '../common/pagination.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { SourcesService } from './sources.service.js';

const scopeSchema = z
  .object({ type: z.enum(['workspace', 'topic', 'project']), id: z.uuid() })
  .strict();
const titleSchema = z.string().trim().min(1).max(300);
const fileSchema = {
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[^/\\\0]+$/u),
  mime: z.string().trim().min(3).max(120).toLowerCase(),
  size: z.number().int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
};

const uploadSchema = z.object({ title: titleSchema, scope: scopeSchema, ...fileSchema }).strict();
const versionUploadSchema = z
  .object({ ...fileSchema, reason: z.string().trim().min(1).max(1000).optional() })
  .strict();
const textSchema = z
  .object({
    title: titleSchema,
    scope: scopeSchema,
    text: z.string().min(1).max(5_000_000),
    language: z.enum(['fa', 'en']).default('fa'),
  })
  .strict();
const urlSchema = z
  .object({
    title: titleSchema,
    scope: scopeSchema,
    url: z.string().trim().min(8).max(2048),
    language: z.enum(['fa', 'en']).default('fa'),
  })
  .strict();
const listSchema = z
  .object({
    ...pageQuerySchema,
    status: z
      .enum([
        'uploaded',
        'quarantined',
        'scanning',
        'accepted',
        'extracting',
        'indexed',
        'rejected',
        'failed',
        'partial',
      ])
      .optional(),
    scopeType: z.enum(['workspace', 'topic', 'project']).optional(),
    scopeId: z.uuid().optional(),
    q: z.string().trim().min(1).max(100).optional(),
  })
  .strict()
  .refine((query) => (query.scopeType === undefined) === (query.scopeId === undefined));
const segmentQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    after: z.coerce.number().int().min(0).default(0),
  })
  .strict();

function invalid() {
  return badRequest('SOURCE_INVALID_REQUEST', 'Provide a valid source request.');
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

@ApiTags('sources')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  @ApiOperation({ summary: 'List sources with their current version status' })
  @RequireWorkspacePermission('knowledge.read')
  async list(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.sources.list(workspaceContext(request), parse(listSchema, query));
  }

  @Post('uploads')
  @ApiOperation({ summary: 'Declare a file and get a presigned direct upload URL (quarantine)' })
  @RequireWorkspacePermission('knowledge.create')
  async upload(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const result = await this.sources.createUpload(
      workspaceContext(request),
      parse(uploadSchema, body),
    );
    setVersionHeader(reply, result.source.version);
    return result;
  }

  @Post('text')
  @HttpCode(202)
  @ApiOperation({ summary: 'Add pasted text as a source and start ingestion' })
  @RequireWorkspacePermission('knowledge.create')
  async text(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.sources.createText(workspaceContext(request), parse(textSchema, body));
  }

  @Post('url')
  @HttpCode(202)
  @ApiOperation({ summary: 'Add a URL (allowlist and SSRF guarded) and start ingestion' })
  @RequireWorkspacePermission('knowledge.create')
  async url(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.sources.createUrl(workspaceContext(request), parse(urlSchema, body));
  }

  @Get(':sourceId')
  @ApiOperation({ summary: 'Read a source with every version (lineage)' })
  @RequireWorkspacePermission('knowledge.read')
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('sourceId') raw: string,
  ) {
    const source = await this.sources.get(workspaceContext(request), id(raw));
    setVersionHeader(reply, source.version);
    return { source };
  }

  @Post(':sourceId/versions')
  @ApiOperation({
    summary: 'Declare a new file version; requires If-Match with the source version',
  })
  @RequireWorkspacePermission('knowledge.update')
  async newVersion(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('sourceId') raw: string,
    @Body() body: unknown,
  ) {
    const sourceId = id(raw);
    const input = parse(versionUploadSchema, body);
    const expected = requireIfMatch(request, 'SOURCE');
    const result = await this.sources.createVersionUpload(
      workspaceContext(request),
      sourceId,
      expected,
      input,
    );
    setVersionHeader(reply, result.source.version);
    return result;
  }

  @Post(':sourceId/versions/:versionId/finalize')
  @HttpCode(202)
  @ApiOperation({ summary: 'Confirm the upload and start quarantine scan and extraction' })
  @RequireWorkspacePermission('knowledge.create')
  async finalize(
    @Req() request: FastifyRequest,
    @Param('sourceId') rawSource: string,
    @Param('versionId') rawVersion: string,
  ) {
    const version = await this.sources.finalize(
      workspaceContext(request),
      id(rawSource),
      id(rawVersion),
    );
    return { version };
  }

  @Post(':sourceId/versions/:versionId/retry')
  @HttpCode(202)
  @ApiOperation({ summary: 'Retry ingestion of a quarantined or failed version' })
  @RequireWorkspacePermission('knowledge.update')
  async retry(
    @Req() request: FastifyRequest,
    @Param('sourceId') rawSource: string,
    @Param('versionId') rawVersion: string,
  ) {
    const version = await this.sources.retry(
      workspaceContext(request),
      id(rawSource),
      id(rawVersion),
    );
    return { version };
  }

  @Get(':sourceId/versions/:versionId/segments')
  @ApiOperation({ summary: 'Extracted text segments with their location in the original file' })
  @RequireWorkspacePermission('knowledge.read')
  async segments(
    @Req() request: FastifyRequest,
    @Param('sourceId') rawSource: string,
    @Param('versionId') rawVersion: string,
    @Query() query: unknown,
  ) {
    return this.sources.segments(
      workspaceContext(request),
      id(rawSource),
      id(rawVersion),
      parse(segmentQuerySchema, query),
    );
  }
}
