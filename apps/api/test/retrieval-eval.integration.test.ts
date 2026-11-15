import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  formatSummary,
  regressions,
  summarize,
  type EvalQuery,
  type EvalRun,
  type EvalSummary,
} from '@docoo/knowledge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

/**
 * The retrieval evaluation (QA-004): the Persian corpus of `qa/retrieval-eval/v0` goes through the
 * real path (create, Brain audit, retrieve) and the ranking is scored against the right answers.
 * A drop below the committed baseline fails the run; an improvement is shown, and the baseline is
 * raised on purpose with `RETRIEVAL_EVAL_WRITE_BASELINE=1` (the diff of the file is the review).
 */

const corpusPath = fileURLToPath(
  new URL('../../../qa/retrieval-eval/v0/corpus.json', import.meta.url),
);
const baselinePath = fileURLToPath(
  new URL('../../../qa/retrieval-eval/v0/baseline.json', import.meta.url),
);
const K = 5;
const TOLERANCE = 0.02;

interface Corpus {
  documents: { id: string; language: 'fa' | 'en'; title: string; content: string }[];
  queries: EvalQuery[];
}

let h: Harness;
let cookie: string;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;

describe.skipIf(!adminUrl)('retrieval evaluation on the Persian corpus (QA-004)', () => {
  const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as Corpus;
  const docOf = new Map<string, string>();
  let summary: EvalSummary;

  beforeAll(async () => {
    h = await createHarness('retrievaleval');
    cookie = await h.login(h.emails.a);
    for (const document of corpus.documents) {
      const created = await h.request('POST', api('/knowledge'), {
        cookie,
        payload: {
          title: document.title,
          language: document.language,
          content: document.content,
          sourceType: 'admin_provided',
          provenance: { declaration: 'Synthetic evaluation document, written for the corpus' },
          scopes: [{ type: 'workspace', id: h.ids.workspaceA }],
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json<{ knowledge: { id: string } }>().knowledge.id;
      docOf.set(id, document.id);
      const audited = await h.request('POST', api(`/knowledge/${id}/submit-audit`), { cookie });
      expect(audited.statusCode, audited.body).toBe(200);
      // Every document must be retrievable, or the evaluation measures the audit, not the ranking.
      expect(
        audited.json<{ knowledge: { currentVersion: { status: string } } }>().knowledge
          .currentVersion.status,
        document.id,
      ).toBe('approved');
    }
    const runs: EvalRun[] = [];
    for (const query of corpus.queries) {
      const response = await h.request('POST', api('/knowledge/retrieve'), {
        cookie,
        payload: { query: query.query, limit: 10 },
      });
      expect(response.statusCode, response.body).toBe(200);
      const results = response.json<{ results: { knowledgeId: string }[] }>().results;
      runs.push({ query, returned: results.map((item) => docOf.get(item.knowledgeId) ?? '?') });
    }
    summary = summarize(runs, K);
    // A full per-question report, for a person to read when a number moves.
    const reportPath = process.env['RETRIEVAL_EVAL_REPORT'];
    if (reportPath) {
      writeFileSync(
        reportPath,
        `${JSON.stringify(
          runs.map((run) => ({
            id: run.query.id,
            category: run.query.category,
            query: run.query.query,
            relevant: run.query.relevant,
            returned: [...new Set(run.returned)],
          })),
          null,
          2,
        )}\n`,
      );
    }
    // The misses are listed so a run says what to look at, not only that a number moved.
    const misses = runs
      .filter((run) => run.query.relevant.length > 0)
      .filter((run) => !run.returned.slice(0, 25).some((id) => run.query.relevant.includes(id)))
      .map((run) => `${run.query.id} [${run.query.category}] ${run.query.query}`);
    console.log(
      `\n${formatSummary(summary)}\n\nNot found at all (${misses.length}):\n${misses.join('\n')}`,
    );
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('every document was ingested, audited and approved', () => {
    expect(docOf.size).toBe(corpus.documents.length);
  });

  it('ranks no worse than the committed baseline', () => {
    if (process.env['RETRIEVAL_EVAL_WRITE_BASELINE'] === '1') {
      writeFileSync(baselinePath, `${JSON.stringify({ corpus: 'v0', ...summary }, null, 2)}\n`);
      return;
    }
    expect(
      existsSync(baselinePath),
      'baseline.json is missing; run once with RETRIEVAL_EVAL_WRITE_BASELINE=1',
    ).toBe(true);
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalSummary;
    expect(regressions(summary, baseline, TOLERANCE)).toEqual([]);
  });
});
