import { composeMemory, memoryEligibility, memoryProvenance } from '@docoo/contracts';
import { assessCitation, auditWithRules } from '@docoo/knowledge';
import { describe, expect, it } from 'vitest';

/**
 * A finding kept as knowledge (ADR-0053) must be something the knowledge audit can accept: the
 * machine-research rules want a query and an access time in the provenance and a complete citation on
 * every claim. Run through the real rule-based auditor, so a change to either side shows here.
 */
const ACCESSED = '2026-11-02T10:00:00.000Z';

function auditOf(finding: Record<string, unknown>) {
  const eligibility = memoryEligibility(finding, 2026);
  if (!eligibility.ok) throw new Error(`not eligible: ${eligibility.reason}`);
  const draft = composeMemory(finding, eligibility.pages, 'en', { accessedAt: ACCESSED });
  const provenance = memoryProvenance({
    queries: ['market size units'],
    claim: draft.claim.text,
    accessedAt: ACCESSED,
    projectId: 'p',
    stageRunId: 's',
    outputId: 'o',
    fingerprint: 'f'.repeat(64),
    publishedAtIsAsOfYear: draft.publishedAtIsAsOfYear,
  });
  return auditWithRules({
    sourceType: 'autonomous_research',
    content: draft.content,
    provenance,
    sourceScan: null,
    sourcePartial: false,
    claims: [
      {
        id: 'c1',
        text: draft.claim.text,
        kind: draft.claim.kind,
        citations: draft.claim.citations.map((citation) => ({
          complete: assessCitation(citation).complete,
          publishedAt: citation.publishedAt ?? null,
        })),
      },
    ],
    scopeTerms: [],
    validUntil: eligibility.validUntil,
    openConflicts: 0,
    now: new Date(ACCESSED),
  });
}

const finding = (over: Record<string, unknown> = {}) => ({
  claim: 'The market reached 12,500 units',
  level: 'solid',
  support: 'web',
  asOf: '2025',
  evidence: [
    {
      ref: 'W1',
      url: 'https://www.stats.example.org/market',
      title: 'Market statistics',
      quote: 'The market reached 12500 units.',
      verified: true,
    },
  ],
  ...over,
});

describe('a kept research finding and the knowledge audit', () => {
  it('has the provenance and the complete citation the auditor requires, so it is not flagged critical', () => {
    const result = auditOf(finding());
    expect(result.criticalFlags).toEqual([]);
    expect(result.claimResults.every((claim) => claim.supported)).toBe(true);
  });

  it('is flagged for a human when the year is unknown, because its citation has no date', () => {
    const result = auditOf(finding({ asOf: '' }));
    expect(result.criticalFlags).toContain('uncited_research_claim');
  });
});
