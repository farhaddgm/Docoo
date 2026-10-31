import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { EXPLORATION_LIMITS } from '@docoo/domain';

import { RequireWorkspacePermission, UsesAi } from '../auth/auth.authorization.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { ExplorationsService } from './explorations.service.js';

const version = z.number().int().min(1).max(1_000_000);
const title = z.string().trim().min(2).max(EXPLORATION_LIMITS.title);
const eventText = z.string().trim().min(1).max(EXPLORATION_LIMITS.eventText);

const createBody = z
  .object({
    title,
    eventText,
    outputLanguage: z.enum(['fa', 'en']).default('fa'),
  })
  .strict();
const updateBody = z
  .object({ expectedVersion: version, title: title.optional(), eventText: eventText.optional() })
  .strict()
  .refine((value) => value.title !== undefined || value.eventText !== undefined);
const statusBody = z.object({ expectedVersion: version }).strict();
const messageBody = z
  .object({ content: z.string().trim().min(1).max(EXPLORATION_LIMITS.message) })
  .strict();
const candidateBody = z
  .object({
    title: z.string().max(EXPLORATION_LIMITS.candidateTitle * 2),
    problemDraft: z.string().max(EXPLORATION_LIMITS.problemDraft * 2),
    why: z
      .string()
      .max(EXPLORATION_LIMITS.candidateText * 2)
      .optional(),
    assumptions: z
      .string()
      .max(EXPLORATION_LIMITS.candidateText * 2)
      .optional(),
    expectedOutput: z
      .string()
      .max(EXPLORATION_LIMITS.candidateText * 2)
      .optional(),
  })
  .strict();
const editBody = z.object({ basedOnVersionNo: version, candidate: candidateBody }).strict();
const decisionBody = z
  .object({
    decision: z.string().max(20),
    reason: z.string().trim().max(EXPLORATION_LIMITS.reason).default(''),
  })
  .strict();
const listQuery = z
  .object({
    status: z.enum(['open', 'archived', 'all']).default('open'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

function invalid() {
  return badRequest('EXPLORATION_INVALID_REQUEST', 'Provide a valid exploration request.');
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

@ApiTags('explorations')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/explorations')
export class ExplorationsController {
  constructor(private readonly explorations: ExplorationsService) {}

  @Get()
  @ApiOperation({ summary: 'List explorations with the state of their candidates' })
  @RequireWorkspacePermission('exploration.read')
  list(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.explorations.list(workspaceContext(request), parse(listQuery, query));
  }

  @Post()
  @ApiOperation({ summary: 'Start an exploration from an event or topic' })
  @RequireWorkspacePermission('exploration.update')
  create(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.explorations.create(workspaceContext(request), parse(createBody, body));
  }

  @Get(':explorationId')
  @ApiOperation({ summary: 'An exploration with its conversation and candidate problems' })
  @RequireWorkspacePermission('exploration.read')
  get(@Req() request: FastifyRequest, @Param('explorationId') exploration: string) {
    return this.explorations.get(workspaceContext(request), id(exploration));
  }

  @Patch(':explorationId')
  @ApiOperation({ summary: 'Change the title or the text of an open exploration' })
  @RequireWorkspacePermission('exploration.update')
  update(
    @Req() request: FastifyRequest,
    @Param('explorationId') exploration: string,
    @Body() body: unknown,
  ) {
    return this.explorations.update(
      workspaceContext(request),
      id(exploration),
      parse(updateBody, body),
    );
  }

  @Post(':explorationId/archive')
  @HttpCode(200)
  @ApiOperation({ summary: 'Archive: no new messages or candidates until it is reopened' })
  @RequireWorkspacePermission('exploration.update')
  archive(
    @Req() request: FastifyRequest,
    @Param('explorationId') exploration: string,
    @Body() body: unknown,
  ) {
    return this.explorations.setStatus(
      workspaceContext(request),
      id(exploration),
      'archived',
      parse(statusBody, body).expectedVersion,
    );
  }

  @Post(':explorationId/reopen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reopen an archived exploration' })
  @RequireWorkspacePermission('exploration.update')
  reopen(
    @Req() request: FastifyRequest,
    @Param('explorationId') exploration: string,
    @Body() body: unknown,
  ) {
    return this.explorations.setStatus(
      workspaceContext(request),
      id(exploration),
      'open',
      parse(statusBody, body).expectedVersion,
    );
  }

  @Post(':explorationId/messages')
  @ApiOperation({ summary: 'Talk to the agent about the event (costs a model call)' })
  @UsesAi()
  @RequireWorkspacePermission('exploration.run')
  message(
    @Req() request: FastifyRequest,
    @Param('explorationId') exploration: string,
    @Body() body: unknown,
  ) {
    return this.explorations.postMessage(
      workspaceContext(request),
      id(exploration),
      parse(messageBody, body).content,
    );
  }

  @Post(':explorationId/propose')
  @HttpCode(200)
  @ApiOperation({ summary: 'Ask the model to propose candidate problems (costs a model call)' })
  @UsesAi()
  @RequireWorkspacePermission('exploration.run')
  propose(@Req() request: FastifyRequest, @Param('explorationId') exploration: string) {
    return this.explorations.propose(workspaceContext(request), id(exploration));
  }

  @Post(':explorationId/candidates')
  @ApiOperation({ summary: 'Write a candidate problem by hand' })
  @RequireWorkspacePermission('exploration.update')
  addCandidate(
    @Req() request: FastifyRequest,
    @Param('explorationId') exploration: string,
    @Body() body: unknown,
  ) {
    return this.explorations.addCandidate(
      workspaceContext(request),
      id(exploration),
      parse(candidateBody, body),
    );
  }

  @Patch(':explorationId/candidates/:candidateKey')
  @ApiOperation({ summary: 'Edit a candidate: writes a new version of it' })
  @RequireWorkspacePermission('exploration.update')
  editCandidate(
    @Req() request: FastifyRequest,
    @Param('explorationId') exploration: string,
    @Param('candidateKey') candidate: string,
    @Body() body: unknown,
  ) {
    return this.explorations.editCandidate(
      workspaceContext(request),
      id(exploration),
      id(candidate),
      parse(editBody, body),
    );
  }

  @Post(':explorationId/candidates/:candidateKey/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'Park, drop or bring back a candidate; reversible' })
  @RequireWorkspacePermission('exploration.update')
  decide(
    @Req() request: FastifyRequest,
    @Param('explorationId') exploration: string,
    @Param('candidateKey') candidate: string,
    @Body() body: unknown,
  ) {
    return this.explorations.decide(
      workspaceContext(request),
      id(exploration),
      id(candidate),
      parse(decisionBody, body),
    );
  }
}
