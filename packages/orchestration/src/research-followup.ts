import { planExtends, type PromptResearchQuestion } from '@docoo/domain';
import type { PoolClient } from 'pg';

import { confirmedResearchPlan } from './research-plan.js';
import type { ResearchContent } from './research.js';

/** The short token the rejection that starts a follow-up round carries in its comment. */
export const followupMarker = (token: string): string => `#fu-${token}`;

/** A follow-up round the current attempt of the research stage carries out (ADR-0039). */
export interface ResearchFollowup {
  readonly id: string;
  /** The questions the round works on, as they were when it was asked. */
  readonly focus: readonly PromptResearchQuestion[];
  /** The output the round follows and is joined onto. */
  readonly previous: ResearchContent;
  /** The whole current plan, for the coverage of every question after the join. */
  readonly plan: {
    readonly versionNo: number;
    readonly questions: readonly PromptResearchQuestion[];
  };
}

/**
 * The follow-up round the next attempt of the stage is, or null for an ordinary attempt. A round
 * applies only while the output it followed is still the stage's latest one and the rejection
 * carrying its token exists, so no other rejection can start it by accident. It is also dropped
 * when the plan was rewritten since (the ids no longer mean what they meant): the attempt then
 * simply researches the whole plan again.
 */
export async function activeResearchFollowup(
  client: PoolClient,
  stageRunId: string,
  projectId: string,
): Promise<ResearchFollowup | null> {
  const row = (
    await client.query<{
      id: string;
      questions: PromptResearchQuestion[];
      content: ResearchContent;
    }>(
      `select f.id, f.questions, o.content
         from research_followups f
         join stage_runs s on s.id = f.stage_run_id and s.latest_output_id = f.output_id
         join stage_outputs o on o.id = f.output_id
        where f.stage_run_id = $1
          and exists (select 1 from stage_reviews r
                       where r.stage_run_id = f.stage_run_id and r.output_id = f.output_id
                         and r.action = 'reject' and position($2 || f.token in coalesce(r.comment, '')) > 0)
        order by f.created_at desc limit 1`,
      [stageRunId, '#fu-'],
    )
  ).rows[0];
  if (!row?.content.plan) return null;
  const plan = await confirmedResearchPlan(client, projectId);
  if (!plan || !planExtends(row.content.plan.questions, plan.questions)) return null;
  return { id: row.id, focus: row.questions, previous: row.content, plan };
}
