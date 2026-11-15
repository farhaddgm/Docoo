/**
 * Scoring for a retrieval evaluation (QA-004). Pure: it takes what a retrieval returned for each
 * question and what the right answer was, and says how well the ranking did. It knows nothing of
 * the database, so the same numbers come out of any run that returns the same documents.
 *
 * A retrieval returns chunks, and several chunks can belong to one document; the ranking of a
 * question is the documents in the order their first chunk appeared.
 */

export interface EvalQuery {
  readonly id: string;
  readonly category: string;
  readonly language: string;
  readonly query: string;
  /** The documents that answer it; empty for a question the corpus cannot answer. */
  readonly relevant: readonly string[];
}

export interface EvalRun {
  readonly query: EvalQuery;
  /** Document ids in the order the retrieval returned them (repeats allowed). */
  readonly returned: readonly string[];
}

export interface QueryScore {
  readonly id: string;
  readonly category: string;
  /** 1 when any right document is in the first `k`. */
  readonly hit: number;
  /** The share of right documents found in the first `k`. */
  readonly recall: number;
  /** 1 / rank of the first right document, 0 when none was returned. */
  readonly reciprocalRank: number;
  readonly ndcg: number;
  /** The documents returned, once each, in order. */
  readonly ranking: readonly string[];
}

export const distinct = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Scores one question at cut-off `k`. Not meaningful for a question with no right document. */
export function scoreQuery(run: EvalRun, k: number): QueryScore {
  const ranking = distinct(run.returned);
  const right = new Set(run.query.relevant);
  const top = ranking.slice(0, k);
  const found = top.filter((id) => right.has(id));
  const firstRank = ranking.findIndex((id) => right.has(id));
  const gain = (list: readonly string[]) =>
    list.reduce((sum, id, index) => sum + (right.has(id) ? 1 / Math.log2(index + 2) : 0), 0);
  // The best possible order puts every right document first.
  const ideal = Array.from({ length: Math.min(k, right.size) }).reduce<number>(
    (sum, _, index) => sum + 1 / Math.log2(index + 2),
    0,
  );
  return {
    id: run.query.id,
    category: run.query.category,
    hit: found.length > 0 ? 1 : 0,
    recall: right.size === 0 ? 0 : found.length / right.size,
    reciprocalRank: firstRank < 0 ? 0 : 1 / (firstRank + 1),
    ndcg: ideal === 0 ? 0 : gain(top) / ideal,
    ranking,
  };
}

export interface Metrics {
  readonly queries: number;
  readonly hitAtK: number;
  readonly recallAtK: number;
  readonly mrr: number;
  readonly ndcgAtK: number;
}

export interface EvalSummary {
  readonly k: number;
  readonly overall: Metrics;
  readonly byCategory: Readonly<Record<string, Metrics>>;
  /** Questions the corpus cannot answer: how many still got results back, and how many on average. */
  readonly noAnswer: {
    readonly queries: number;
    readonly withResults: number;
    readonly averageReturned: number;
  };
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number): number => Math.round(value * 10_000) / 10_000;

function metricsOf(scores: readonly QueryScore[]): Metrics {
  return {
    queries: scores.length,
    hitAtK: round(mean(scores.map((score) => score.hit))),
    recallAtK: round(mean(scores.map((score) => score.recall))),
    mrr: round(mean(scores.map((score) => score.reciprocalRank))),
    ndcgAtK: round(mean(scores.map((score) => score.ndcg))),
  };
}

/** The numbers of a whole run. Questions without a right document only feed `noAnswer`. */
export function summarize(runs: readonly EvalRun[], k: number): EvalSummary {
  const answerable = runs.filter((run) => run.query.relevant.length > 0);
  const scores = answerable.map((run) => scoreQuery(run, k));
  const categories = [...new Set(scores.map((score) => score.category))].sort();
  const empty = runs.filter((run) => run.query.relevant.length === 0);
  return {
    k,
    overall: metricsOf(scores),
    byCategory: Object.fromEntries(
      categories.map((name) => [
        name,
        metricsOf(scores.filter((score) => score.category === name)),
      ]),
    ),
    noAnswer: {
      queries: empty.length,
      withResults: empty.filter((run) => run.returned.length > 0).length,
      averageReturned: round(mean(empty.map((run) => distinct(run.returned).length))),
    },
  };
}

export interface Regression {
  readonly where: string;
  readonly metric: keyof Omit<Metrics, 'queries'>;
  readonly baseline: number;
  readonly now: number;
}

const METRIC_KEYS = ['hitAtK', 'recallAtK', 'mrr', 'ndcgAtK'] as const;

/**
 * What got worse than the committed baseline by more than `tolerance`, overall and per category.
 * A category missing from the baseline is new and is not a regression.
 */
export function regressions(
  now: EvalSummary,
  baseline: Pick<EvalSummary, 'overall' | 'byCategory'>,
  tolerance: number,
): Regression[] {
  const found: Regression[] = [];
  const compare = (where: string, current: Metrics, before: Metrics | undefined) => {
    if (!before) return;
    for (const metric of METRIC_KEYS) {
      if (current[metric] < before[metric] - tolerance)
        found.push({ where, metric, baseline: before[metric], now: current[metric] });
    }
  };
  compare('overall', now.overall, baseline.overall);
  for (const [name, metrics] of Object.entries(now.byCategory))
    compare(name, metrics, baseline.byCategory[name]);
  return found;
}

/** A plain-text table of a summary, for a log or a pull request. */
export function formatSummary(summary: EvalSummary): string {
  const pad = (text: string, width: number) => text.padEnd(width);
  const row = (name: string, m: Metrics) =>
    `${pad(name, 18)}${pad(String(m.queries), 5)}${pad(m.hitAtK.toFixed(3), 8)}${pad(m.recallAtK.toFixed(3), 8)}${pad(m.mrr.toFixed(3), 8)}${m.ndcgAtK.toFixed(3)}`;
  return [
    `${pad('', 18)}${pad('n', 5)}${pad(`hit@${summary.k}`, 8)}${pad(`recall@${summary.k}`, 8)}${pad('MRR', 8)}nDCG@${summary.k}`,
    row('overall', summary.overall),
    ...Object.entries(summary.byCategory).map(([name, metrics]) => row(name, metrics)),
    `no-answer: ${summary.noAnswer.withResults}/${summary.noAnswer.queries} questions still returned results (${summary.noAnswer.averageReturned} on average)`,
  ].join('\n');
}
