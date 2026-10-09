import type { Pool } from 'pg';
import { projectResearchPlanSchema } from '@docoo/contracts';
import { inWorkspace, audit } from './db.js';
import { approvedDecisionEvidence, evidenceDigest } from './decision-evidence.js';
import { captureAdaptiveEvidence } from './adaptive-research.js';

export interface DecisionResearchRef {
  workspaceId: string;
  projectId: string;
  actorId: string;
  reportId: string;
}
export function createDecisionResearchActivities(pool: Pool) {
  return {
    async failDecisionResearch(ref: DecisionResearchRef) {
      return inWorkspace(pool, ref, async (client) => {
        await client.query(
          "update project_research_intelligence_reports set status='failed',completed_at=now() where id=$1 and project_id=$2 and actor_id=$3 and status='queued'",
          [ref.reportId, ref.projectId, ref.actorId],
        );
      });
    },
    async runDecisionResearch(ref: DecisionResearchRef) {
      return inWorkspace(pool, ref, async (client) => {
        const row = (
          await client.query<{ status: string; plan: unknown; plan_hash: string }>(
            `select status,plan,plan_hash from project_research_intelligence_reports where id=$1 and project_id=$2 and actor_id=$3 for update`,
            [ref.reportId, ref.projectId, ref.actorId],
          )
        ).rows[0];
        if (!row) throw new Error('Research scope unavailable');
        if (row.status !== 'queued') return { status: row.status };
        const plan = projectResearchPlanSchema.parse(row.plan);
        if (evidenceDigest(JSON.stringify(plan)) !== row.plan_hash)
          throw new Error('Research plan integrity mismatch');
        const rows = await approvedDecisionEvidence(client, {
          ...ref,
          languages: plan.sourceLanguages ?? [plan.language],
        });
        const result = captureAdaptiveEvidence(rows, plan);
        await client.query(
          `update project_research_intelligence_reports set status='succeeded',report=$2::jsonb,manifest=$3::jsonb,completed_at=now() where id=$1`,
          [
            ref.reportId,
            JSON.stringify({ ...result.report, truncated: rows.length === 1000 }),
            JSON.stringify(result.manifest),
          ],
        );
        await audit(client, ref.workspaceId, {
          action: 'intelligence.research.completed',
          targetType: 'research_report',
          targetId: ref.reportId,
          projectId: ref.projectId,
          actorId: ref.actorId,
          after: { coverage: result.report.coverage, claimVisits: result.report.claimVisits },
        });
        return { status: 'succeeded' };
      });
    },
  };
}
