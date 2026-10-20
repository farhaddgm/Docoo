import { expect, it } from 'vitest';
import type { EvaluationBlindReviewPack } from '@docoo/contracts';
import { buildEvaluationReview, type EvaluationRatingDraft } from './evaluation-lab-form';

const pack: EvaluationBlindReviewPack = {
  experimentId: 'experiment-01',
  experimentHash: 'a'.repeat(64),
  rubricHash: 'b'.repeat(64),
  rubric: 'Review evidence.',
  cases: ['fa', 'en'].map((language, index) => ({
    caseId: `case-${index}`,
    language: language as 'fa' | 'en',
    input: 'Synthetic input',
    expectedInvariantIds: ['preserve_units'],
    variants: (['A', 'B'] as const).map((label, side) => ({
      itemId: String(index * 2 + side + 1).repeat(64),
      label,
      output: 'Output',
      outputHash: 'c'.repeat(64),
    })) as EvaluationBlindReviewPack['cases'][number]['variants'],
  })),
};
const time = '2026-10-16T12:00:00Z';
const drafts = Object.fromEntries(
  pack.cases.flatMap((item) =>
    item.variants.map((variant) => [
      variant.itemId,
      {
        score: '۸۰٫۵',
        citationErrors: '٠',
        accepted: 'unassessed',
      } satisfies EvaluationRatingDraft,
    ]),
  ),
) as Record<string, EvaluationRatingDraft>;
it('preserves Persian and Arabic numbers and unassessed acceptance without fabricating a judge label', () => {
  const result = buildEvaluationReview(pack, drafts, time);
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.input.ratings[0]).toMatchObject({
      humanScore: 80.5,
      citationErrors: 0,
      humanAccepted: null,
    });
    expect(result.input.ratings[0]).not.toHaveProperty('judgeAccepted');
  }
});
it('rejects blank or invalid fields instead of silently turning them into zero or rejection', () => {
  const first = pack.cases[0]!.variants[0].itemId;
  for (const [field, value] of [
    ['score', ''],
    ['score', '101'],
    ['citationErrors', ''],
    ['citationErrors', '1.5'],
    ['accepted', ''],
  ] as const) {
    expect(
      buildEvaluationReview(
        pack,
        { ...drafts, [first]: { ...drafts[first]!, [field]: value } },
        time,
      ),
    ).toMatchObject({ ok: false, caseIndex: 0, itemId: first, field });
  }
  const last = pack.cases[1]!.variants[1].itemId;
  expect(
    buildEvaluationReview(pack, { ...drafts, [last]: { ...drafts[last]!, score: '' } }, time),
  ).toMatchObject({ ok: false, caseIndex: 1, itemId: last });
});
