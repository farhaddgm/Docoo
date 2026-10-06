import { describe, expect, it } from 'vitest';

import {
  knownSimilarPairs,
  normalizeQuestionQuality,
  QUALITY_CRITERIA,
  QUALITY_LIMITS,
  questionQualityPromptData,
  QUESTION_QUALITY_SCHEMA,
  resolveQualityCriteria,
  type QualityQuestion,
} from './question-quality.js';

const question = (number: number, text: string, status = 'answered'): QualityQuestion => ({
  ref: `Q${number}`,
  id: `id-${number}`,
  number,
  category: 'goals',
  text,
  status,
});

const questions = [
  question(1, 'What outcome would make this project a success for you?'),
  question(2, 'Which budget can you commit this year?'),
  question(3, 'Which budget can you commit this year, in total?'),
  question(4, 'Why have you not simply bought a CRM?'),
];
const all = [...QUALITY_CRITERIA];

describe('which criteria are asked about', () => {
  it('keeps the chosen known ones in a fixed order, and means all when nothing usable is chosen', () => {
    expect(resolveQualityCriteria(['tone', 'leading', 'nonsense'])).toEqual(['leading', 'tone']);
    expect(resolveQualityCriteria([])).toEqual(all);
    expect(resolveQualityCriteria(['nonsense'])).toEqual(all);
    expect(resolveQualityCriteria(undefined)).toEqual(all);
    expect(resolveQualityCriteria('tone')).toEqual(all);
  });
});

describe('the data handed to the judge', () => {
  it('numbers the questions, leaves answers out and hints at near-identical pairs', () => {
    const data = questionQualityPromptData({ criteria: all, questions });
    expect(data.questions.map((item) => item.ref)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(JSON.stringify(data)).not.toContain('id-1');
    expect(data.knownSimilar).toEqual([{ a: 'Q2', b: 'Q3', similarity: expect.any(Number) }]);
    expect(knownSimilarPairs([question(1, 'Totally different words here')])).toEqual([]);
  });

  it('cuts a very long question', () => {
    const long = question(1, 'x'.repeat(5000));
    const data = questionQualityPromptData({ criteria: all, questions: [long] });
    expect(data.questions[0]!.text.length).toBeLessThanOrEqual(QUALITY_LIMITS.questionChars);
  });

  it('describes its answer with a closed schema', () => {
    expect(QUESTION_QUALITY_SCHEMA['additionalProperties']).toBe(false);
  });
});

describe('what survives of the judge’s answer', () => {
  const good = {
    score: 4,
    summary: 'Mostly decision-relevant questions.',
    findings: [
      {
        kind: 'weakness',
        criterion: 'duplicate',
        severity: 'medium',
        detail: 'Q2 and Q3 ask the same thing.',
        recommendation: 'Drop one of them.',
        questionRefs: ['q2', 'Q3', 'Q3'],
      },
      {
        kind: 'strength',
        criterion: 'decision_relevance',
        severity: 'high',
        detail: 'Q1 asks for the success criterion.',
        recommendation: '',
        questionRefs: ['Q1'],
      },
    ],
  };

  it('keeps findings that name real questions, with the stored ids and de-duplicated refs', () => {
    const result = normalizeQuestionQuality(good, { criteria: all, questions });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality.score).toBe(4);
    expect(result.quality.discarded).toBe(0);
    expect(result.quality.findings[0]).toMatchObject({
      kind: 'weakness',
      criterion: 'duplicate',
      severity: 'medium',
      recommendation: 'Drop one of them.',
      questions: [
        { ref: 'Q2', id: 'id-2', number: 2 },
        { ref: 'Q3', id: 'id-3', number: 3 },
      ],
    });
    // A strength has no severity and an empty recommendation is none.
    expect(result.quality.findings[1]).toMatchObject({ severity: 'low', recommendation: null });
  });

  it('discards findings without evidence, with an unselected criterion, repeats or past the cap', () => {
    const noisy = {
      score: 3,
      summary: 'Mixed.',
      findings: [
        { ...good.findings[0], questionRefs: [] },
        { ...good.findings[0], questionRefs: ['Q99'] },
        { ...good.findings[0], criterion: 'tone' },
        { ...good.findings[0], criterion: 'invented' },
        { ...good.findings[0], kind: 'opinion' },
        { ...good.findings[0], detail: '  ' },
        good.findings[0],
        good.findings[0],
      ],
    };
    const result = normalizeQuestionQuality(noisy, {
      criteria: ['duplicate', 'vague'],
      questions,
    });
    expect(result.ok && result.quality.findings).toHaveLength(1);
    expect(result.ok && result.quality.discarded).toBe(7);

    const many = {
      score: 3,
      summary: 'Many.',
      findings: Array.from({ length: QUALITY_LIMITS.maxFindings + 3 }, (_, index) => ({
        ...good.findings[0],
        detail: `Finding ${index}`,
      })),
    };
    const capped = normalizeQuestionQuality(many, { criteria: all, questions });
    expect(capped.ok && capped.quality.findings).toHaveLength(QUALITY_LIMITS.maxFindings);
    expect(capped.ok && capped.quality.discarded).toBe(3);
  });

  it('refuses an answer that is not a usable verdict', () => {
    for (const bad of [
      null,
      'text',
      {},
      { score: 0, summary: 's', findings: [] },
      { score: 6, summary: 's', findings: [] },
      { score: 3.5, summary: 's', findings: [] },
      { score: 3, summary: '  ', findings: [] },
      { score: 3, summary: 's' },
    ]) {
      expect(
        normalizeQuestionQuality(bad, { criteria: all, questions }),
        JSON.stringify(bad),
      ).toEqual({
        ok: false,
        reason: 'invalid_output',
      });
    }
  });
});
