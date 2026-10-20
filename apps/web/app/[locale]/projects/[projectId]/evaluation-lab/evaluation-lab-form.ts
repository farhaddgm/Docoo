import {
  evaluationBlindReviewInputSchema,
  type EvaluationBlindReviewInput,
  type EvaluationBlindReviewPack,
} from '@docoo/contracts';

export interface EvaluationRatingDraft {
  score: string;
  citationErrors: string;
  accepted: '' | 'yes' | 'no' | 'unassessed';
}

function decimal(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/٫/g, '.');
  return /^\d+(?:\.\d+)?$/.test(normalized) && Number.isFinite(Number(normalized))
    ? Number(normalized)
    : null;
}

export function buildEvaluationReview(
  pack: EvaluationBlindReviewPack,
  drafts: Readonly<Record<string, EvaluationRatingDraft>>,
  reviewedAt: string,
):
  | { ok: true; input: EvaluationBlindReviewInput }
  | {
      ok: false;
      caseIndex: number;
      itemId: string;
      field: 'score' | 'citationErrors' | 'accepted';
    } {
  const ratings: EvaluationBlindReviewInput['ratings'] = [];
  for (const [caseIndex, testCase] of pack.cases.entries()) {
    for (const variant of testCase.variants) {
      const draft = drafts[variant.itemId];
      const score = decimal(draft?.score ?? '');
      if (score === null || score > 100)
        return { ok: false, caseIndex, itemId: variant.itemId, field: 'score' };
      const errors = decimal(draft?.citationErrors ?? '');
      if (errors === null || !Number.isSafeInteger(errors))
        return { ok: false, caseIndex, itemId: variant.itemId, field: 'citationErrors' };
      if (!draft || !['yes', 'no', 'unassessed'].includes(draft.accepted))
        return { ok: false, caseIndex, itemId: variant.itemId, field: 'accepted' };
      ratings.push({
        itemId: variant.itemId,
        outputHash: variant.outputHash,
        humanScore: score,
        humanAccepted: draft.accepted === 'unassessed' ? null : draft.accepted === 'yes',
        citationErrors: errors,
      });
    }
  }
  return {
    ok: true,
    input: evaluationBlindReviewInputSchema.parse({
      experimentHash: pack.experimentHash,
      rubricHash: pack.rubricHash,
      reviewedAt,
      ratings,
    }),
  };
}
