import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  COUNT_ALGORITHM,
  DEFAULT_LEVEL_BOUNDS,
  DOCUMENT_TEMPLATES,
  TEMPLATE_KEYS,
} from '@docoo/documents';
import { STAGES } from '@docoo/orchestration';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { requireIfMatch, setVersionHeader } from '../common/concurrency.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { DocumentsService } from './documents.service.js';
import { SolutionsService } from './solutions.service.js';

const reason = z.string().trim().min(3).max(1000);
const optionalReason = z.object({ reason: reason.optional() }).strict();
const requiredReason = z.object({ reason }).strict();
const stage = z.enum(STAGES);

const criteriaSchema = z
  .object({
    criteria: z
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
      .max(20),
    reason,
  })
  .strict();
const generateSchema = z.object({ count: z.number().int().min(2).max(20).optional() }).strict();
const selectSchema = z
  .object({ solutionIds: z.array(z.string().uuid()).min(1).max(20), reason: reason.optional() })
  .strict();
const editSchema = z
  .object({
    content: z.record(z.string(), z.unknown()),
    reason,
    level: z.number().int().min(1).max(5).optional(),
  })
  .strict()
  .refine((value) => JSON.stringify(value.content).length <= 1_000_000);
const exportSchema = z.object({ format: z.enum(['docx', 'pdf', 'pptx']) }).strict();
const rubricSchema = z
  .object({
    rubric: z
      .object({
        criteria: z
          .array(
            z
              .object({
                key: z.string().trim().min(1).max(64),
                label: z.string().trim().min(1).max(200),
                weight: z.number().int().min(0).max(100),
                targetStage: stage,
              })
              .strict(),
          )
          .min(1)
          .max(30),
        passThreshold: z.number().min(0).max(100),
        minimums: z.record(z.string(), z.number().min(0).max(100)),
      })
      .strict(),
    reason,
  })
  .strict();
const retargetSchema = z.object({ targetStage: stage, reason }).strict();
const diffQuery = z.object({ from: z.string().uuid(), to: z.string().uuid() }).strict();

function invalid() {
  return badRequest('DOCUMENT_INVALID_REQUEST', 'Provide a valid document request.');
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

@ApiTags('documents')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly solutions: SolutionsService,
  ) {}

  // ------------------------------------------------------------ templates and levels (ADR-0018)

  @Get('document-templates')
  @ApiOperation({
    summary:
      'The document templates, the default length bounds of the five levels and the count rule',
  })
  @RequireWorkspacePermission('workspace.read')
  documentTemplates() {
    return {
      templates: TEMPLATE_KEYS.map((key) => DOCUMENT_TEMPLATES[key]),
      levelDefaults: DEFAULT_LEVEL_BOUNDS,
      countAlgorithm: COUNT_ALGORITHM,
    };
  }

  // ------------------------------------------------------------ solutions (SOL-001..003)

  @Get('projects/:projectId/solution-criteria')
  @ApiOperation({ summary: 'Current weighted solution criteria of a project' })
  @RequireWorkspacePermission('project.read')
  async criteria(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return { criteria: await this.solutions.criteria(workspaceContext(request), id(raw)) };
  }

  @Put('projects/:projectId/solution-criteria')
  @ApiOperation({ summary: 'Enable and reweight criteria (enabled weights add up to 100)' })
  @RequireWorkspacePermission('project.update')
  async setCriteria(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(criteriaSchema, body);
    return {
      criteria: await this.solutions.setCriteria(workspaceContext(request), id(raw), input),
    };
  }

  @Post('projects/:projectId/solutions/generate')
  @HttpCode(201)
  @ApiOperation({ summary: 'Generate a scored set of solutions with the configured model' })
  @RequireWorkspacePermission('project.run')
  async generate(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(generateSchema, body);
    return {
      solutionSet: await this.solutions.generate(workspaceContext(request), id(raw), input),
    };
  }

  @Get('projects/:projectId/solutions')
  @ApiOperation({ summary: 'Latest solution set with explained scores' })
  @RequireWorkspacePermission('project.read')
  async solutionList(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return { solutionSet: await this.solutions.solutions(workspaceContext(request), id(raw)) };
  }

  @Post('projects/:projectId/solution-selections')
  @HttpCode(201)
  @ApiOperation({ summary: 'Select solutions in priority order; each gets its own document' })
  @RequireWorkspacePermission('workflow.approve')
  async select(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(selectSchema, body);
    return {
      selection: await this.solutions.select(workspaceContext(request), id(raw), {
        solutionIds: input.solutionIds.map((value) => value.toLowerCase()),
        reason: input.reason,
      }),
    };
  }

  // ------------------------------------------------------------ documents (DOC-101..103)

  @Get('projects/:projectId/documents')
  @ApiOperation({ summary: 'Documents of a project in priority order' })
  @RequireWorkspacePermission('document.read')
  async list(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return { items: await this.documents.list(workspaceContext(request), id(raw)) };
  }

  @Get('documents/:documentId')
  @ApiOperation({ summary: 'A document with its current version and latest evaluation' })
  @RequireWorkspacePermission('document.read')
  async get(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('documentId') raw: string,
  ) {
    const document = await this.documents.get(workspaceContext(request), id(raw));
    setVersionHeader(reply, document.version);
    return { document };
  }

  @Put('documents/:documentId/content')
  @ApiOperation({ summary: 'Save an edit as a new version; requires If-Match' })
  @RequireWorkspacePermission('document.edit')
  async edit(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('documentId') raw: string,
    @Body() body: unknown,
  ) {
    const documentId = id(raw);
    const input = parse(editSchema, body);
    const expected = requireIfMatch(request, 'DOCUMENT');
    const document = await this.documents.edit(
      workspaceContext(request),
      documentId,
      expected,
      input,
    );
    setVersionHeader(reply, document.version);
    return { document };
  }

  @Get('documents/:documentId/versions')
  @ApiOperation({ summary: 'Immutable version history' })
  @RequireWorkspacePermission('document.read')
  async versions(@Req() request: FastifyRequest, @Param('documentId') raw: string) {
    return { items: await this.documents.versions(workspaceContext(request), id(raw)) };
  }

  @Get('documents/:documentId/versions/:versionId')
  @ApiOperation({ summary: 'One version with its content' })
  @RequireWorkspacePermission('document.read')
  async version(
    @Req() request: FastifyRequest,
    @Param('documentId') raw: string,
    @Param('versionId') versionId: string,
  ) {
    return {
      version: await this.documents.version(workspaceContext(request), id(raw), id(versionId)),
    };
  }

  @Get('documents/:documentId/diff')
  @ApiOperation({ summary: 'Block-level diff between two versions' })
  @RequireWorkspacePermission('document.read')
  async diff(
    @Req() request: FastifyRequest,
    @Param('documentId') raw: string,
    @Query() query: unknown,
  ) {
    const input = parse(diffQuery, query);
    return {
      diff: await this.documents.diff(
        workspaceContext(request),
        id(raw),
        id(input.from),
        id(input.to),
      ),
    };
  }

  @Post('documents/:documentId/versions/:versionId/restore')
  @HttpCode(200)
  @ApiOperation({ summary: 'Copy an earlier version into a new version' })
  @RequireWorkspacePermission('document.restore')
  async restore(
    @Req() request: FastifyRequest,
    @Param('documentId') raw: string,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ) {
    const input = parse(requiredReason, body);
    return {
      document: await this.documents.restore(
        workspaceContext(request),
        id(raw),
        id(versionId),
        input.reason,
      ),
    };
  }

  @Post('documents/:documentId/submit')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit for review; out-of-bounds documents become non_compliant' })
  @RequireWorkspacePermission('document.edit')
  async submit(@Req() request: FastifyRequest, @Param('documentId') raw: string) {
    return { document: await this.documents.submit(workspaceContext(request), id(raw)) };
  }

  @Post('documents/:documentId/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Final approval; needs a passed evaluation or an accepted exception' })
  @RequireWorkspacePermission('document.approve')
  async approve(
    @Req() request: FastifyRequest,
    @Param('documentId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(optionalReason, body);
    return {
      document: await this.documents.approve(workspaceContext(request), id(raw), input.reason),
    };
  }

  @Post('documents/:documentId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a submitted document with a reason' })
  @RequireWorkspacePermission('document.approve')
  async reject(
    @Req() request: FastifyRequest,
    @Param('documentId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(requiredReason, body);
    return {
      document: await this.documents.reject(workspaceContext(request), id(raw), input.reason),
    };
  }

  @Post('documents/:documentId/lock')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lock an approved document' })
  @RequireWorkspacePermission('document.lock')
  async lock(
    @Req() request: FastifyRequest,
    @Param('documentId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(optionalReason, body);
    return {
      document: await this.documents.lock(workspaceContext(request), id(raw), input.reason),
    };
  }

  @Post('documents/:documentId/supersede')
  @HttpCode(200)
  @ApiOperation({ summary: 'Open a locked document again as a new draft version' })
  @RequireWorkspacePermission('document.lock')
  async supersede(
    @Req() request: FastifyRequest,
    @Param('documentId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(requiredReason, body);
    return {
      document: await this.documents.supersede(workspaceContext(request), id(raw), input.reason),
    };
  }

  @Post('documents/:documentId/exports')
  @HttpCode(201)
  @ApiOperation({ summary: 'Render a signed DOCX, PDF or PPTX artifact' })
  @RequireWorkspacePermission('document.export')
  async export(
    @Req() request: FastifyRequest,
    @Param('documentId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(exportSchema, body);
    return {
      artifact: await this.documents.export(workspaceContext(request), id(raw), input.format),
    };
  }

  @Get('documents/:documentId/artifacts')
  @ApiOperation({ summary: 'Artifacts of a document with their manifests' })
  @RequireWorkspacePermission('document.read')
  async artifacts(@Req() request: FastifyRequest, @Param('documentId') raw: string) {
    return { items: await this.documents.artifacts(workspaceContext(request), id(raw)) };
  }

  @Get('documents/:documentId/artifacts/:artifactId/download')
  @ApiOperation({ summary: 'Download an artifact after verifying its signature' })
  @RequireWorkspacePermission('document.export')
  async download(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param('documentId') raw: string,
    @Param('artifactId') artifactId: string,
  ) {
    const file = await this.documents.download(workspaceContext(request), id(raw), id(artifactId));
    reply.header('content-type', file.mime);
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
    reply.header('x-content-type-options', 'nosniff');
    return Buffer.from(file.bytes);
  }

  @Get('documents/:documentId/artifacts/:artifactId/verify')
  @ApiOperation({ summary: 'Check that stored artifact bytes still match the signed manifest' })
  @RequireWorkspacePermission('document.read')
  async verify(
    @Req() request: FastifyRequest,
    @Param('documentId') raw: string,
    @Param('artifactId') artifactId: string,
  ) {
    return {
      verification: await this.documents.verify(workspaceContext(request), id(raw), id(artifactId)),
    };
  }

  // ------------------------------------------------------------ evaluation (EVA-001/002)

  @Get('projects/:projectId/rubric')
  @ApiOperation({ summary: 'Active evaluation rubric (project override or system)' })
  @RequireWorkspacePermission('project.read')
  async rubric(@Req() request: FastifyRequest, @Param('projectId') raw: string) {
    return { rubric: await this.documents.rubric(workspaceContext(request), id(raw)) };
  }

  @Put('projects/:projectId/rubric')
  @ApiOperation({ summary: 'Save a new project rubric version' })
  @RequireWorkspacePermission('project.update')
  async setRubric(
    @Req() request: FastifyRequest,
    @Param('projectId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(rubricSchema, body);
    return { rubric: await this.documents.setRubric(workspaceContext(request), id(raw), input) };
  }

  @Post('documents/:documentId/evaluate')
  @HttpCode(201)
  @ApiOperation({ summary: 'Evaluate the current version against the rubric' })
  @RequireWorkspacePermission('document.approve')
  async evaluate(@Req() request: FastifyRequest, @Param('documentId') raw: string) {
    return { evaluation: await this.documents.evaluate(workspaceContext(request), id(raw)) };
  }

  @Get('evaluations/:evaluationId')
  @ApiOperation({ summary: 'An evaluation with scores, evidence, findings and exception' })
  @RequireWorkspacePermission('document.read')
  async evaluation(@Req() request: FastifyRequest, @Param('evaluationId') raw: string) {
    return { evaluation: await this.documents.getEvaluation(workspaceContext(request), id(raw)) };
  }

  @Post('evaluations/:evaluationId/accept-exception')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept a failed evaluation with an exception (stays visible)' })
  @RequireWorkspacePermission('workflow.override')
  async acceptException(
    @Req() request: FastifyRequest,
    @Param('evaluationId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(requiredReason, body);
    return {
      evaluation: await this.documents.acceptException(
        workspaceContext(request),
        id(raw),
        input.reason,
      ),
    };
  }

  @Patch('evaluation-findings/:findingId')
  @ApiOperation({ summary: 'Send a finding to another stage, with a reason' })
  @RequireWorkspacePermission('workflow.override')
  async retarget(
    @Req() request: FastifyRequest,
    @Param('findingId') raw: string,
    @Body() body: unknown,
  ) {
    const input = parse(retargetSchema, body);
    return {
      evaluation: await this.documents.retargetFinding(workspaceContext(request), id(raw), input),
    };
  }
}
