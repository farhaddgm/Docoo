import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';

import { RequireWorkspacePermission } from '../auth/auth.authorization.js';
import { pageQuerySchema } from '../common/pagination.js';
import { badRequest } from '../common/problems.js';
import { isUuid, workspaceContext } from '../common/request-context.js';
import { ERROR_CATEGORIES } from './error-classifier.js';
import { SmartChatService } from './smart-chat.service.js';
import { SmartErrorsService } from './smart-errors.service.js';
import { SmartIssuesService } from './smart-issues.service.js';
import { WalkerProgressService } from './walker-progress.service.js';
import { WALKER_STEP_KEYS } from './walker-steps.js';

const uuid = z.uuid().transform((value) => value.toLowerCase());
const page = z.string().trim().min(1).max(300);
const search = z.string().trim().min(1).max(100);

const reportErrorBody = z
  .object({
    kind: z.enum(['runtime', 'promise', 'render', 'api']),
    message: z.string().trim().min(1).max(2000),
    detail: z.string().max(8000).optional(),
    page: page.optional(),
    method: z
      .string()
      .regex(/^[A-Za-z]{3,10}$/)
      .optional(),
    path: z.string().max(300).optional(),
    status: z.number().int().min(100).max(599).optional(),
    projectId: uuid.optional(),
  })
  .strict();
const errorsQuery = z
  .object({
    ...pageQuerySchema,
    status: z.enum(['new', 'seen', 'fixed', 'ignored']).optional(),
    source: z.enum(['server', 'client']).optional(),
    category: z.enum(ERROR_CATEGORIES).optional(),
    search: search.optional(),
  })
  .strict();
const feedQuery = z.object({ since: z.iso.datetime({ offset: true }).optional() }).strict();
const errorStatusBody = z.object({ status: z.enum(['new', 'seen', 'fixed', 'ignored']) }).strict();
const walkerQuery = z.object({ projectId: uuid.optional() }).strict();
const conversationBody = z
  .object({
    kind: z.enum(['walker', 'error']),
    route: page,
    projectId: uuid.optional(),
    errorId: uuid.optional(),
  })
  .strict()
  .refine((value) => value.kind !== 'error' || value.errorId !== undefined);
const messageBody = z
  .object({
    content: z.string().trim().min(1).max(4000),
    mode: z.enum(['chat', 'report']).default('chat'),
    route: page,
    locale: z.enum(['fa', 'en']),
    projectId: uuid.optional(),
    walkerStep: z.enum(WALKER_STEP_KEYS).optional(),
  })
  .strict();
const issuesQuery = z
  .object({
    ...pageQuerySchema,
    status: z.enum(['open', 'in_progress', 'fixed', 'wont_fix']).optional(),
    search: search.optional(),
  })
  .strict();
const issueBody = z.object({ messageId: uuid }).strict();
const issuePatch = z
  .object({
    status: z.enum(['open', 'in_progress', 'fixed', 'wont_fix']).optional(),
    title: z.string().trim().min(1).max(300).optional(),
    note: z.string().max(5000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw badRequest('SMART_INVALID_REQUEST', 'Provide a valid Smart request.');
  return parsed.data;
}

function idOf(raw: string): string {
  if (!isUuid(raw)) throw badRequest('SMART_INVALID_REQUEST', 'Provide a valid Smart request.');
  return raw.toLowerCase();
}

/** Smart: error tracker, chat, walker progress and the issue ledger (docs/10-smart.md). */
@ApiTags('smart')
@ApiCookieAuth('docoo_session')
@Controller('workspaces/:workspaceId/smart')
export class SmartController {
  constructor(
    private readonly errors: SmartErrorsService,
    private readonly chat: SmartChatService,
    private readonly issues: SmartIssuesService,
    private readonly walker: WalkerProgressService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Open error and issue counters for the Smart button' })
  @RequireWorkspacePermission('smart.read')
  summary(@Req() request: FastifyRequest) {
    return this.errors.summary(workspaceContext(request));
  }

  @Get('walker/progress')
  @ApiOperation({ summary: 'Walker steps and their code-computed completion' })
  @RequireWorkspacePermission('smart.read')
  async progress(@Req() request: FastifyRequest, @Query() query: unknown) {
    const { projectId } = parse(walkerQuery, query);
    return { progress: await this.walker.progress(workspaceContext(request), projectId ?? null) };
  }

  @Post('errors')
  @HttpCode(201)
  @ApiOperation({ summary: 'Report a browser error (grouped by fingerprint)' })
  @RequireWorkspacePermission('workspace.read')
  async report(@Req() request: FastifyRequest, @Body() body: unknown) {
    const input = parse(reportErrorBody, body);
    const recorded = await this.errors.record(workspaceContext(request), {
      source: 'client',
      kind: input.kind,
      message: input.message,
      status: input.status,
      method: input.method,
      route: input.path ?? input.page,
      page: input.page,
      projectId: input.projectId,
      stack: input.detail,
      context: { kind: input.kind },
    });
    return { error: recorded };
  }

  @Get('errors')
  @ApiOperation({ summary: 'Grouped errors, most recent first' })
  @RequireWorkspacePermission('smart.read')
  listErrors(@Req() request: FastifyRequest, @Query() query: unknown) {
    const { limit, cursor, ...filters } = parse(errorsQuery, query);
    return this.errors.list(workspaceContext(request), filters, { limit, cursor });
  }

  @Get('errors/feed')
  @ApiOperation({ summary: 'Errors seen since a moment, for toasts of other sessions' })
  @RequireWorkspacePermission('smart.read')
  feed(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.errors.feed(workspaceContext(request), parse(feedQuery, query).since);
  }

  @Get('errors/:errorId')
  @ApiOperation({ summary: 'One error with stack and sanitised context' })
  @RequireWorkspacePermission('smart.read')
  getError(@Req() request: FastifyRequest, @Param('errorId') raw: string) {
    return this.errors.get(workspaceContext(request), idOf(raw));
  }

  @Patch('errors/:errorId')
  @ApiOperation({ summary: 'Mark an error new, seen, fixed or ignored' })
  @RequireWorkspacePermission('smart.manage')
  setErrorStatus(
    @Req() request: FastifyRequest,
    @Param('errorId') raw: string,
    @Body() body: unknown,
  ) {
    return this.errors.setStatus(
      workspaceContext(request),
      idOf(raw),
      parse(errorStatusBody, body).status,
    );
  }

  @Get('conversations')
  @ApiOperation({ summary: 'Own Smart conversations, most recent first' })
  @RequireWorkspacePermission('smart.read')
  listConversations(@Req() request: FastifyRequest) {
    return this.chat.list(workspaceContext(request));
  }

  @Post('conversations')
  @HttpCode(201)
  @ApiOperation({ summary: 'Start a Smart conversation (free or about one error)' })
  @RequireWorkspacePermission('smart.chat')
  createConversation(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.chat.create(workspaceContext(request), parse(conversationBody, body));
  }

  @Get('conversations/:conversationId')
  @ApiOperation({ summary: 'A conversation with its messages' })
  @RequireWorkspacePermission('smart.read')
  getConversation(@Req() request: FastifyRequest, @Param('conversationId') raw: string) {
    return this.chat.get(workspaceContext(request), idOf(raw));
  }

  @Delete('conversations/:conversationId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete an own conversation' })
  @RequireWorkspacePermission('smart.chat')
  async deleteConversation(@Req() request: FastifyRequest, @Param('conversationId') raw: string) {
    const id = idOf(raw);
    await this.chat.remove(workspaceContext(request), id);
    return { id };
  }

  @Post('conversations/:conversationId/messages')
  @HttpCode(201)
  @ApiOperation({ summary: 'Send a message; the model answers once, read-only' })
  @RequireWorkspacePermission('smart.chat')
  sendMessage(
    @Req() request: FastifyRequest,
    @Param('conversationId') raw: string,
    @Body() body: unknown,
  ) {
    return this.chat.send(workspaceContext(request), idOf(raw), parse(messageBody, body));
  }

  @Get('issues')
  @ApiOperation({ summary: 'Walker issue ledger' })
  @RequireWorkspacePermission('smart.read')
  listIssues(@Req() request: FastifyRequest, @Query() query: unknown) {
    const { limit, cursor, ...filters } = parse(issuesQuery, query);
    return this.issues.list(workspaceContext(request), filters, { limit, cursor });
  }

  @Post('issues')
  @HttpCode(201)
  @ApiOperation({ summary: 'Save a Smart answer verbatim in the ledger (once per message)' })
  @RequireWorkspacePermission('smart.manage')
  saveIssue(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.issues.saveFromMessage(workspaceContext(request), parse(issueBody, body).messageId);
  }

  @Get('issues/:issueId')
  @ApiOperation({ summary: 'One ledger issue with its full text and context' })
  @RequireWorkspacePermission('smart.read')
  getIssue(@Req() request: FastifyRequest, @Param('issueId') raw: string) {
    return this.issues.get(workspaceContext(request), idOf(raw));
  }

  @Patch('issues/:issueId')
  @ApiOperation({ summary: 'Change status, title or fix note of a ledger issue' })
  @RequireWorkspacePermission('smart.manage')
  updateIssue(
    @Req() request: FastifyRequest,
    @Param('issueId') raw: string,
    @Body() body: unknown,
  ) {
    return this.issues.update(workspaceContext(request), idOf(raw), parse(issuePatch, body));
  }

  @Delete('issues/:issueId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Delete a ledger issue' })
  @RequireWorkspacePermission('smart.manage')
  async deleteIssue(@Req() request: FastifyRequest, @Param('issueId') raw: string) {
    const id = idOf(raw);
    await this.issues.remove(workspaceContext(request), id);
    return { id };
  }
}
