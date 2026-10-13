import type { PoolClient } from 'pg';

import { conflict, notFound } from '../common/problems.js';

export interface ProjectProblem {
  initialProblem: string;
  statement: string;
  versionId: string | null;
  definition: Record<string, unknown> | null;
}

/** Read the project's approved analysis output under the caller's RLS context. */
export async function projectProblem(
  client: PoolClient,
  projectId: string,
  lock = false,
): Promise<ProjectProblem> {
  const row = (
    await client.query<{
      initial_problem: string;
      approved_problem_version_id: string | null;
      content: Record<string, unknown> | null;
    }>(
      `select p.initial_problem, p.approved_problem_version_id, o.content
         from projects p
         left join stage_outputs o on o.id = p.approved_problem_version_id
         left join stage_runs s on s.id = o.stage_run_id
        where p.id = $1 and p.deleted_at is null
          and (p.approved_problem_version_id is null or (s.project_id = p.id and s.stage = 'analysis'))
        ${lock ? 'for update of p' : ''}`,
      [projectId],
    )
  ).rows[0];
  if (!row) throw notFound('PROJECT_NOT_FOUND', 'The project or its definition was not found.');
  const statement = row.content?.['problemStatement'];
  if (row.approved_problem_version_id && (typeof statement !== 'string' || !statement.trim()))
    throw conflict(
      'PROJECT_PROBLEM_UNAVAILABLE',
      'The approved problem definition is unavailable.',
    );
  return {
    initialProblem: row.initial_problem,
    statement: typeof statement === 'string' ? statement : row.initial_problem,
    versionId: row.approved_problem_version_id,
    definition: row.content,
  };
}

/** Model output is only stored if it still answers the problem that was sent. */
export async function assertCurrentProblem(
  client: PoolClient,
  projectId: string,
  expected: ProjectProblem,
): Promise<void> {
  const current = await projectProblem(client, projectId, true);
  if (
    current.versionId !== expected.versionId ||
    (!expected.versionId && current.initialProblem !== expected.initialProblem)
  )
    throw conflict('PROJECT_PROBLEM_CHANGED', 'The problem changed; regenerate the result.');
}
