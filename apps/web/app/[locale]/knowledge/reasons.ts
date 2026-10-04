/**
 * The rule-based Brain auditor writes its reasons as short English lines
 * (`packages/knowledge/src/brain.ts`) and stores them with the review. The screens show them in
 * the reader's language, so each known line is read back into its parts here. A line this does
 * not know (a future model-based auditor writes its own) is shown as it was written.
 */
export type Reason =
  | {
      kind: 'credibility';
      sourceType: string;
      complete: boolean;
      partial: boolean;
    }
  | { kind: 'relevance'; matched: number; terms: number }
  | { kind: 'evidence'; supported: number; total: number }
  | { kind: 'recency_ended' }
  | { kind: 'recency_age'; years: number }
  | { kind: 'recency_undated' }
  | { kind: 'bias'; count: number }
  | { kind: 'conflict'; count: number }
  | { kind: 'critical'; flag: string }
  | { kind: 'unknown'; raw: string };

const patterns: readonly [RegExp, (match: RegExpMatchArray) => Reason][] = [
  [
    /^credibility: (\w+) source, provenance (complete|incomplete)(, partial extraction)?$/u,
    (m) => ({
      kind: 'credibility',
      sourceType: m[1]!,
      complete: m[2] === 'complete',
      partial: m[3] !== undefined,
    }),
  ],
  [
    /^relevance: (\d+)\/(\d+) scope terms found$/u,
    (m) => ({ kind: 'relevance', matched: Number(m[1]), terms: Number(m[2]) }),
  ],
  [
    /^evidence: (\d+)\/(\d+) claims supported$/u,
    (m) => ({ kind: 'evidence', supported: Number(m[1]), total: Number(m[2]) }),
  ],
  [/^recency: validity has ended$/u, () => ({ kind: 'recency_ended' })],
  [
    /^recency: newest cited source (\d+(?:\.\d+)?) years old$/u,
    (m) => ({ kind: 'recency_age', years: Number(m[1]) }),
  ],
  [/^recency: no dated sources$/u, () => ({ kind: 'recency_undated' })],
  [
    /^bias: (\d+) absolute or promotional expressions$/u,
    (m) => ({ kind: 'bias', count: Number(m[1]) }),
  ],
  [/^conflict: (\d+) open conflicts$/u, (m) => ({ kind: 'conflict', count: Number(m[1]) })],
  [/^critical: (\w+)$/u, (m) => ({ kind: 'critical', flag: m[1]! })],
];

export function parseReason(raw: string): Reason {
  for (const [pattern, build] of patterns) {
    const match = pattern.exec(raw);
    if (match) return build(match);
  }
  return { kind: 'unknown', raw };
}

/** What the auditor wrote about one claim, as a key for the message table. */
export function claimReasonKey(
  reason: string,
): 'complete_citation' | 'admin_provenance' | 'citation_incomplete' | 'no_citation' | null {
  switch (reason) {
    case 'complete citation':
      return 'complete_citation';
    case 'direct administrator provenance':
      return 'admin_provenance';
    case 'citation incomplete':
      return 'citation_incomplete';
    case 'no citation':
      return 'no_citation';
    default:
      return null;
  }
}

export type ConflictAnalysis =
  | { kind: 'numeric'; similarity: number; first: string; second: string }
  | { kind: 'negation'; similarity: number }
  | { kind: 'unknown'; raw: string };

/** The conflict detector's English analysis, read back into its parts. */
export function parseConflictAnalysis(raw: string): ConflictAnalysis {
  const numeric =
    /^Same subject \(similarity (\d+(?:\.\d+)?)\) with different figures: (.+) vs (.+)\.$/u.exec(
      raw,
    );
  if (numeric) {
    return {
      kind: 'numeric',
      similarity: Number(numeric[1]),
      first: numeric[2]!,
      second: numeric[3]!,
    };
  }
  const negation =
    /^Same subject \(similarity (\d+(?:\.\d+)?)\) where only one claim is negated\.$/u.exec(raw);
  if (negation) return { kind: 'negation', similarity: Number(negation[1]) };
  return { kind: 'unknown', raw };
}
