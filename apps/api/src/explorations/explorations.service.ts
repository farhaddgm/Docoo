import { Injectable } from '@nestjs/common';
import {
  CANDIDATE_STATES,
  EXPLORATION_LIMITS,
  type CandidateInput,
  type CandidateState,
  type ExplorationStatus,
} from '@docoo/domain';
import type { PoolClient, QueryResultRow } from 'pg';

import { isoColumn } from '../common/pagination.js';
import { notFound } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';

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

const byStateOf = (candidates: readonly { state: CandidateState }[]) =>
  Object.fromEntries(
    CANDIDATE_STATES.map((state) => [
      state,
      candidates.filter((item) => item.state === state).length,
    ]),
  ) as Record<CandidateState, number>;

/**
 * The explorations of ADR-0044, read only (ADR-0045 step F). A new exploration is a project of
 * kind `exploration`; the older ones stay readable here and are not changed any more. Messages,
 * candidates and decisions are append-only rows that are kept.
 */
@Injectable()
export class ExplorationsService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
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

  async get(context: WorkspaceRequestContext, explorationId: string) {
    return this.database.run(context, (client) => this.read(client, context, explorationId));
  }

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
}
