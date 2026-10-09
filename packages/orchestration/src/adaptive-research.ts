import { createHash } from 'node:crypto';
import { runAdaptiveResearch } from '@docoo/domain';
import type { IntelligenceClaim } from '@docoo/domain';
import type { ProjectResearchManifestItem, ProjectResearchPlan } from '@docoo/contracts';
import { verifiedIntelligenceClaim, type ApprovedEvidenceRow } from './decision-evidence.js';

/** Shared preview/worker policy: an absent date or URL cannot satisfy a restrictive filter. */
export function captureAdaptiveEvidence(
  rows: readonly ApprovedEvidenceRow[],
  plan: ProjectResearchPlan,
) {
  const claims = rows.flatMap((row) => {
    const claim = verifiedIntelligenceClaim(row);
    if (
      !claim ||
      !plan.knowledgeSourceTypes.includes(
        (
          {
            admin_provided: 'admin',
            clue_guided: 'clue_research',
            autonomous_research: 'autonomous_research',
          } as Record<string, ProjectResearchPlan['knowledgeSourceTypes'][number]>
        )[row.source_type]!,
      )
    )
      return [];
    if (plan.country && row.country?.toUpperCase() !== plan.country) return [];
    if (plan.timeRange.from || plan.timeRange.to) {
      if (
        !claim.publishedAt ||
        (plan.timeRange.from && claim.publishedAt < plan.timeRange.from) ||
        (plan.timeRange.to && claim.publishedAt > plan.timeRange.to)
      )
        return [];
    }
    if (plan.sourcePolicy.mode !== 'unrestricted') {
      if (!claim.finalUrl) {
        if (plan.sourcePolicy.mode === 'whitelist') return [];
      } else {
        const host = new URL(claim.finalUrl).hostname.toLowerCase();
        const matches = plan.sourcePolicy.domains.some(
          (domain) => host === domain || host.endsWith(`.${domain}`),
        );
        if (
          (plan.sourcePolicy.mode === 'whitelist' && !matches) ||
          (plan.sourcePolicy.mode === 'blacklist' && matches)
        )
          return [];
      }
    }
    return [claim];
  });
  const options = plan.adaptive ?? {
    questions: [{ id: 'main', text: plan.query, importance: 5 }],
    maxRounds: 5,
    maxClaimVisits: plan.targetCount,
    targetCoverage: 100,
    perQuestionLimit: plan.targetCount,
  };
  const report = runAdaptiveResearch(
    { ...options, maxClaimVisits: Math.min(options.maxClaimVisits, plan.targetCount) },
    claims,
  );
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const grouped = new Map<string, IntelligenceClaim[]>();
  for (const id of report.selectedClaimIds) {
    const claim = byId.get(id)!;
    const key = createHash('sha256').update(claim.text).digest('hex');
    const group = grouped.get(key) ?? [];
    group.push(claim);
    grouped.set(key, group);
  }
  const citationLimit = plan.depth === 'shallow' ? 1 : plan.depth === 'standard' ? 3 : 5;
  const manifest: ProjectResearchManifestItem[] = [...grouped.entries()].map(
    ([claimHash, group]) => {
      const first = group[0]!;
      const citations = group.slice(0, citationLimit).map((claim) => ({
        claimId: claim.id,
        knowledgeVersionId: claim.knowledgeVersionId,
        sourceVersionId: claim.sourceVersionId,
        sourceQuoteHash: claim.quoteHash,
        startOffset: claim.startOffset,
        endOffset: claim.endOffset,
      }));
      return {
        ...citations[0]!,
        claimHash,
        auditScore: first.auditScore,
        matchScore: 1,
        citations,
        additionalCitationCount: Math.max(0, group.length - citationLimit),
      };
    },
  );
  return {
    report: {
      ...report,
      languagePolicy: plan.sourceLanguages ?? [plan.language],
      candidateCount: claims.length,
      heuristic: true,
    },
    manifest,
  };
}
