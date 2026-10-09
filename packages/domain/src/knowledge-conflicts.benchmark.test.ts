import { expect, it } from 'vitest';
import { detectKnowledgeConflicts, type IntelligenceClaim } from './knowledge-intelligence.js';

const cases = [
  { a: 'Customer churn increased by 10%', b: 'Customer churn decreased by 10%', candidate: true },
  { a: 'Customer churn increased by 10%', b: 'Customer churn increased by 20%', candidate: true },
  { a: 'ریزش مشتری ۱۰% کاهش یافت', b: 'ریزش مشتری ۲۰% افزایش یافت', candidate: true },
  {
    a: 'Experimental customer churn decreased in small business',
    b: 'Survey customer churn increased in enterprise',
    candidate: true,
  },
  { a: 'Customer churn decreased by 10%', b: 'Customer churn decreased by 10%', candidate: false },
  {
    a: 'Customer churn decreased by 10%',
    b: 'Inventory delivery increased by 20%',
    candidate: false,
  },
  { a: 'بودجه آموزش افزایش یافت', b: 'امنیت داده کاهش یافت', candidate: false },
  { a: 'Product quality increased', b: 'Product quality increased', candidate: false },
] as const;
it('measures conflict-candidate precision and recall on pinned synthetic positive and negative pairs', () => {
  const claim = (id: string, text: string): IntelligenceClaim => ({
    id,
    text,
    language: 'en',
    knowledgeVersionId: id,
    sourceVersionId: id,
    title: id,
    quote: text,
    quoteHash: 'a'.repeat(64),
    startOffset: 0,
    endOffset: text.length,
    auditScore: 90,
    evidenceAdequacy: 90,
    freshness: 90,
    publishedAt: null,
    finalUrl: null,
    confidentiality: 'internal',
  });
  let truePositive = 0,
    falsePositive = 0,
    falseNegative = 0;
  for (const entry of cases) {
    const proposed =
      detectKnowledgeConflicts([claim('a', entry.a), claim('b', entry.b)]).length > 0;
    if (proposed && entry.candidate) truePositive++;
    if (proposed && !entry.candidate) falsePositive++;
    if (!proposed && entry.candidate) falseNegative++;
  }
  expect({ truePositive, falsePositive, falseNegative }).toEqual({
    truePositive: 4,
    falsePositive: 0,
    falseNegative: 0,
  });
  expect(truePositive / (truePositive + falsePositive)).toBe(1);
  expect(truePositive / (truePositive + falseNegative)).toBe(1);
});
