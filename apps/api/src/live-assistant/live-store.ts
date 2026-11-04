import type {
  AssistantAccessRule,
  LiveActionStatus,
  LiveActionView,
  LiveAssistantCaps,
  LiveCancelReason,
  LiveCostSummary,
  LiveMessageView,
  LiveRefusalReason,
  LiveSessionEndReason,
  LiveSessionView,
  RiskTier,
} from '@docoo/contracts';
import type { PoolClient, QueryResultRow } from 'pg';

import { isoColumn } from '../common/pagination.js';
import { nextStepOf } from './live-gateway.js';

/**
 * The SQL of the live assistant's ledger (migration 0085). Every function takes the client of a
 * transaction that already carries the tenant context, so row security decides whose rows these
 * are; none of them trusts an id it was not given by the caller.
 */

interface SessionRow extends QueryResultRow {
  id: string;
  status: 'active' | 'ended';
  end_reason: LiveSessionEndReason | null;
  mode: 'realtime' | 'pipeline' | 'text';
  model: string;
  caps: LiveAssistantCaps;
  access_rules: AssistantAccessRule[];
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
  minutes: number;
  message_count: number;
}

const sessionColumns = `
  id, status, end_reason, mode, model, caps, access_rules,
  (input_tokens + executor_input_tokens)::float8 as input_tokens,
  (output_tokens + executor_output_tokens)::float8 as output_tokens,
  (cost_usd + executor_cost_usd)::float8 as cost_usd,
  ${isoColumn('started_at', 'started_at')}, ${isoColumn('last_activity_at', 'last_activity_at')},
  ${isoColumn('ended_at', 'ended_at')},
  (extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60.0)::float8 as minutes,
  (select count(*)::int from live_messages m where m.session_id = live_sessions.id) as message_count`;

export function toSessionView(row: SessionRow): LiveSessionView {
  return {
    id: row.id,
    status: row.status,
    endReason: row.end_reason,
    mode: row.mode,
    model: row.model,
    startedAt: row.started_at,
    lastActivityAt: row.last_activity_at,
    endedAt: row.ended_at,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    minutes: row.minutes,
    messageCount: row.message_count,
    caps: row.caps,
  };
}

export async function activeSessionId(client: PoolClient, userId: string): Promise<string | null> {
  const row = (
    await client.query<{ id: string }>(
      `select id from live_sessions where user_id = $1 and status = 'active' limit 1`,
      [userId],
    )
  ).rows[0];
  return row?.id ?? null;
}

/** Ends whatever session this person left running (a crashed browser, a second tab). */
export async function supersedeActiveSession(
  client: PoolClient,
  userId: string,
): Promise<string | null> {
  const row = (
    await client.query<{ id: string }>(
      `update live_sessions
          set status = 'ended', end_reason = 'superseded', ended_at = now()
        where user_id = $1 and status = 'active'
        returning id`,
      [userId],
    )
  ).rows[0];
  return row?.id ?? null;
}

export async function insertSession(
  client: PoolClient,
  input: {
    workspaceId: string;
    userId: string;
    mode: 'realtime' | 'pipeline' | 'text';
    model: string;
    caps: LiveAssistantCaps;
    rules: readonly AssistantAccessRule[];
  },
): Promise<string> {
  const row = (
    await client.query<{ id: string }>(
      `insert into live_sessions (workspace_id, user_id, mode, model, caps, access_rules)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb) returning id`,
      [
        input.workspaceId,
        input.userId,
        input.mode,
        input.model,
        JSON.stringify(input.caps),
        JSON.stringify(input.rules),
      ],
    )
  ).rows[0];
  if (!row) throw new Error('A live session was not created.');
  return row.id;
}

export async function readSession(
  client: PoolClient,
  sessionId: string,
  options: { lock?: boolean } = {},
): Promise<LiveSessionView | null> {
  const row = (
    await client.query<SessionRow>(
      `select ${sessionColumns} from live_sessions where id = $1${options.lock ? ' for update' : ''}`,
      [sessionId],
    )
  ).rows[0];
  return row ? toSessionView(row) : null;
}

export async function listSessions(client: PoolClient, limit: number): Promise<LiveSessionView[]> {
  const rows = (
    await client.query<SessionRow>(
      `select ${sessionColumns} from live_sessions order by started_at desc limit $1`,
      [limit],
    )
  ).rows;
  return rows.map(toSessionView);
}

/** Cost of every session of the workspace that began in the last 24 hours, this one included. */
export async function dailyCostUsd(client: PoolClient, workspaceId: string): Promise<number> {
  const row = (
    await client.query<{ total: number }>(
      `select coalesce(sum(cost_usd + executor_cost_usd), 0)::float8 as total
         from live_sessions
        where workspace_id = $1 and started_at >= now() - interval '24 hours'`,
      [workspaceId],
    )
  ).rows[0];
  return row?.total ?? 0;
}

/** What the sessions cost over the last day, week and 30 days (a period is "sessions that began in it"). */
export async function costPeriods(
  client: PoolClient,
  workspaceId: string,
): Promise<Record<'day' | 'week' | 'month', LiveCostSummary['day']>> {
  const row = (
    await client.query<Record<string, number>>(
      `select
         coalesce(sum(cost_usd + executor_cost_usd) filter (where started_at >= now() - interval '24 hours'), 0)::float8 as day_cost,
         coalesce(sum(executor_cost_usd) filter (where started_at >= now() - interval '24 hours'), 0)::float8 as day_typed,
         coalesce(sum(input_tokens + output_tokens + executor_input_tokens + executor_output_tokens) filter (where started_at >= now() - interval '24 hours'), 0)::float8 as day_tokens,
         (count(*) filter (where started_at >= now() - interval '24 hours'))::int as day_sessions,
         coalesce(sum(cost_usd + executor_cost_usd) filter (where started_at >= now() - interval '7 days'), 0)::float8 as week_cost,
         coalesce(sum(executor_cost_usd) filter (where started_at >= now() - interval '7 days'), 0)::float8 as week_typed,
         coalesce(sum(input_tokens + output_tokens + executor_input_tokens + executor_output_tokens) filter (where started_at >= now() - interval '7 days'), 0)::float8 as week_tokens,
         (count(*) filter (where started_at >= now() - interval '7 days'))::int as week_sessions,
         coalesce(sum(cost_usd + executor_cost_usd), 0)::float8 as month_cost,
         coalesce(sum(executor_cost_usd), 0)::float8 as month_typed,
         coalesce(sum(input_tokens + output_tokens + executor_input_tokens + executor_output_tokens), 0)::float8 as month_tokens,
         count(*)::int as month_sessions
       from live_sessions
      where workspace_id = $1 and started_at >= now() - interval '30 days'`,
      [workspaceId],
    )
  ).rows[0]!;
  const period = (key: 'day' | 'week' | 'month') => ({
    costUsd: row[`${key}_cost`] ?? 0,
    typedCostUsd: row[`${key}_typed`] ?? 0,
    tokens: row[`${key}_tokens`] ?? 0,
    sessions: row[`${key}_sessions`] ?? 0,
  });
  return { day: period('day'), week: period('week'), month: period('month') };
}

/** Totals only grow: a smaller number than the stored one changes nothing. */
export async function recordUsage(
  client: PoolClient,
  sessionId: string,
  usage: { inputTokens: number; outputTokens: number; costUsd: number },
): Promise<void> {
  await client.query(
    `update live_sessions
        set input_tokens = greatest(input_tokens, $2),
            output_tokens = greatest(output_tokens, $3),
            cost_usd = greatest(cost_usd, $4),
            last_activity_at = now()
      where id = $1 and status = 'active'`,
    [sessionId, usage.inputTokens, usage.outputTokens, usage.costUsd],
  );
}

/** How long after reading untrusted content a session's changes are confirmed more strictly. */
export const TAINT_WINDOW_S = 600;

/** Whether the session read untrusted content recently, by the database's own clock. */
export async function sessionTainted(client: PoolClient, sessionId: string): Promise<boolean> {
  const row = (
    await client.query<{ tainted: boolean }>(
      `select coalesce(untrusted_read_at >= now() - make_interval(secs => $2), false) as tainted
         from live_sessions where id = $1`,
      [sessionId, TAINT_WINDOW_S],
    )
  ).rows[0];
  return row?.tainted ?? false;
}

export async function markUntrustedRead(client: PoolClient, sessionId: string): Promise<void> {
  await client.query(
    `update live_sessions set untrusted_read_at = now() where id = $1 and status = 'active'`,
    [sessionId],
  );
}

/** What the executor's model calls used, as the server measured it. Added, never overwritten. */
export async function recordExecutorUsage(
  client: PoolClient,
  sessionId: string,
  usage: { inputTokens: number; outputTokens: number; costUsd: number; calls: number },
): Promise<void> {
  await client.query(
    `update live_sessions
        set executor_input_tokens = executor_input_tokens + $2,
            executor_output_tokens = executor_output_tokens + $3,
            executor_cost_usd = executor_cost_usd + $4,
            executor_calls = executor_calls + $5,
            last_activity_at = now()
      where id = $1 and status = 'active'`,
    [sessionId, usage.inputTokens, usage.outputTokens, usage.costUsd, usage.calls],
  );
}

export async function touchSession(client: PoolClient, sessionId: string): Promise<void> {
  await client.query(
    `update live_sessions set last_activity_at = now() where id = $1 and status = 'active'`,
    [sessionId],
  );
}

export async function endSession(
  client: PoolClient,
  sessionId: string,
  reason: LiveSessionEndReason,
): Promise<boolean> {
  const result = await client.query(
    `update live_sessions
        set status = 'ended', end_reason = $2, ended_at = now()
      where id = $1 and status = 'active'`,
    [sessionId, reason],
  );
  return (result.rowCount ?? 0) > 0;
}

// ---- messages -----------------------------------------------------------------------------

interface MessageRow extends QueryResultRow {
  id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export async function appendMessages(
  client: PoolClient,
  input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    messages: readonly { role: 'user' | 'assistant'; content: string }[];
  },
): Promise<number> {
  const last = (
    await client.query<{ seq: number }>(
      `select coalesce(max(seq), 0)::int as seq from live_messages where session_id = $1`,
      [input.sessionId],
    )
  ).rows[0];
  let seq = last?.seq ?? 0;
  for (const message of input.messages) {
    seq += 1;
    await client.query(
      `insert into live_messages (workspace_id, session_id, user_id, seq, role, content)
       values ($1, $2, $3, $4, $5, $6)`,
      [input.workspaceId, input.sessionId, input.userId, seq, message.role, message.content],
    );
  }
  return input.messages.length;
}

/**
 * Deletes transcript lines: those of one session, or the ones older than the retention. The
 * transcript is append-only, so the delete runs in a transaction that says it is a purge; row
 * security still limits it to the caller's own lines.
 */
export async function purgeMessages(
  client: PoolClient,
  target: { sessionId: string } | { olderThanDays: number },
): Promise<number> {
  await client.query("select set_config('app.retention_purge', 'on', true)");
  const result =
    'sessionId' in target
      ? await client.query('delete from live_messages where session_id = $1', [target.sessionId])
      : await client.query(
          `delete from live_messages where created_at < now() - make_interval(days => $1::int)`,
          [target.olderThanDays],
        );
  return result.rowCount ?? 0;
}

export async function listMessages(
  client: PoolClient,
  sessionId: string,
  limit: number,
): Promise<LiveMessageView[]> {
  const rows = (
    await client.query<MessageRow>(
      `select id, seq, role, content, ${isoColumn('created_at', 'created_at')}
         from live_messages where session_id = $1 order by seq limit $2`,
      [sessionId, limit],
    )
  ).rows;
  return rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

// ---- actions ------------------------------------------------------------------------------

export interface ActionRow extends QueryResultRow {
  id: string;
  session_id: string;
  capability: string;
  project_id: string | null;
  current_project_id: string | null;
  tainted: boolean;
  tier: RiskTier | null;
  steps: string[];
  status: LiveActionStatus;
  summary: string;
  target_name: string | null;
  refusal_reason: LiveRefusalReason | null;
  cancel_reason: LiveCancelReason | null;
  params: unknown;
  result: unknown;
  error_code: string | null;
  proposed_at: string;
  expires_at: string;
  first_confirmed_at: string | null;
  confirmed_at: string | null;
  finished_at: string | null;
  proposed_ms: number;
  first_confirmed_ms: number | null;
  now_ms: number;
  expired: boolean;
}

const actionColumns = `
  id, session_id, capability, project_id, current_project_id, tainted, tier, steps, status,
  summary, target_name, refusal_reason, cancel_reason, params, result, error_code,
  ${isoColumn('proposed_at', 'proposed_at')}, ${isoColumn('expires_at', 'expires_at')},
  ${isoColumn('first_confirmed_at', 'first_confirmed_at')}, ${isoColumn('confirmed_at', 'confirmed_at')},
  ${isoColumn('finished_at', 'finished_at')},
  (extract(epoch from proposed_at) * 1000)::float8 as proposed_ms,
  (extract(epoch from first_confirmed_at) * 1000)::float8 as first_confirmed_ms,
  (extract(epoch from now()) * 1000)::float8 as now_ms,
  (now() >= expires_at) as expired`;

export function toActionView(row: ActionRow): LiveActionView {
  return {
    id: row.id,
    sessionId: row.session_id,
    capability: row.capability,
    projectId: row.project_id,
    tier: row.tier,
    steps: row.steps,
    status: row.status,
    summary: row.summary,
    targetName: row.target_name,
    refusalReason: row.refusal_reason,
    cancelReason: row.cancel_reason,
    result: row.result ?? null,
    errorCode: row.error_code,
    proposedAt: row.proposed_at,
    expiresAt: row.expires_at,
    firstConfirmedAt: row.first_confirmed_at,
    confirmedAt: row.confirmed_at,
    finishedAt: row.finished_at,
    nextStep: nextStepOf(row.status),
  };
}

export async function insertAction(
  client: PoolClient,
  input: {
    workspaceId: string;
    userId: string;
    sessionId: string;
    capability: string;
    projectId: string | null;
    currentProjectId: string | null;
    tier: RiskTier | null;
    steps: readonly string[];
    tainted: boolean;
    params: unknown;
    summary: string;
    targetName: string | null;
    refusalReason: LiveRefusalReason | null;
    confirmTimeoutS: number;
  },
): Promise<ActionRow> {
  const row = (
    await client.query<ActionRow>(
      `insert into live_actions (
         workspace_id, session_id, user_id, capability, project_id, current_project_id, tier, steps,
         tainted, params, summary, target_name, status, refusal_reason, expires_at
       ) values (
         $1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10::jsonb, $11, $12, $13, $14,
         now() + make_interval(secs => $15)
       ) returning ${actionColumns}`,
      [
        input.workspaceId,
        input.sessionId,
        input.userId,
        input.capability,
        input.projectId,
        input.currentProjectId,
        input.tier,
        input.steps,
        input.tainted,
        JSON.stringify(input.params),
        input.summary,
        input.targetName,
        input.refusalReason ? 'refused' : 'proposed',
        input.refusalReason,
        input.confirmTimeoutS,
      ],
    )
  ).rows[0];
  if (!row) throw new Error('A live action was not recorded.');
  return row;
}

export async function readAction(
  client: PoolClient,
  actionId: string,
  options: { lock?: boolean } = {},
): Promise<ActionRow | null> {
  const row = (
    await client.query<ActionRow>(
      `select ${actionColumns} from live_actions where id = $1${options.lock ? ' for update' : ''}`,
      [actionId],
    )
  ).rows[0];
  return row ?? null;
}

export async function listActions(client: PoolClient, sessionId: string): Promise<ActionRow[]> {
  return (
    await client.query<ActionRow>(
      `select ${actionColumns} from live_actions where session_id = $1 order by proposed_at, id`,
      [sessionId],
    )
  ).rows;
}

/** A session that ends takes its unfinished proposals with it: they are cancelled, never run late. */
export async function cancelOpenActions(client: PoolClient, sessionId: string): Promise<number> {
  const result = await client.query(
    `update live_actions
        set status = 'cancelled', cancel_reason = 'session_ended', finished_at = now()
      where session_id = $1 and status in ('proposed','first_confirmed')`,
    [sessionId],
  );
  return result.rowCount ?? 0;
}

/**
 * One move of the state machine. The database trigger is the judge: an illegal move, a late
 * confirmation or a skipped step raises. The `where status = $from` makes two requests racing
 * for the same move produce exactly one winner.
 */
export async function moveAction(
  client: PoolClient,
  actionId: string,
  from: LiveActionStatus,
  to: LiveActionStatus,
  fields: {
    via?: 'voice' | 'click' | 'auto';
    cancelReason?: LiveCancelReason;
    result?: unknown;
    errorCode?: string;
  } = {},
): Promise<ActionRow | null> {
  const sets = ['status = $3'];
  const params: unknown[] = [actionId, from, to];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    sets.push(sql.replace('?', `$${params.length}`));
  };
  if (to === 'first_confirmed') {
    sets.push('first_confirmed_at = now()');
    add('first_confirmed_via = ?', fields.via ?? 'click');
  }
  if (to === 'confirmed') {
    sets.push('confirmed_at = now()');
    add('confirmed_via = ?', fields.via ?? 'click');
  }
  if (to === 'executed' || to === 'failed' || to === 'cancelled' || to === 'expired') {
    sets.push('finished_at = now()');
  }
  if (fields.cancelReason) add('cancel_reason = ?', fields.cancelReason);
  if (fields.result !== undefined) add('result = ?::jsonb', JSON.stringify(fields.result));
  if (fields.errorCode) add('error_code = ?', fields.errorCode);
  const row = (
    await client.query<ActionRow>(
      `update live_actions set ${sets.join(', ')}
        where id = $1 and status = $2 returning ${actionColumns}`,
      params,
    )
  ).rows[0];
  return row ?? null;
}
