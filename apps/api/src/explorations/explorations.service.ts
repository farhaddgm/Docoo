import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  CANDIDATE_STATES,
  composeInstructions,
  dataBlock,
  EXPLORATION_CHAT_TASK,
  EXPLORATION_LIMITS,
  EXPLORATION_PROPOSAL_SCHEMA,
  EXPLORATION_PROPOSAL_SCHEMA_NAME,
  EXPLORATION_PROPOSAL_TASK,
  EXPLORATION_RULES,
  isCandidateDecision,
  normalizeCandidate,
  normalizeCandidates,
  type CandidateInput,
  type CandidateState,
  type ExplorationStatus,
} from '@docoo/domain';
import { activeAgentVersion, promptDigest, ProviderRuntime } from '@docoo/orchestration';
import { ProviderError } from '@docoo/providers';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { badRequest, conflict, notFound, unprocessable } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { settingText } from '../documents/document-store.js';
import { PROVIDER_RUNTIME } from '../providers/providers.service.js';

export interface ExplorationSummary {
  readonly id: string;
  readonly title: string;
  readonly status: ExplorationStatus;
  readonly outputLanguage: 'fa' | 'en';
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly candidateCount: number;
  /** Candidates by their current state, so the list shows what is still open. */
  readonly byState: Readonly<Record<CandidateState, number>>;
}

export interface ExplorationMessage {
  readonly id: string;
  readonly seq: number;
  readonly role: 'admin' | 'agent';
  readonly content: string;
  readonly status: 'done' | 'failed';
  readonly createdAt: string;
}

export interface ExplorationCandidate extends CandidateInput {
  /** The projects made from this candidate that the person can see (ADR-0044 P2). */
  readonly projects: readonly {
    readonly id: string;
    readonly code: string;
    readonly title: string;
  }[];
  readonly candidateKey: string;
  readonly versionNo: number;
  readonly source: 'ai' | 'admin';
  readonly state: CandidateState;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly reason: string;
}

export interface ExplorationRow extends QueryResultRow {
  id: string;
  title: string;
  eventText: string;
  status: ExplorationStatus;
  outputLanguage: 'fa' | 'en';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExplorationDetail {
  readonly exploration: ExplorationRow;
  readonly messages: ExplorationMessage[];
  readonly candidates: ExplorationCandidate[];
  readonly limits: {
    readonly maxMessages: number;
    readonly maxCandidates: number;
    readonly usedMessages: number;
    readonly usedCandidates: number;
    readonly textMax: Readonly<Record<'title' | 'eventText' | 'message' | 'reason', number>>;
  };
}

const explorationColumns = `id, title, event_text as "eventText", status, output_language as "outputLanguage",
  version, ${isoColumn('created_at', '"createdAt"')}, ${isoColumn('updated_at', '"updatedAt"')}`;

/** The newest version of every candidate with its current state (the newest decision, else proposed). */
const currentCandidates = `
  select c.candidate_key as "candidateKey", c.version_no as "versionNo", c.title,
         c.problem_draft as "problemDraft", c.why, c.assumptions, c.expected_output as "expectedOutput",
         c.source, ${isoColumn('c.created_at', '"createdAt"')},
         coalesce((select json_agg(json_build_object('id', p.id, 'code', p.code, 'title', p.title)
                                   order by p.created_at)
                     from projects p
                    where p.origin_candidate_key = c.candidate_key and p.workspace_id = c.workspace_id
                      and p.deleted_at is null), '[]'::json) as projects,
         coalesce(d.decision, 'proposed') as state, coalesce(d.reason, '') as reason,
         ${isoColumn('d.created_at', '"decidedAt"')}
    from (select distinct on (candidate_key) * from exploration_candidates
           where exploration_id = $1 order by candidate_key, version_no desc) c
    left join lateral (select decision, reason, created_at from exploration_candidate_decisions
                        where exploration_id = c.exploration_id and candidate_key = c.candidate_key
                        order by created_at desc, id desc limit 1) d on true
   order by (select min(k.seq) from exploration_candidates k where k.candidate_key = c.candidate_key)`;

const HISTORY_MESSAGES = 12;
const HISTORY_EXCERPT = 1500;
const CANDIDATE_EXCERPT = 600;
/** Below the 30 s proxy timeout of the web rewrite, so a slow provider fails visibly. */
const MODEL_TIMEOUT_MS = 25_000;

const byStateOf = (candidates: readonly { state: CandidateState }[]) =>
  Object.fromEntries(
    CANDIDATE_STATES.map((state) => [
      state,
      candidates.filter((item) => item.state === state).length,
    ]),
  ) as Record<CandidateState, number>;

/**
 * Exploration before projects (ADR-0044): a conversation about an event, candidate problems the
 * agent proposes and the administrator decides on. The model only proposes; it never creates a
 * project, parks or drops a candidate. Messages, candidates and decisions are append-only.
 */
@Injectable()
export class ExplorationsService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  async list(
    context: WorkspaceRequestContext,
    input: { status: ExplorationStatus | 'all'; limit: number },
  ): Promise<{ items: ExplorationSummary[] }> {
    return this.database.run(context, async (client) => {
      const rows = (
        await client.query<ExplorationRow>(
          `select ${explorationColumns} from explorations
            where workspace_id = $1 and ($2 = 'all' or status = $2)
            order by updated_at desc, id desc limit $3`,
          [context.workspaceId, input.status, input.limit],
        )
      ).rows;
      const items: ExplorationSummary[] = [];
      for (const row of rows) {
        const candidates = (
          await client.query<{ state: CandidateState }>(currentCandidates, [row.id])
        ).rows;
        items.push({
          id: row.id,
          title: row.title,
          status: row.status,
          outputLanguage: row.outputLanguage,
          version: row.version,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          candidateCount: candidates.length,
          byState: byStateOf(candidates),
        });
      }
      return { items };
    });
  }

  async create(
    context: WorkspaceRequestContext,
    input: { title: string; eventText: string; outputLanguage: 'fa' | 'en' },
  ) {
    return this.database.run(context, async (client) => {
      const row = (
        await client.query<ExplorationRow>(
          `insert into explorations (workspace_id, title, event_text, output_language, created_by)
           values ($1, $2, $3, $4, $5) returning ${explorationColumns}`,
          [
            context.workspaceId,
            input.title,
            input.eventText,
            input.outputLanguage,
            context.actorId,
          ],
        )
      ).rows[0]!;
      // Counts only: the text is the administrator's own content.
      await writeAudit(client, context, {
        action: 'exploration.created',
        targetType: 'exploration',
        targetId: row.id,
        after: { eventLength: input.eventText.length, outputLanguage: input.outputLanguage },
      });
      return this.read(client, context, row.id);
    });
  }

  async get(context: WorkspaceRequestContext, explorationId: string) {
    return this.database.run(context, (client) => this.read(client, context, explorationId));
  }

  async update(
    context: WorkspaceRequestContext,
    explorationId: string,
    input: { expectedVersion: number; title?: string | undefined; eventText?: string | undefined },
  ) {
    return this.database.run(context, async (client) => {
      const current = await this.lock(client, explorationId);
      this.assertVersion(current, input.expectedVersion);
      if (current.status === 'archived') this.archived();
      await client.query(
        `update explorations set title = $2, event_text = $3, version = version + 1, updated_at = now()
          where id = $1`,
        [explorationId, input.title ?? current.title, input.eventText ?? current.eventText],
      );
      await writeAudit(client, context, {
        action: 'exploration.updated',
        targetType: 'exploration',
        targetId: explorationId,
        after: {
          titleChanged: input.title !== undefined && input.title !== current.title,
          eventChanged: input.eventText !== undefined && input.eventText !== current.eventText,
        },
      });
      return this.read(client, context, explorationId);
    });
  }

  async setStatus(
    context: WorkspaceRequestContext,
    explorationId: string,
    status: ExplorationStatus,
    expectedVersion: number,
  ) {
    return this.database.run(context, async (client) => {
      const current = await this.lock(client, explorationId);
      this.assertVersion(current, expectedVersion);
      if (current.status !== status) {
        await client.query(
          `update explorations set status = $2, version = version + 1, updated_at = now() where id = $1`,
          [explorationId, status],
        );
        await writeAudit(client, context, {
          action: status === 'archived' ? 'exploration.archived' : 'exploration.reopened',
          targetType: 'exploration',
          targetId: explorationId,
        });
      }
      return this.read(client, context, explorationId);
    });
  }

  /** The administrator's message and the agent's answer; the answer is plain text and changes nothing. */
  async postMessage(context: WorkspaceRequestContext, explorationId: string, content: string) {
    const plan = await this.database.run(context, async (client) => {
      const exploration = await this.lock(client, explorationId);
      if (exploration.status === 'archived') this.archived();
      const limits = await this.limits(client, context);
      const used = Number(
        (
          await client.query<{ count: string }>(
            `select count(*) as count from exploration_messages where exploration_id = $1 and role = 'admin'`,
            [explorationId],
          )
        ).rows[0]!.count,
      );
      if (used >= limits.maxMessages) {
        throw conflict(
          'EXPLORATION_MESSAGE_LIMIT',
          'The conversation of this exploration reached its message limit.',
        );
      }
      const ai = await this.ai(client, context);
      const history = (
        await client.query<{ role: string; content: string }>(
          `select role, content from exploration_messages
            where exploration_id = $1 and status = 'done' order by seq desc limit $2`,
          [explorationId, HISTORY_MESSAGES],
        )
      ).rows.reverse();
      const candidates = (await client.query(currentCandidates, [explorationId]))
        .rows as ExplorationCandidate[];
      const asked = await this.appendMessage(client, context, explorationId, {
        role: 'admin',
        content,
        status: 'done',
        invocationId: null,
      });
      return { exploration, ai, history, candidates, asked };
    });

    const instructions = composeInstructions({
      role: 'analyst',
      content: plan.ai.definition,
      language: plan.exploration.outputLanguage,
      task: EXPLORATION_CHAT_TASK,
      rules: EXPLORATION_RULES,
    });
    const message = dataBlock({
      eventText: plan.exploration.eventText,
      conversation: plan.history.map((item) => ({
        from: item.role,
        text: item.content.slice(0, HISTORY_EXCERPT),
      })),
      candidates: this.candidateDigest(plan.candidates),
      administratorMessage: content,
    });
    let reply = '';
    let invocationId: string | null = null;
    let failure: string | null = null;
    try {
      // Outside any transaction: no connection is held while the model thinks.
      const result = await this.runtime.invoke(
        {
          workspaceId: context.workspaceId,
          onBehalfOf: context.actorId,
          projectId: null,
          stageRunId: null,
          attemptId: null,
          purpose: 'exploration:chat',
          retryNo: 0,
          agentDefinitionVersionId: plan.ai.definition.id,
          promptSha256: promptDigest({ instructions, message }),
        },
        plan.ai.connectionId,
        {
          model: plan.ai.model,
          instructions,
          messages: [{ role: 'user', content: message }],
          maxOutputTokens: 1500,
          timeoutMs: MODEL_TIMEOUT_MS,
        },
      );
      reply = result.response.text.trim().slice(0, EXPLORATION_LIMITS.reply);
      invocationId = result.invocationId;
      if (!reply) failure = 'empty_reply';
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      failure = error.code;
    }

    return this.database.run(context, async (client) => {
      await this.lock(client, explorationId);
      const answer = await this.appendMessage(client, context, explorationId, {
        role: 'agent',
        content: failure ?? reply,
        status: failure ? 'failed' : 'done',
        invocationId,
      });
      await writeAudit(client, context, {
        action: 'exploration.message',
        targetType: 'exploration',
        targetId: explorationId,
        after: { messageId: plan.asked.id, answerStatus: answer.status },
      });
      return { asked: plan.asked, answer };
    });
  }

  /** The model proposes candidate problems; each becomes version 1 of a new candidate, state proposed. */
  async propose(context: WorkspaceRequestContext, explorationId: string) {
    const plan = await this.database.run(context, async (client) => {
      const exploration = await this.lock(client, explorationId);
      if (exploration.status === 'archived') this.archived();
      const limits = await this.limits(client, context);
      const candidates = (await client.query(currentCandidates, [explorationId]))
        .rows as ExplorationCandidate[];
      const room = limits.maxCandidates - candidates.length;
      if (room <= 0) {
        throw conflict(
          'EXPLORATION_CANDIDATE_LIMIT',
          'This exploration already has the most candidates it can hold.',
        );
      }
      const ai = await this.ai(client, context);
      const history = (
        await client.query<{ role: string; content: string }>(
          `select role, content from exploration_messages
            where exploration_id = $1 and status = 'done' order by seq desc limit $2`,
          [explorationId, HISTORY_MESSAGES],
        )
      ).rows.reverse();
      return { exploration, ai, history, candidates, room };
    });

    const instructions = composeInstructions({
      role: 'analyst',
      content: plan.ai.definition,
      language: plan.exploration.outputLanguage,
      task: EXPLORATION_PROPOSAL_TASK,
      rules: [
        ...EXPLORATION_RULES,
        `Propose at most ${Math.min(plan.room, EXPLORATION_LIMITS.perProposal)} candidates.`,
      ],
    });
    const message = dataBlock({
      eventText: plan.exploration.eventText,
      conversation: plan.history.map((item) => ({
        from: item.role,
        text: item.content.slice(0, HISTORY_EXCERPT),
      })),
      candidates: this.candidateDigest(plan.candidates),
    });
    let proposed: unknown = [];
    let invocationId: string | null = null;
    try {
      const result = await this.runtime.invoke(
        {
          workspaceId: context.workspaceId,
          onBehalfOf: context.actorId,
          projectId: null,
          stageRunId: null,
          attemptId: null,
          purpose: 'exploration:proposal',
          retryNo: 0,
          agentDefinitionVersionId: plan.ai.definition.id,
          promptSha256: promptDigest({ instructions, message }),
        },
        plan.ai.connectionId,
        {
          model: plan.ai.model,
          instructions,
          messages: [{ role: 'user', content: message }],
          responseSchema: {
            name: EXPLORATION_PROPOSAL_SCHEMA_NAME,
            schema: EXPLORATION_PROPOSAL_SCHEMA,
          },
          timeoutMs: MODEL_TIMEOUT_MS,
        },
      );
      invocationId = result.invocationId;
      const json = result.response.json as { candidates?: unknown } | null;
      if (result.response.finishReason === 'stop' && json) proposed = json.candidates;
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      throw unprocessable('EXPLORATION_PROPOSAL_FAILED', 'The model could not propose candidates.');
    }
    const { items, discarded } = normalizeCandidates(proposed, {
      existingTitles: plan.candidates.map((item) => item.title),
      room: plan.room,
    });
    if (items.length === 0) {
      throw unprocessable('EXPLORATION_PROPOSAL_FAILED', 'The model proposed no new candidate.', {
        discarded,
      });
    }

    return this.database.run(context, async (client) => {
      await this.lock(client, explorationId);
      // The room was measured before the model call; measure again so two proposals cannot overfill.
      const now = (await client.query(currentCandidates, [explorationId])).rows.length;
      const limits = await this.limits(client, context);
      const added = items.slice(0, Math.max(0, limits.maxCandidates - now));
      if (added.length === 0) {
        throw conflict(
          'EXPLORATION_CANDIDATE_LIMIT',
          'This exploration already has the most candidates it can hold.',
        );
      }
      for (const item of added) {
        await this.insertCandidate(
          client,
          context,
          explorationId,
          randomUUID(),
          1,
          item,
          'ai',
          invocationId,
        );
      }
      await client.query(`update explorations set updated_at = now() where id = $1`, [
        explorationId,
      ]);
      await writeAudit(client, context, {
        action: 'exploration.candidates_proposed',
        targetType: 'exploration',
        targetId: explorationId,
        after: { added: added.length, discarded: discarded + (items.length - added.length) },
      });
      return this.read(client, context, explorationId);
    });
  }

  /** A candidate the administrator wrote by hand. */
  async addCandidate(context: WorkspaceRequestContext, explorationId: string, raw: unknown) {
    const candidate = normalizeCandidate(raw);
    if (!candidate) {
      throw badRequest('EXPLORATION_INVALID_REQUEST', 'A candidate needs a title and a problem.');
    }
    return this.database.run(context, async (client) => {
      const exploration = await this.lock(client, explorationId);
      if (exploration.status === 'archived') this.archived();
      const existing = (await client.query(currentCandidates, [explorationId]))
        .rows as ExplorationCandidate[];
      const limits = await this.limits(client, context);
      if (existing.length >= limits.maxCandidates) {
        throw conflict(
          'EXPLORATION_CANDIDATE_LIMIT',
          'This exploration already has the most candidates it can hold.',
        );
      }
      this.assertTitleFree(existing, candidate.title, null);
      const key = randomUUID();
      await this.insertCandidate(client, context, explorationId, key, 1, candidate, 'admin', null);
      await client.query(`update explorations set updated_at = now() where id = $1`, [
        explorationId,
      ]);
      await writeAudit(client, context, {
        action: 'exploration.candidate_added',
        targetType: 'exploration',
        targetId: explorationId,
        after: { candidateKey: key },
      });
      return this.read(client, context, explorationId);
    });
  }

  /** An edit is a new version of the candidate; the older versions stay as history. */
  async editCandidate(
    context: WorkspaceRequestContext,
    explorationId: string,
    candidateKey: string,
    input: { basedOnVersionNo: number; candidate: unknown },
  ) {
    const candidate = normalizeCandidate(input.candidate);
    if (!candidate) {
      throw badRequest('EXPLORATION_INVALID_REQUEST', 'A candidate needs a title and a problem.');
    }
    return this.database.run(context, async (client) => {
      await this.lock(client, explorationId);
      const existing = (await client.query(currentCandidates, [explorationId]))
        .rows as ExplorationCandidate[];
      const current = existing.find((item) => item.candidateKey === candidateKey);
      if (!current) {
        throw notFound('EXPLORATION_CANDIDATE_NOT_FOUND', 'The candidate was not found.');
      }
      if (current.versionNo !== input.basedOnVersionNo) {
        throw conflict(
          'EXPLORATION_CANDIDATE_VERSION_CONFLICT',
          'The candidate changed since you loaded it. Reload and try again.',
        );
      }
      this.assertTitleFree(existing, candidate.title, candidateKey);
      await this.insertCandidate(
        client,
        context,
        explorationId,
        candidateKey,
        current.versionNo + 1,
        candidate,
        'admin',
        null,
      );
      await client.query(`update explorations set updated_at = now() where id = $1`, [
        explorationId,
      ]);
      await writeAudit(client, context, {
        action: 'exploration.candidate_edited',
        targetType: 'exploration',
        targetId: explorationId,
        after: { candidateKey, versionNo: current.versionNo + 1 },
      });
      return this.read(client, context, explorationId);
    });
  }

  /**
   * Parks, drops or brings back a candidate. Reversible: a decision is one more row, and the
   * newest decision is the state. Making a project from it is not a decision a request can make.
   */
  async decide(
    context: WorkspaceRequestContext,
    explorationId: string,
    candidateKey: string,
    input: { decision: string; reason: string },
  ) {
    if (!isCandidateDecision(input.decision)) {
      throw badRequest(
        'EXPLORATION_INVALID_REQUEST',
        'A candidate can be put back to proposed, parked or dropped.',
      );
    }
    const decision = input.decision;
    return this.database.run(context, async (client) => {
      await this.lock(client, explorationId);
      const current = (
        (await client.query(currentCandidates, [explorationId])).rows as ExplorationCandidate[]
      ).find((item) => item.candidateKey === candidateKey);
      if (!current) {
        throw notFound('EXPLORATION_CANDIDATE_NOT_FOUND', 'The candidate was not found.');
      }
      if (current.state === 'promoted') {
        throw conflict(
          'EXPLORATION_CANDIDATE_PROMOTED',
          'A project was made from this candidate; its state no longer changes here.',
        );
      }
      if (current.state !== decision) {
        await client.query(
          `insert into exploration_candidate_decisions
             (workspace_id, exploration_id, candidate_key, decision, reason, decided_by)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            context.workspaceId,
            explorationId,
            candidateKey,
            decision,
            input.reason,
            context.actorId,
          ],
        );
        await client.query(`update explorations set updated_at = now() where id = $1`, [
          explorationId,
        ]);
        await writeAudit(client, context, {
          action: 'exploration.candidate_decided',
          targetType: 'exploration',
          targetId: explorationId,
          after: {
            candidateKey,
            from: current.state,
            to: decision,
            hasReason: input.reason !== '',
          },
        });
      }
      return this.read(client, context, explorationId);
    });
  }

  // ---------------------------------------------------------------------------------------

  private async read(
    client: PoolClient,
    context: WorkspaceRequestContext,
    explorationId: string,
  ): Promise<ExplorationDetail> {
    const exploration = (
      await client.query<ExplorationRow>(
        `select ${explorationColumns} from explorations where id = $1 and workspace_id = $2`,
        [explorationId, context.workspaceId],
      )
    ).rows[0];
    if (!exploration) throw notFound('EXPLORATION_NOT_FOUND', 'The exploration was not found.');
    const messages = (
      await client.query<ExplorationMessage>(
        `select id, seq, role, content, status, ${isoColumn('created_at', '"createdAt"')}
           from exploration_messages where exploration_id = $1 order by seq`,
        [explorationId],
      )
    ).rows;
    const candidates = (await client.query(currentCandidates, [explorationId]))
      .rows as ExplorationCandidate[];
    const limits = await this.limits(client, context);
    return {
      exploration,
      messages,
      candidates,
      limits: {
        maxMessages: limits.maxMessages,
        maxCandidates: limits.maxCandidates,
        usedMessages: messages.filter((item) => item.role === 'admin').length,
        usedCandidates: candidates.length,
        textMax: {
          title: EXPLORATION_LIMITS.title,
          eventText: EXPLORATION_LIMITS.eventText,
          message: EXPLORATION_LIMITS.message,
          reason: EXPLORATION_LIMITS.reason,
        },
      },
    };
  }

  /** Locks the exploration row so two writers cannot both take the same message number or room. */
  private async lock(client: PoolClient, explorationId: string): Promise<ExplorationRow> {
    const row = (
      await client.query<ExplorationRow>(
        `select ${explorationColumns} from explorations where id = $1 for update`,
        [explorationId],
      )
    ).rows[0];
    if (!row) throw notFound('EXPLORATION_NOT_FOUND', 'The exploration was not found.');
    return row;
  }

  private assertVersion(row: ExplorationRow, expected: number) {
    if (row.version !== expected) {
      throw conflict(
        'EXPLORATION_VERSION_CONFLICT',
        'The exploration changed since you loaded it. Reload and try again.',
      );
    }
  }

  private archived(): never {
    throw conflict('EXPLORATION_ARCHIVED', 'Reopen the exploration before changing it.');
  }

  private assertTitleFree(
    existing: readonly ExplorationCandidate[],
    title: string,
    ownKey: string | null,
  ) {
    const wanted = title.trim().toLowerCase();
    if (
      existing.some((item) => item.candidateKey !== ownKey && item.title.toLowerCase() === wanted)
    ) {
      throw conflict(
        'EXPLORATION_CANDIDATE_DUPLICATE',
        'A candidate with this title already exists.',
      );
    }
  }

  private async appendMessage(
    client: PoolClient,
    context: WorkspaceRequestContext,
    explorationId: string,
    input: {
      role: 'admin' | 'agent';
      content: string;
      status: 'done' | 'failed';
      invocationId: string | null;
    },
  ): Promise<ExplorationMessage> {
    return (
      await client.query<ExplorationMessage>(
        `insert into exploration_messages
           (workspace_id, exploration_id, seq, role, content, status, invocation_id, author_id)
         values ($1, $2, (select coalesce(max(seq), 0) + 1 from exploration_messages where exploration_id = $2),
                 $3, $4, $5, $6, $7)
         returning id, seq, role, content, status, ${isoColumn('created_at', '"createdAt"')}`,
        [
          context.workspaceId,
          explorationId,
          input.role,
          input.content,
          input.status,
          input.invocationId,
          input.role === 'admin' ? context.actorId : null,
        ],
      )
    ).rows[0]!;
  }

  private async insertCandidate(
    client: PoolClient,
    context: WorkspaceRequestContext,
    explorationId: string,
    candidateKey: string,
    versionNo: number,
    candidate: CandidateInput,
    source: 'ai' | 'admin',
    invocationId: string | null,
  ) {
    await client.query(
      `insert into exploration_candidates
         (workspace_id, exploration_id, candidate_key, version_no, title, problem_draft, why,
          assumptions, expected_output, source, invocation_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        context.workspaceId,
        explorationId,
        candidateKey,
        versionNo,
        candidate.title,
        candidate.problemDraft,
        candidate.why,
        candidate.assumptions,
        candidate.expectedOutput,
        source,
        invocationId,
        source === 'admin' ? context.actorId : null,
      ],
    );
  }

  private candidateDigest(candidates: readonly ExplorationCandidate[]) {
    return candidates.map((item) => ({
      title: item.title,
      state: item.state,
      problem: item.problemDraft.slice(0, CANDIDATE_EXCERPT),
    }));
  }

  private async limits(client: PoolClient, context: WorkspaceRequestContext) {
    const effective = await this.config.resolve(client, context, 'workspace', context.workspaceId);
    const integer = (key: string, fallback: number) => {
      const value = effective.values[key];
      return typeof value === 'number' && Number.isInteger(value) ? value : fallback;
    };
    return {
      maxMessages: integer('exploration.max_messages', EXPLORATION_LIMITS.defaultMaxMessages),
      maxCandidates: integer('exploration.max_candidates', EXPLORATION_LIMITS.defaultMaxCandidates),
    };
  }

  /** The connection and model, and the analyst definition the workspace has active. */
  private async ai(client: PoolClient, context: WorkspaceRequestContext) {
    const effective = await this.config.resolve(client, context, 'workspace', context.workspaceId);
    const definition = await activeAgentVersion(client, context.workspaceId, 'analyst');
    const connectionId =
      definition.modelPolicy?.connectionId ?? settingText(effective.values['ai.connection_id']);
    const model = definition.modelPolicy?.model ?? settingText(effective.values['ai.model']);
    if (!connectionId || !model) {
      throw conflict('AI_NOT_CONFIGURED', 'Set ai.connection_id and ai.model first.');
    }
    return { definition, connectionId, model };
  }
}
