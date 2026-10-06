import { validateDocument, visibleText } from '@docoo/documents';
import { WORKFLOW_STAGES, type WorkflowStage } from '@docoo/domain';
import type { PoolClient } from 'pg';

import { compactResearchForPrompt } from './research.js';

/**
 * The materials of one project an agent may read with `project_documents_read` (ADR-0023): the
 * approved problem definition, the output of every stage that was completed before the stage the
 * agent works on, the solutions, and the project's documents. Nothing outside the project is
 * reachable, nothing of the stage being written or later is, and everything is read-only.
 */
export const MATERIAL_LIMITS = {
  /** Characters of one material handed to the model. */
  maxChars: 10_000,
} as const;

export interface MaterialEntry {
  /** `problem`, `stage:research`, `solution:2`, `document:1`: the only way to name a material. */
  readonly ref: string;
  readonly title: string;
  readonly kind: 'problem' | 'stage' | 'solution' | 'document';
}

export type MaterialRead =
  | {
      readonly ok: true;
      readonly entry: MaterialEntry;
      readonly content: string;
      readonly truncated: boolean;
    }
  | { readonly ok: false; readonly error: 'unknown_ref' | 'not_found' };

const clip = (text: string, max: number): { text: string; truncated: boolean } =>
  text.length <= max
    ? { text, truncated: false }
    : { text: `${text.slice(0, max - 1).trimEnd()}…`, truncated: true };

/** Whether a reference has the shape of one of the four kinds; the database decides if it exists. */
export function parseMaterialRef(
  ref: string,
):
  | { kind: 'problem' }
  | { kind: 'stage'; stage: WorkflowStage }
  | { kind: 'solution' | 'document'; number: number }
  | null {
  if (ref === 'problem') return { kind: 'problem' };
  const colon = ref.indexOf(':');
  const kind = colon < 0 ? ref : ref.slice(0, colon);
  const rest = colon < 0 ? '' : ref.slice(colon + 1);
  if (kind === 'stage') {
    const stage = WORKFLOW_STAGES.find((candidate) => candidate === rest);
    return stage ? { kind: 'stage', stage } : null;
  }
  if ((kind === 'solution' || kind === 'document') && /^[1-9]\d{0,3}$/u.test(rest)) {
    return { kind, number: Number(rest) };
  }
  return null;
}

interface StageContext {
  readonly projectId: string;
  /** Sequence (1 to 5) of the stage the reader works on; only earlier stages are readable. */
  readonly sequence: number;
  readonly runId: string;
}

async function stageContext(
  client: PoolClient,
  stageRunId: string | null,
  projectId: string,
): Promise<StageContext> {
  if (stageRunId) {
    const row = (
      await client.query<{ sequence: number; run_id: string }>(
        'select sequence, run_id from stage_runs where id = $1 and project_id = $2',
        [stageRunId, projectId],
      )
    ).rows[0];
    if (row) return { projectId, sequence: row.sequence, runId: row.run_id };
  }
  // Outside a stage (nothing to protect) every completed stage of the latest run is readable.
  const run = (
    await client.query<{ id: string }>(
      'select id from workflow_runs where project_id = $1 order by created_at desc limit 1',
      [projectId],
    )
  ).rows[0];
  return { projectId, sequence: 99, runId: run?.id ?? '00000000-0000-0000-0000-000000000000' };
}

/** What exists to read, for the stage the reader works on. */
export async function listMaterials(
  client: PoolClient,
  input: { readonly projectId: string; readonly stageRunId: string | null },
): Promise<MaterialEntry[]> {
  const context = await stageContext(client, input.stageRunId, input.projectId);
  const entries: MaterialEntry[] = [];
  const problem = await client.query(
    'select 1 from projects where id = $1 and approved_problem_version_id is not null',
    [input.projectId],
  );
  if (problem.rowCount)
    entries.push({ ref: 'problem', title: 'Approved problem definition', kind: 'problem' });
  const stages = await client.query<{ stage: WorkflowStage }>(
    `select stage from stage_runs
      where run_id = $1 and status = 'completed' and sequence < $2 and latest_output_id is not null
        and stage <> 'analysis'
      order by sequence`,
    [context.runId, context.sequence],
  );
  for (const row of stages.rows)
    entries.push({
      ref: `stage:${row.stage}`,
      title: `Output of the ${row.stage} stage`,
      kind: 'stage',
    });
  const solutions = await client.query<{ ordinal: number; title: string }>(
    `select s.ordinal, s.title from solutions s
      where s.project_id = $1 and s.set_id = (
        select id from solution_sets where project_id = $1 order by created_at desc, id desc limit 1)
      order by s.ordinal`,
    [input.projectId],
  );
  for (const row of solutions.rows)
    entries.push({ ref: `solution:${row.ordinal}`, title: row.title, kind: 'solution' });
  const documents = await client.query<{ priority: number; title: string }>(
    `select priority, title from documents
      where project_id = $1 and current_version_id is not null order by priority, id`,
    [input.projectId],
  );
  for (const row of documents.rows)
    entries.push({ ref: `document:${row.priority}`, title: row.title, kind: 'document' });
  return entries;
}

/** One material, as text; the reference must be one `listMaterials` would give for this reader. */
export async function readMaterial(
  client: PoolClient,
  input: { readonly projectId: string; readonly stageRunId: string | null; readonly ref: string },
): Promise<MaterialRead> {
  const parsed = parseMaterialRef(input.ref);
  if (!parsed) return { ok: false, error: 'unknown_ref' };
  const listed = await listMaterials(client, input);
  const entry = listed.find((item) => item.ref === input.ref);
  if (!entry) return { ok: false, error: 'not_found' };
  const context = await stageContext(client, input.stageRunId, input.projectId);

  let raw: string | null = null;
  if (parsed.kind === 'problem') {
    const row = (
      await client.query<{ content: unknown }>(
        `select o.content from projects p join stage_outputs o on o.id = p.approved_problem_version_id
          where p.id = $1`,
        [input.projectId],
      )
    ).rows[0];
    raw = row ? JSON.stringify(row.content) : null;
  } else if (parsed.kind === 'stage') {
    const row = (
      await client.query<{ content: unknown }>(
        `select o.content from stage_runs s join stage_outputs o on o.id = s.latest_output_id
          where s.run_id = $1 and s.stage = $2 and s.status = 'completed'`,
        [context.runId, parsed.stage],
      )
    ).rows[0];
    raw = row
      ? JSON.stringify(
          parsed.stage === 'research' ? compactResearchForPrompt(row.content) : row.content,
        )
      : null;
  } else if (parsed.kind === 'solution') {
    const row = (
      await client.query<{
        title: string;
        summary: string;
        assumptions: unknown;
        evidence: unknown;
        plan: unknown;
        risks: unknown;
      }>(
        `select title, summary, assumptions, evidence, plan, risks from solutions
          where project_id = $1 and ordinal = $2
            and set_id = (select id from solution_sets where project_id = $1 order by created_at desc, id desc limit 1)`,
        [input.projectId, parsed.number],
      )
    ).rows[0];
    raw = row ? JSON.stringify(row) : null;
  } else {
    const row = (
      await client.query<{ title: string; content: unknown }>(
        `select d.title, v.content from documents d join document_versions v on v.id = d.current_version_id
          where d.project_id = $1 and d.priority = $2 order by d.id limit 1`,
        [input.projectId, parsed.number],
      )
    ).rows[0];
    if (row) {
      try {
        raw = visibleText(validateDocument(row.content));
      } catch {
        raw = JSON.stringify(row.content);
      }
    }
  }
  if (raw === null) return { ok: false, error: 'not_found' };
  const { text, truncated } = clip(raw, MATERIAL_LIMITS.maxChars);
  return { ok: true, entry, content: text, truncated };
}
