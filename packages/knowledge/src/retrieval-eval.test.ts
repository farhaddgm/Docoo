import { describe, expect, it } from 'vitest';

import {
  formatSummary,
  regressions,
  scoreQuery,
  summarize,
  type EvalQuery,
  type EvalRun,
} from './retrieval-eval.js';

const query = (id: string, relevant: string[], category = 'exact'): EvalQuery => ({
  id,
  category,
  language: 'fa',
  query: id,
  relevant,
});
const run = (q: EvalQuery, returned: string[]): EvalRun => ({ query: q, returned });

describe('scoreQuery', () => {
  it('a right document first scores full marks', () => {
    const score = scoreQuery(run(query('a', ['d1']), ['d1', 'd2']), 5);
    expect(score).toMatchObject({ hit: 1, recall: 1, reciprocalRank: 1, ndcg: 1 });
  });

  it('counts a document once however many of its chunks came back', () => {
    const score = scoreQuery(run(query('a', ['d2']), ['d1', 'd1', 'd1', 'd2']), 5);
    expect(score.ranking).toEqual(['d1', 'd2']);
    expect(score.reciprocalRank).toBe(0.5);
  });

  it('a right document below the cut-off is a miss for hit and recall but still has a reciprocal rank', () => {
    const score = scoreQuery(run(query('a', ['d9']), ['d1', 'd2', 'd3', 'd9']), 3);
    expect(score).toMatchObject({ hit: 0, recall: 0, ndcg: 0 });
    expect(score.reciprocalRank).toBe(0.25);
  });

  it('finding one of two right documents is half the recall', () => {
    const score = scoreQuery(run(query('a', ['d1', 'd2']), ['d1', 'x']), 5);
    expect(score.recall).toBe(0.5);
    expect(score.ndcg).toBeCloseTo(1 / (1 + 1 / Math.log2(3)), 6);
  });

  it('returning nothing scores zero', () => {
    expect(scoreQuery(run(query('a', ['d1']), []), 5)).toMatchObject({
      hit: 0,
      recall: 0,
      reciprocalRank: 0,
      ndcg: 0,
    });
  });
});

describe('summarize', () => {
  const runs = [
    run(query('a', ['d1']), ['d1']),
    run(query('b', ['d2'], 'synonym'), ['x', 'd2']),
    run(query('c', ['d3'], 'synonym'), []),
    run(query('n1', [], 'no-answer'), ['d1', 'd2']),
    run(query('n2', [], 'no-answer'), []),
  ];

  it('averages per category and overall, leaving unanswerable questions out of the ranking numbers', () => {
    const summary = summarize(runs, 5);
    expect(summary.overall).toMatchObject({ queries: 3, hitAtK: 0.6667, mrr: 0.5 });
    expect(summary.byCategory['exact']).toMatchObject({ queries: 1, mrr: 1 });
    expect(summary.byCategory['synonym']).toMatchObject({ queries: 2, hitAtK: 0.5, mrr: 0.25 });
    expect(summary.byCategory['no-answer']).toBeUndefined();
  });

  it('reports how often a question with no answer still got results', () => {
    expect(summarize(runs, 5).noAnswer).toEqual({
      queries: 2,
      withResults: 1,
      averageReturned: 1,
    });
  });

  it('prints a table with every category', () => {
    const text = formatSummary(summarize(runs, 5));
    expect(text).toContain('overall');
    expect(text).toContain('synonym');
    expect(text).toContain('no-answer: 1/2');
  });
});

describe('regressions', () => {
  const base = summarize(
    [run(query('a', ['d1']), ['d1']), run(query('b', ['d2'], 's'), ['d2'])],
    5,
  );

  it('is empty when nothing got worse, and ignores a small drop inside the tolerance', () => {
    expect(regressions(base, base, 0)).toEqual([]);
    const slightly = {
      ...base,
      overall: { ...base.overall, mrr: base.overall.mrr - 0.01 },
    };
    expect(regressions(slightly, base, 0.02)).toEqual([]);
  });

  it('names the category and metric that dropped more than the tolerance', () => {
    const worse = summarize(
      [run(query('a', ['d1']), ['d1']), run(query('b', ['d2'], 's'), ['x'])],
      5,
    );
    const found = regressions(worse, base, 0.02);
    expect(found).toContainEqual({ where: 's', metric: 'hitAtK', baseline: 1, now: 0 });
    expect(found.some((item) => item.where === 'overall')).toBe(true);
  });

  it('does not count a category that is new as a regression', () => {
    const grown = summarize([run(query('c', ['d1'], 'brand-new'), ['x'])], 5);
    expect(regressions(grown, base, 0).filter((item) => item.where === 'brand-new')).toEqual([]);
  });
});
