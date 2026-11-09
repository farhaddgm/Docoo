import type { VoiceSourceAction, VoiceSourceMessage, VoiceSourceSession } from '@docoo/contracts';
import type { PoolClient, QueryResultRow } from 'pg';

import { isoColumn } from '../common/pagination.js';
import { listActions } from '../live-assistant/live-store.js';

/**
 * The reads of the voice assistant monitor (ADR-0056). They run in a transaction that carries the
 * tenant context, so row security decides whose sessions these are; nothing here writes. The rows
 * are turned into the plain source of `projectVoiceMonitor`, which decides what a screen may show.
 */

interface SessionRow extends QueryResultRow {
  id: string;
  status: 'active' | 'ended';
  end_reason: string | null;
  mode: string;
  model: string;
  provider: string;
  started_at: string;
  last_activity_at: string;
  minutes: number;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  executor_input_tokens: number;
  executor_output_tokens: number;
  executor_cost_usd: number;
  executor_calls: number;
  session_cost_cap_usd: number | null;
  access_scope: string | null;
  access_level: string | null;
  display_name: string | null;
}

/** The newest sessions of the person the request belongs to, as the projection takes them. */
export async function voiceSessions(
  client: PoolClient,
  limit: number,
): Promise<VoiceSourceSession[]> {
  const rows = (
    await client.query<SessionRow>(
      `select s.id, s.status, s.end_reason, s.mode, s.model, s.provider,
              ${isoColumn('s.started_at', 'started_at')},
              ${isoColumn('s.last_activity_at', 'last_activity_at')},
              (extract(epoch from (coalesce(s.ended_at, now()) - s.started_at)) / 60.0)::float8 as minutes,
              (select count(*)::int from live_messages m where m.session_id = s.id) as message_count,
              s.input_tokens::float8 as input_tokens, s.output_tokens::float8 as output_tokens,
              s.cost_usd::float8 as cost_usd,
              s.executor_input_tokens::float8 as executor_input_tokens,
              s.executor_output_tokens::float8 as executor_output_tokens,
              s.executor_cost_usd::float8 as executor_cost_usd, s.executor_calls,
              (s.caps->>'sessionCostCapUsd')::float8 as session_cost_cap_usd,
              s.access_rules->0->'scope'->>'mode' as access_scope,
              s.access_rules->0->>'level' as access_level,
              u.display_name
         from live_sessions s
         left join users u on u.id = s.user_id
        order by s.started_at desc
        limit $1`,
      [limit],
    )
  ).rows;
  return rows.map((row) => {
    const name = (row.display_name ?? '').trim();
    return {
      id: row.id,
      status: row.status,
      endReason: row.end_reason,
      mode: row.mode,
      model: row.model,
      provider: row.provider,
      startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
      minutes: row.minutes,
      messageCount: row.message_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
      executorInputTokens: row.executor_input_tokens,
      executorOutputTokens: row.executor_output_tokens,
      executorCostUsd: row.executor_cost_usd,
      executorCalls: row.executor_calls,
      sessionCostCapUsd: row.session_cost_cap_usd ?? 0,
      accessScope: row.access_scope,
      accessLevel: row.access_level,
      personFirstName: name.split(/\s+/u)[0] ?? '',
      personFullName: name,
    };
  });
}

/** The last lines of one session, oldest first. */
export async function voiceMessages(
  client: PoolClient,
  sessionId: string,
  limit: number,
): Promise<VoiceSourceMessage[]> {
  const rows = (
    await client.query<{ role: 'user' | 'assistant'; content: string; created_at: string }>(
      `select role, content, created_at from (
         select seq, role, content, ${isoColumn('created_at', 'created_at')}
           from live_messages where session_id = $1 order by seq desc limit $2
       ) last_lines order by seq`,
      [sessionId, limit],
    )
  ).rows;
  return rows.map((row) => ({ role: row.role, content: row.content, createdAt: row.created_at }));
}

/** The proposals of one session, oldest first, without their parameters or results. */
export async function voiceActions(
  client: PoolClient,
  sessionId: string,
): Promise<VoiceSourceAction[]> {
  const rows = await listActions(client, sessionId);
  return rows.map((row) => ({
    status: row.status,
    summary: row.summary,
    targetName: row.target_name,
    steps: row.steps,
    tier: row.tier,
    proposedAt: row.proposed_at,
    finishedAt: row.finished_at,
  }));
}

/** The database's own clock, so the delay and the "talking" window use one clock with the data. */
export async function databaseNowMs(client: PoolClient): Promise<number> {
  const row = (
    await client.query<{ now_ms: number }>(
      `select (extract(epoch from now()) * 1000)::float8 as now_ms`,
    )
  ).rows[0];
  return row?.now_ms ?? Date.now();
}
