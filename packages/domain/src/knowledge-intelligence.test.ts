import { describe, expect, it } from 'vitest';
import {
  assessEvidence,
  cosineSimilarity,
  detectKnowledgeConflicts,
  localKnowledgeEmbedding,
  normalizeKnowledgeText,
  rankKnowledgeClaims,
  runAdaptiveResearch,
  type IntelligenceClaim,
} from './knowledge-intelligence.js';
import { prioritizeAnalysisQuestions } from './question-priority.js';

const claim = (
  id: string,
  text: string,
  extra: Partial<IntelligenceClaim> = {},
): IntelligenceClaim => ({
  id,
  text,
  language: 'en',
  knowledgeVersionId: `kv-${id}`,
  sourceVersionId: `sv-${id}`,
  title: id,
  quote: text,
  quoteHash: 'a'.repeat(64),
  startOffset: 0,
  endOffset: text.length,
  auditScore: 90,
  evidenceAdequacy: 90,
  freshness: 80,
  publishedAt: '2026-09-01',
  finalUrl: null,
  confidentiality: 'internal',
  ...extra,
});
describe('decision intelligence', () => {
  it('normalizes Persian Arabic characters, digits and spacing without inventing translation', () => {
    expect(normalizeKnowledgeText('كاهشِ ريزش ۳۰٪ می‌شود')).toBe('کاهش ریزش 30% می شود');
    expect(
      cosineSimilarity(
        localKnowledgeEmbedding('ریزش مشتری'),
        localKnowledgeEmbedding('customer churn'),
      ),
    ).toBeGreaterThan(0.8);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow('EMBEDDING_INVALID');
  });
  it('retrieves across languages and excludes unrelated hash collisions', () => {
    const claims = [
      claim('a', 'Customer churn decreased after onboarding.'),
      claim('b', 'Inventory shipping delay increased.'),
      claim('c', 'A completely unrelated observation'),
    ];
    expect(
      rankKnowledgeClaims({ query: 'ریزش مشتری', claims, limit: 10 }).map((r) => r.claim.id),
    ).toEqual(['a']);
    expect(
      rankKnowledgeClaims({ query: 'ریزش مشتری', claims, limit: 10, mode: 'lexical' }),
    ).toEqual([]);
  });
  it('makes date, population and method differences reviewable; never selects a winner', () => {
    const a = claim('a', 'Experimental customer churn decreased by 10% in small business.');
    const b = claim('b', 'Survey customer churn increased by 20% in enterprise.', {
      publishedAt: '2025-01-01',
    });
    expect(detectKnowledgeConflicts([a, b])).toEqual([
      expect.objectContaining({
        kind: 'scope',
        differences: ['date', 'population', 'method', 'quantity'],
        reviewRequired: true,
      }),
    ]);
    expect(detectKnowledgeConflicts([a, claim('b', a.text)])).toEqual([]);
    expect(detectKnowledgeConflicts([a, claim('b', 'Inventory cost increased by 20%')])).toEqual(
      [],
    );
  });
  it('does not treat 130% as support for 30%, or count source versions as independent studies', () => {
    const a = claim('a', 'Customer retention increased by 130%.');
    expect(
      assessEvidence({
        assertion: 'Customer retention increased by 30%',
        supports: [a],
        applicabilityReviewed: true,
      }),
    ).toMatchObject({
      status: 'insufficient',
      coverage: 0,
      independence: 'unknown',
      probabilityOfTruth: null,
    });
    expect(
      assessEvidence({ assertion: a.text, supports: [a], applicabilityReviewed: true }),
    ).toMatchObject({ status: 'supported_with_limits', coverage: 100, sourceCount: 1 });
    expect(assessEvidence({ assertion: a.text, supports: [a] }).status).toBe('insufficient');
    expect(
      assessEvidence({
        assertion: a.text,
        supports: [a],
        opposes: [claim('b', 'Customer retention decreased')],
        applicabilityReviewed: true,
      }).status,
    ).toBe('conflicted');
  });
  it('does not starve remaining questions and respects round and visit budgets', () => {
    const plan = {
      questions: [
        { id: 'missing', text: 'Security privacy evidence', importance: 5 },
        { id: 'found', text: 'Customer churn', importance: 3 },
      ],
      maxRounds: 10,
      maxClaimVisits: 4,
      targetCoverage: 100,
      perQuestionLimit: 2,
    };
    const result = runAdaptiveResearch(plan, [claim('a', 'Customer churn decreased')]);
    expect(result.rounds.map((r) => r.questionId)).toEqual(['missing', 'found']);
    expect(result).toMatchObject({
      stopReason: 'no_new_evidence',
      coverage: 38,
      status: 'insufficient_evidence',
      externalCost: 0,
    });
    expect(runAdaptiveResearch({ ...plan, maxRounds: 1 }, []).rounds).toHaveLength(1);
    expect(
      runAdaptiveResearch({ ...plan, maxClaimVisits: 1 }, [claim('a', 'Customer churn decreased')])
        .claimVisits,
    ).toBeLessThanOrEqual(1);
  });
  it('reprioritizes answered questions and explains criterion matches without changing IDs or count', () => {
    const questions = [
      { id: 'a', ordinal: 1, coverageArea: 'context', text: 'Customer retention', answer: null },
      { id: 'b', ordinal: 2, coverageArea: 'budget', text: 'What is the budget?', answer: null },
    ];
    const before = prioritizeAnalysisQuestions(questions, ['ریزش مشتری']);
    expect(before.find((q) => q.id === 'a')?.priority.criterionMatched).toBe(true);
    const after = prioritizeAnalysisQuestions(
      questions.map((q) =>
        q.id === 'b' ? { ...q, answer: { status: 'answered', text: '100' } } : q,
      ),
    );
    expect(after.map((q) => q.id)).toEqual(['a', 'b']);
    expect(after[1]?.priority.score).toBe(0);
    expect(after).toHaveLength(questions.length);
    const referenced = prioritizeAnalysisQuestions(
      questions,
      [],
      [{ id: 'analysis:version1:assumption0', kind: 'assumption', text: 'ریزش مشتری' }],
    );
    expect(referenced.find((q) => q.id === 'a')?.priority.references).toEqual([
      { id: 'analysis:version1:assumption0', kind: 'assumption', text: 'ریزش مشتری' },
    ]);
  });
});
