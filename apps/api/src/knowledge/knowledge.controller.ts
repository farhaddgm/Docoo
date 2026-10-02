import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { pageQuerySchema } from '../common/pagination.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { KnowledgeService } from './knowledge.service.js';

const scopeSchema = z
  .object({
    type: z.enum(['workspace', 'topic', 'project']),
    id: z.uuid(),
    role: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_.-]*$/u)
      .optional(),
  })
  .strict();
const dateSchema = z.iso.datetime({ offset: true });
const citationSchema = z
  .object({
    sourceRef: z.string().trim().max(2048).optional(),
    title: z.string().trim().max(500).optional(),
    publisher: z.string().trim().max(300).optional(),
    author: z.string().trim().max(300).optional(),
    publishedAt: z.string().trim().max(40).optional(),
    accessedAt: z.string().trim().max(40).optional(),
    locator: z.string().trim().max(300).optional(),
    quote: z.string().max(2000).optional(),
  })
  .strict();
const claimSchema = z
  .object({
    text: z.string().trim().min(1).max(2000),
    kind: z.enum(['numeric', 'causal', 'comparative', 'recommendation', 'statement']).optional(),
    citations: z.array(citationSchema).max(20).optional(),
  })
  .strict();
const provenanceSchema = z.record(
  z.string().max(64),
  z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
);
const contentSchema = z.string().trim().min(1).max(2_000_000);

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    sourceType: z.enum(['admin_provided', 'clue_guided', 'autonomous_research']),
    confidentiality: z.enum(['internal', 'confidential', 'restricted']).default('internal'),
    language: z.enum(['fa', 'en']).default('fa'),
    content: contentSchema,
    scopes: z.array(scopeSchema).min(1).max(50),
    provenance: provenanceSchema.default({}),
    validFrom: dateSchema.optional(),
    validUntil: dateSchema.optional(),
    claims: z.array(claimSchema).max(500).optional(),
  })
  .strict();
const fromSourceSchema = z
  .object({
    sourceId: z.uuid(),
    versionId: z.uuid(),
    title: z.string().trim().min(1).max(300),
    confidentiality: z.enum(['internal', 'confidential', 'restricted']).default('internal'),
    scopes: z.array(scopeSchema).min(1).max(50),
    declaration: z.string().trim().min(3).max(2000),
    acceptPartial: z.boolean().default(false),
  })
  .strict();
const versionSchema = z
  .object({
    content: contentSchema,
    provenance: provenanceSchema.optional(),
    validFrom: dateSchema.optional(),
    validUntil: dateSchema.optional(),
    claims: z.array(claimSchema).max(500).optional(),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const overrideSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().max(2000).default(''),
    expiresAt: dateSchema.optional(),
  })
  .strict();
const resolveSchema = z.object({ resolution: z.string().trim().min(10).max(2000) }).strict();
const retrieveSchema = z
  .object({
    query: z.string().trim().min(1).max(2000),
    projectId: z.uuid().optional(),
    topicId: z.uuid().optional(),
    role: z.string().trim().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();
const listSchema = z
  .object({
    ...pageQuerySchema,
    status: z
      .enum([
        'draft',
        'pending',
        'in_review',
        'approved',
        'rejected',
        'needs_revision',
        'expired',
        'superseded',
      ])
      .optional(),
  })
  .strict();
const reviewsQuerySchema = z
  .object({
    knowledgeId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const conflictsQuerySchema = z
  .object({
    status: z.enum(['open', 'resolved']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
const deleteSchema = z.object({ reason: z.string().trim().min(1).max(1000).optional() }).strict();

function invalid() {
  return badRequest('KNOWLEDGE_INVALID_REQUEST', 'Provide a valid knowledge request.');
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

@ApiTags('knowledge')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('knowledge')
  @ApiOperation({ summary: 'List knowledge items with the status of their current version' })
  @RequireWorkspacePermission('knowledge.read')
  async list(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.knowledge.list(workspaceContext(request), parse(listSchema, query));
  }

  @Post('knowledge')
  @ApiOperation({ summary: 'Create knowledge with scopes, provenance, claims and citations' })
  @RequireWorkspacePermission('knowledge.create')
  async create(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const knowledge = await this.knowledge.create(
      workspaceContext(request),
      parse(createSchema, body),
    );
    setVersionHeader(reply, knowledge.version);
    return { knowledge };
  }

  @Post('knowledge/from-source')
  @ApiOperation({
    summary: 'Create a knowledge candidate with located claims from an extracted source',
  })
  @RequireWorkspacePermission('knowledge.create')
  async fromSource(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: unknown,
  ) {
    const knowledge = await this.knowledge.createFromSource(
      workspaceContext(request),
      parse(fromSourceSchema, body),
    );
    setVersionHeader(reply, knowledge.version);
    return { knowledge };
  }

  @Post('knowledge/retrieve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hybrid retrieval of approved knowledge; pins a retrieval snapshot' })
  @RequireWorkspacePermission('knowledge.read')
  async retrieve(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.knowledge.retrieve(workspaceContext(request), parse(retrieveSchema, body));
  }

  @Get('knowledge/:knowledgeId')
  @ApiOperation({ summary: 'Read knowledge with its current version, claims, review and override' })
  @RequireWorkspacePermission('knowledge.read')
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('knowledgeId') raw: string,
  ) {
    const knowledge = await this.knowledge.get(workspaceContext(request), id(raw));
    setVersionHeader(reply, knowledge.version);
    return { knowledge };
  }

  @Delete('knowledge/:knowledgeId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete knowledge; it leaves retrieval immediately' })
  @RequireWorkspacePermission('knowledge.delete')
  async delete(
    @Req() request: FastifyRequest,
    @Param('knowledgeId') raw: string,
    @Body() body: unknown,
  ) {
    const { reason } = parse(deleteSchema, body);
    return { knowledge: await this.knowledge.delete(workspaceContext(request), id(raw), reason) };
  }

  @Get('knowledge/:knowledgeId/versions')
  @ApiOperation({ summary: 'List knowledge versions' })
  @RequireWorkspacePermission('knowledge.read')
  async versions(@Req() request: FastifyRequest, @Param('knowledgeId') raw: string) {
    return { items: await this.knowledge.versions(workspaceContext(request), id(raw)) };
  }

  @Get('knowledge/:knowledgeId/versions/:versionId')
  @ApiOperation({ summary: 'Read one knowledge version with claims, citations and reviews' })
  @RequireWorkspacePermission('knowledge.read')
  async version(
    @Req() request: FastifyRequest,
    @Param('knowledgeId') raw: string,
    @Param('versionId') rawVersion: string,
  ) {
    return {
      version: await this.knowledge.version(workspaceContext(request), id(raw), id(rawVersion)),
    };
  }

  @Post('knowledge/:knowledgeId/versions')
  @ApiOperation({ summary: 'New content version (pending audit); requires If-Match' })
  @RequireWorkspacePermission('knowledge.update')
  async newVersion(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('knowledgeId') raw: string,
    @Body() body: unknown,
  ) {
    const itemId = id(raw);
    const input = parse(versionSchema, body);
    const expected = requireIfMatch(request, 'KNOWLEDGE');
    const knowledge = await this.knowledge.newVersion(
      workspaceContext(request),
      itemId,
      expected,
      input,
    );
    setVersionHeader(reply, knowledge.version);
    return { knowledge };
  }

  @Post('knowledge/:knowledgeId/submit-audit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Run Brain audit (rubric v1) on the current version' })
  @RequireWorkspacePermission('knowledge.audit')
  async submitAudit(@Req() request: FastifyRequest, @Param('knowledgeId') raw: string) {
    return this.knowledge.submitAudit(workspaceContext(request), id(raw));
  }

  @Get('audit-reviews')
  @ApiOperation({ summary: 'List Brain audit reviews' })
  @RequireWorkspacePermission('knowledge.read')
  async reviews(@Req() request: FastifyRequest, @Query() query: unknown) {
    return {
      items: await this.knowledge.listReviews(
        workspaceContext(request),
        parse(reviewsQuerySchema, query),
      ),
    };
  }

  @Post('audit-reviews/:reviewId/override')
  @HttpCode(200)
  @ApiOperation({ summary: 'Override a Brain decision with a reason (critical audit event)' })
  @RequireWorkspacePermission('knowledge.override')
  async override(
    @Req() request: FastifyRequest,
    @Param('reviewId') raw: string,
    @Body() body: unknown,
  ) {
    return this.knowledge.override(workspaceContext(request), id(raw), parse(overrideSchema, body));
  }

  @Get('knowledge-conflicts')
  @ApiOperation({ summary: 'List knowledge conflicts' })
  @RequireWorkspacePermission('knowledge.read')
  async conflicts(@Req() request: FastifyRequest, @Query() query: unknown) {
    return {
      items: await this.knowledge.listConflicts(
        workspaceContext(request),
        parse(conflictsQuerySchema, query),
      ),
    };
  }

  @Post('knowledge-conflicts/:conflictId/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resolve a knowledge conflict with an explanation' })
  @RequireWorkspacePermission('knowledge.audit')
  async resolve(
    @Req() request: FastifyRequest,
    @Param('conflictId') raw: string,
    @Body() body: unknown,
  ) {
    const { resolution } = parse(resolveSchema, body);
    return {
      conflict: await this.knowledge.resolveConflict(
        workspaceContext(request),
        id(raw),
        resolution,
      ),
    };
  }

  @Get('retrieval-snapshots/:snapshotId')
  @ApiOperation({ summary: 'Read a pinned retrieval snapshot' })
  @RequireWorkspacePermission('knowledge.read')
  async snapshot(@Req() request: FastifyRequest, @Param('snapshotId') raw: string) {
    return { snapshot: await this.knowledge.snapshot(workspaceContext(request), id(raw)) };
  }
}
