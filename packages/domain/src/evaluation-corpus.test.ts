import { describe, expect, it } from 'vitest';
import { evaluationCorpusInvariantDescriptions, evaluationCorpusV1 } from './evaluation-corpus.js';
import { hashEvaluationDataset, readEvaluationDataset } from './paired-evaluation.js';

describe('versioned synthetic business evaluation corpus', () => {
  it('pins all 30 inputs with a fixed digest and balances both languages across six domains', () => {
    expect(readEvaluationDataset(evaluationCorpusV1)).toEqual(evaluationCorpusV1);
    expect(hashEvaluationDataset(evaluationCorpusV1)).toBe(
      '890e5af57321bd9f0832781a36364239af7ef68a2fc8dbd880e55847acf18351',
    );
    expect(evaluationCorpusV1.cases).toHaveLength(30);
    expect(evaluationCorpusV1.cases.filter((item) => item.language === 'fa')).toHaveLength(15);
    expect(evaluationCorpusV1.cases.filter((item) => item.language === 'en')).toHaveLength(15);
    for (const category of ['COST', 'CHURN', 'MARKET', 'OPS', 'SUPPLY', 'PRODUCT']) {
      const cases = evaluationCorpusV1.cases.filter((item) => item.id.startsWith(`${category}-`));
      expect(cases).toHaveLength(5);
      for (const invariant of [
        'no_unsupported_causality',
        'do_not_count_reprints_as_independent',
        'preserve_conflict_context',
        'preserve_units',
        'surface_missing_evidence',
      ])
        expect(cases.some((item) => item.expectedInvariantIds.includes(invariant))).toBe(true);
    }
    expect(
      evaluationCorpusV1.cases.every((item) =>
        item.expectedInvariantIds.every((id) =>
          Object.hasOwn(evaluationCorpusInvariantDescriptions, id),
        ),
      ),
    ).toBe(true);
  });

  it('rejects changed inputs under the published version and isolates validated copies', () => {
    const changed = structuredClone(evaluationCorpusV1);
    (changed.cases[0] as { input: string }).input += ' altered';
    expect(() => readEvaluationDataset(changed)).toThrow('DATASET_HASH_MISMATCH');
    expect(Object.isFrozen(evaluationCorpusV1.cases[0]?.expectedInvariantIds)).toBe(true);
    const copy = readEvaluationDataset(evaluationCorpusV1);
    (copy.cases[0] as { input: string }).input = 'edited copy';
    expect(hashEvaluationDataset(evaluationCorpusV1)).toBe(evaluationCorpusV1.contentHash);
  });
});
