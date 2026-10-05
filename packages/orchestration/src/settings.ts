import type { PoolClient } from 'pg';

import { RESEARCH_DEFAULTS } from './research.js';
import { MAX_ATTEMPTS } from './stages.js';

export interface Settings {
  connectionId: string;
  model: string;
  manualGate: boolean;
  attemptLimit: number;
  costLimitUsd: number;
  /** Queries the research stage runs against the knowledge base (`research.max_queries`). */
  researchMaxQueries: number;
  /** Passages the research stage may be given; 0 turns knowledge off (`research.knowledge_limit`). */
  researchKnowledgeLimit: number;
  /** Whether `restricted` knowledge may reach the research prompt (`research.allow_restricted_knowledge`). */
  researchAllowRestricted: boolean;
  /** Distinct knowledge items (sources) the research may use (`research.max_sources`). */
  researchMaxSources: number;
  /** Audit score floor, 0 to 1, for knowledge the Brain approved (`knowledge.min_audit_score`). */
  knowledgeMinAuditScore: number;
  /** The analyst must also ask about risks before "enough" (`analysis.require_risk_dimension`). */
  analysisRequireRisk: boolean;
  /** ... and about what is out of scope (`analysis.require_out_of_scope_dimension`). */
  analysisRequireOutOfScope: boolean;
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function boundedFraction(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

/** The effective configuration the run was started with (FR-CFG-005). */
export async function loadSettings(client: PoolClient, runId: string): Promise<Settings> {
  const row = (
    await client.query<{ resolved: Record<string, unknown> | null }>(
      `select s.resolved from workflow_runs r left join config_snapshots s on s.id = r.config_snapshot_id where r.id = $1`,
      [runId],
    )
  ).rows[0];
  const values = row?.resolved ?? {};
  const limit = Number(values['workflow.max_attempts_per_stage'] ?? MAX_ATTEMPTS);
  return {
    connectionId: typeof values['ai.connection_id'] === 'string' ? values['ai.connection_id'] : '',
    model: typeof values['ai.model'] === 'string' ? values['ai.model'] : '',
    manualGate: values['workflow.require_human_approval'] !== false,
    attemptLimit: Math.max(
      1,
      Math.min(MAX_ATTEMPTS, Number.isFinite(limit) ? limit : MAX_ATTEMPTS),
    ),
    costLimitUsd: Number(values['ai.max_cost_usd_per_run'] ?? 20),
    researchMaxQueries: boundedInteger(
      values['research.max_queries'],
      RESEARCH_DEFAULTS.maxQueries,
      1,
      10,
    ),
    researchKnowledgeLimit: boundedInteger(
      values['research.knowledge_limit'],
      RESEARCH_DEFAULTS.knowledgeLimit,
      0,
      30,
    ),
    researchAllowRestricted: values['research.allow_restricted_knowledge'] === true,
    researchMaxSources: boundedInteger(
      values['research.max_sources'],
      RESEARCH_DEFAULTS.maxSources,
      1,
      200,
    ),
    knowledgeMinAuditScore: boundedFraction(
      values['knowledge.min_audit_score'],
      RESEARCH_DEFAULTS.minAuditScore,
    ),
    analysisRequireRisk: values['analysis.require_risk_dimension'] === true,
    analysisRequireOutOfScope: values['analysis.require_out_of_scope_dimension'] === true,
  };
}
