import { createHash } from 'node:crypto';

import {
  assertToolAllowed,
  ToolNotAllowedError,
  type AgentRole,
  type AgentTool,
} from '@docoo/domain';
import type { PoolClient } from 'pg';

import { canonicalJson } from './knowledge-retrieval.js';

/**
 * The tool ledger of the agents (FR-AGT-005, docs/03-ai/01-agent-system.md §6). Every use of a
 * tool by a role passes `toolDecision`, which decides from the allowlist of the pinned definition,
 * and `recordToolCall` writes one append-only row, allowed or denied. The row holds a digest of
 * the input and a reference to the output, never the content itself.
 */
export interface ToolCallScope {
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly stageRunId: string | null;
  readonly attemptId: string | null;
  readonly role: AgentRole;
  readonly agentDefinitionVersionId: string | null;
  /** The tools the pinned definition allows. */
  readonly allowed: readonly string[];
}

export interface ToolCallRecord {
  readonly id: string;
  readonly tool: AgentTool;
  readonly decision: 'allowed' | 'denied';
  readonly outputRef: { readonly type: string; readonly id: string } | null;
  readonly result: Record<string, unknown>;
}

export const inputDigest = (input: unknown): string =>
  createHash('sha256').update(canonicalJson(input)).digest('hex');

/** Whether the pinned definition lets the role use the tool; the gate every call passes. */
export function toolDecision(scope: ToolCallScope, tool: AgentTool): 'allowed' | 'denied' {
  try {
    assertToolAllowed(scope.role, scope.allowed, tool);
    return 'allowed';
  } catch (error) {
    if (error instanceof ToolNotAllowedError) return 'denied';
    throw error;
  }
}

export async function recordToolCall(
  client: PoolClient,
  scope: ToolCallScope,
  call: {
    readonly tool: AgentTool;
    readonly decision: 'allowed' | 'denied';
    readonly input: unknown;
    readonly outputRef?: { readonly type: string; readonly id: string } | null;
    readonly result?: Record<string, unknown>;
    readonly latencyMs?: number | null;
    readonly errorCode?: string | null;
  },
): Promise<string> {
  const row = await client.query<{ id: string }>(
    `insert into agent_tool_calls
       (workspace_id, project_id, stage_run_id, attempt_id, role, agent_definition_version_id, tool,
        decision, input_sha256, output_ref, result, latency_ms, error_code)
     values ($1, $2, $3, $4, $5::agent_role, $6, $7, $8::agent_tool_decision, $9, $10::jsonb, $11::jsonb, $12, $13)
     returning id`,
    [
      scope.workspaceId,
      scope.projectId,
      scope.stageRunId,
      scope.attemptId,
      scope.role,
      scope.agentDefinitionVersionId,
      call.tool,
      call.decision,
      inputDigest(call.input),
      call.outputRef ? JSON.stringify(call.outputRef) : null,
      JSON.stringify(call.result ?? {}),
      call.latencyMs ?? null,
      call.errorCode ?? null,
    ],
  );
  return row.rows[0]!.id;
}

/** The calls of one tool already recorded for an attempt, oldest first (a retry reuses them). */
export async function loadToolCalls(
  client: PoolClient,
  attemptId: string,
  tool: AgentTool,
): Promise<ToolCallRecord[]> {
  const result = await client.query<{
    id: string;
    tool: AgentTool;
    decision: 'allowed' | 'denied';
    output_ref: { type: string; id: string } | null;
    result: Record<string, unknown>;
  }>(
    `select id, tool, decision::text as decision, output_ref, result
       from agent_tool_calls where attempt_id = $1 and tool = $2 order by created_at, id`,
    [attemptId, tool],
  );
  return result.rows.map((row) => ({
    id: row.id,
    tool: row.tool,
    decision: row.decision,
    outputRef: row.output_ref,
    result: row.result,
  }));
}
