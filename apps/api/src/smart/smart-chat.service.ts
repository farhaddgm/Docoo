import { Inject, Injectable } from '@nestjs/common';
import { ProviderRuntime } from '@docoo/orchestration';
import { ProviderError, type ChatMessage } from '@docoo/providers';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { conflict, notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { PROVIDER_RUNTIME } from '../providers/providers.service.js';
import { SmartContextBuilder } from './smart-context.service.js';
import {
  buildInstructions,
  conversationTitle,
  normalizeTranscript,
  TRANSCRIPT_LIMIT,
  type ChatMode,
  type SmartLocale,
} from './smart-prompts.js';
import type { WalkerStepKey } from './walker-steps.js';

const REPLY_LIMIT = 20_000;
/** Below the 30 s proxy timeout of the web rewrite, so a slow provider fails visibly. */
const MODEL_TIMEOUT_MS = 25_000;
const MAX_OUTPUT_TOKENS: Record<ChatMode, number> = { chat: 1500, report: 3500 };

export interface CreateConversationInput {
  readonly kind: 'walker' | 'error';
  readonly route: string;
  readonly projectId?: string | undefined;
  readonly errorId?: string | undefined;
}

export interface SendMessageInput {
  readonly content: string;
  readonly mode: ChatMode;
  readonly route: string;
  readonly locale: SmartLocale;
  readonly projectId?: string | undefined;
  readonly walkerStep?: WalkerStepKey | undefined;
}

interface ConversationRow extends QueryResultRow {
  id: string;
  kind: 'walker' | 'error';
  project_id: string | null;
  error_id: string | null;
  route: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow extends QueryResultRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'done' | 'failed';
  created_at: string;
  issue_id?: string | null;
}

const conversationColumns = `id, kind, project_id, error_id, route, title,
  ${isoColumn('created_at', 'created_at')}, ${isoColumn('updated_at', 'updated_at')}`;
const messageColumns = `id, role, content, status, ${isoColumn('created_at', 'created_at')}`;

function toConversation(row: ConversationRow) {
  return {
    id: row.id,
    kind: row.kind,
    projectId: row.project_id,
    errorId: row.error_id,
    route: row.route,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    ...(row.issue_id !== undefined ? { savedIssueId: row.issue_id } : {}),
  };
}

/** Per-admin Smart chat; the model is called in the request path like the solutions service. */
@Injectable()
export class SmartChatService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
    private readonly contextBuilder: SmartContextBuilder,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  async list(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client) => ({
      items: (
        await client.query<ConversationRow>(
          `select ${conversationColumns} from smart_conversations
            order by updated_at desc, id desc limit 50`,
        )
      ).rows.map(toConversation),
    }));
  }

  async create(context: WorkspaceRequestContext, input: CreateConversationInput) {
    return this.database.run(context, async (client) => {
      if (input.errorId) {
        const found = await client.query('select 1 from app_errors where id = $1', [input.errorId]);
        if (found.rowCount === 0)
          throw notFound('SMART_ERROR_NOT_FOUND', 'The error was not found.');
      }
      const row = (
        await client.query<ConversationRow>(
          `insert into smart_conversations (workspace_id, user_id, kind, project_id, error_id, route)
           values ($1, $2, $3, (select id from projects where id = $4::uuid and deleted_at is null), $5, $6)
           returning ${conversationColumns}`,
          [
            context.workspaceId,
            context.actorId,
            input.kind,
            input.projectId ?? null,
            input.errorId ?? null,
            input.route.slice(0, 300),
          ],
        )
      ).rows[0]!;
      return { conversation: toConversation(row) };
    });
  }

  async get(context: WorkspaceRequestContext, id: string) {
    return this.database.run(context, async (client) => {
      const conversation = await this.load(client, id);
      const messages = (
        await client.query<MessageRow>(
          `select m.id, m.role, m.content, m.status, ${isoColumn('m.created_at', 'created_at')},
                  (select i.id from walker_issues i where i.source_message_id = m.id) as issue_id
             from smart_messages m where m.conversation_id = $1 order by m.created_at, m.id`,
          [id],
        )
      ).rows;
      return { conversation: toConversation(conversation), messages: messages.map(toMessage) };
    });
  }

  async remove(context: WorkspaceRequestContext, id: string) {
    return this.database.run(context, async (client) => {
      const conversation = await this.load(client, id);
      await client.query('delete from smart_conversations where id = $1', [id]);
      await writeAudit(client, context, {
        action: 'smart.conversation_deleted',
        targetType: 'smart_conversation',
        targetId: id,
        before: { kind: conversation.kind },
      });
    });
  }

  /**
   * Stores the administrator's message, asks the model once (no retries, no tools) and stores
   * the answer. A provider failure is kept as a failed answer so the thread shows what happened.
   */
  async send(context: WorkspaceRequestContext, conversationId: string, input: SendMessageInput) {
    const prepared = await this.database.run(context, async (client) => {
      const conversation = await this.load(client, conversationId);
      const projectId = await this.visibleProject(
        client,
        input.projectId ?? conversation.project_id,
      );
      const effective = await this.config.resolve(
        client,
        context,
        projectId ? 'project' : 'workspace',
        projectId ?? context.workspaceId,
      );
      const connectionId = settingText(effective.values['ai.connection_id']);
      const model = settingText(effective.values['ai.model']);
      if (!connectionId || !model) {
        throw conflict('AI_NOT_CONFIGURED', 'Set ai.connection_id and ai.model first.');
      }
      const snapshot = await this.contextBuilder.build(client, context, {
        route: input.route,
        projectId,
        walkerStep: input.walkerStep ?? null,
        errorId: conversation.kind === 'error' ? conversation.error_id : null,
      });
      const history = (
        await client.query<{ role: 'user' | 'assistant'; content: string }>(
          `select role, content from smart_messages
            where conversation_id = $1 and status = 'done'
            order by created_at desc, id desc limit $2`,
          [conversationId, TRANSCRIPT_LIMIT],
        )
      ).rows.reverse();
      const messageContext = JSON.stringify({
        route: input.route.slice(0, 300),
        projectId,
        walkerStep: input.walkerStep ?? null,
        locale: input.locale,
        mode: input.mode,
      });
      const userMessage = (
        await client.query<MessageRow>(
          `insert into smart_messages (workspace_id, conversation_id, role, content, context)
           values ($1, $2, 'user', $3, $4::jsonb) returning ${messageColumns}`,
          [context.workspaceId, conversationId, input.content, messageContext],
        )
      ).rows[0]!;
      await client.query(
        `update smart_conversations
            set title = case when title = '' then $2 else title end, route = $3
          where id = $1`,
        [conversationId, conversationTitle(input.content), input.route.slice(0, 300)],
      );
      return { connectionId, model, projectId, snapshot, history, userMessage, messageContext };
    });

    const transcript: ChatMessage[] = normalizeTranscript([
      ...prepared.history,
      { role: 'user', content: input.content },
    ]);
    let reply = '';
    let invocationId: string | null = null;
    let failure: string | null = null;
    try {
      const result = await this.runtime.invoke(
        {
          workspaceId: context.workspaceId,
          projectId: prepared.projectId,
          stageRunId: null,
          attemptId: null,
          purpose: input.mode === 'report' ? 'smart_report' : 'smart_chat',
          retryNo: 0,
        },
        prepared.connectionId,
        {
          model: prepared.model,
          instructions: buildInstructions({
            mode: input.mode,
            locale: input.locale,
            context: prepared.snapshot,
          }),
          messages: transcript,
          maxOutputTokens: MAX_OUTPUT_TOKENS[input.mode],
          timeoutMs: MODEL_TIMEOUT_MS,
        },
      );
      reply = result.response.text.trim().slice(0, REPLY_LIMIT);
      invocationId = result.invocationId;
      if (!reply) failure = 'empty_reply';
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      failure = error.code;
    }

    return this.database.run(context, async (client) => {
      const assistant = (
        await client.query<MessageRow>(
          `insert into smart_messages (workspace_id, conversation_id, role, content, status, context, invocation_id)
           values ($1, $2, 'assistant', $3, $4, $5::jsonb, $6) returning ${messageColumns}`,
          [
            context.workspaceId,
            conversationId,
            failure ?? reply,
            failure ? 'failed' : 'done',
            prepared.messageContext,
            invocationId,
          ],
        )
      ).rows[0]!;
      await client.query('update smart_conversations set updated_at = now() where id = $1', [
        conversationId,
      ]);
      return {
        userMessage: toMessage(prepared.userMessage),
        assistantMessage: toMessage(assistant),
      };
    });
  }

  private async load(client: PoolClient, id: string): Promise<ConversationRow> {
    const row = (
      await client.query<ConversationRow>(
        `select ${conversationColumns} from smart_conversations where id = $1`,
        [id],
      )
    ).rows[0];
    if (!row) throw notFound('SMART_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
    return row;
  }

  /** A project id from the browser is only used when it still exists in this workspace. */
  private async visibleProject(
    client: PoolClient,
    projectId: string | null,
  ): Promise<string | null> {
    if (!projectId) return null;
    const row = await client.query<{ id: string }>(
      'select id from projects where id = $1 and deleted_at is null',
      [projectId],
    );
    return row.rows[0]?.id ?? null;
  }
}

function settingText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
