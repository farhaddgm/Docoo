import { analysisLimits, type AnalysisProfile } from '@docoo/domain';
import type { PoolClient } from 'pg';

/** Retain prior quick questions by reference, without copying or renumbering their identities. */
export async function analysisSession(client: PoolClient, id: string) {
  const row = (
    await client.query<{
      id: string;
      analysis_profile: AnalysisProfile;
      continued_from_session_id: string | null;
      source_profile: string | null;
      source_status: string | null;
    }>(
      `select s.id,s.analysis_profile,s.continued_from_session_id,
              prior.analysis_profile as source_profile,r.status::text as source_status
         from analysis_sessions s
         left join analysis_sessions prior on prior.id=s.continued_from_session_id
           and prior.project_id=s.project_id and prior.workspace_id=s.workspace_id
         left join stage_runs sr on sr.id=prior.stage_run_id
         left join workflow_runs r on r.id=sr.run_id
        where s.id=$1`,
      [id],
    )
  ).rows[0];
  if (
    !row ||
    (row.continued_from_session_id &&
      (row.source_profile !== 'quick' || row.source_status !== 'completed'))
  )
    throw new Error('Analysis continuation is unavailable.');
  return {
    profile: row.analysis_profile,
    limits: analysisLimits(row.analysis_profile),
    sessionIds: row.continued_from_session_id ? [id, row.continued_from_session_id] : [id],
  };
}
