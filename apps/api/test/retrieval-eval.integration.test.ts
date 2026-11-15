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
import { openAiSemanticSearch } from '@docoo/orchestration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SEMANTIC_SEARCH } from '../src/knowledge/semantic-search.service.js';
import { adminUrl, createHarness, type Harness } from './support/harness.js';

/**
 * The retrieval evaluation (QA-004): the Persian corpus of `qa/retrieval-eval/v0` goes through the
 * real path (create, Brain audit, retrieve) and the ranking is scored against the right answers.
 *
 * - The first part needs no key. A drop below `baseline.json` fails the run; an improvement is
 *   shown, and the baseline is raised on purpose with `RETRIEVAL_EVAL_WRITE_BASELINE=1` (the diff of
 *   the file is the review).
 * - The second part runs only with `RETRIEVAL_EVAL_OPENAI_API_KEY` (and optionally
 *   `RETRIEVAL_EVAL_EMBEDDING_MODEL`, default text-embedding-3-small). It repeats the run with the
 *   provider's embeddings (ADR-0061) and must not rank worse than the first part: the semantic
 *   search stays only if the numbers are better.
 */

const dir = new URL('../../../qa/retrieval-eval/v0/', import.meta.url);
const corpusPath = fileURLToPath(new URL('corpus.json', dir));
const baselinePath = fileURLToPath(new URL('baseline.json', dir));
const semanticBaselinePath = fileURLToPath(new URL('baseline-semantic.json', dir));
const K = 5;
const TOLERANCE = 0.02;

interface Corpus {
  documents: { id: string; language: 'fa' | 'en'; title: string; content: string }[];
  queries: EvalQuery[];
}

const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as Corpus;

interface ResultRow {
  knowledgeId: string;
  score: number;
  similarity: number | null;
  lexicalRank: number | null;
  vectorRank: number | null;
}
/** The scores behind each question's results, in question order, for the report. */
const detail: {
  doc: string;
  score: number;
  similarity: number | null;
  lexicalRank: number | null;
  vectorRank: number | null;
}[][] = [];

/** Puts the corpus through create and audit, optionally embeds it, runs every question, scores. */
async function evaluate(
  h: Harness,
  options: { embed: boolean },
): Promise<{ summary: EvalSummary; runs: EvalRun[] }> {
  const cookie = await h.login(h.emails.a);
  const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;
  const docOf = new Map<string, string>();
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
      audited.json<{ knowledge: { currentVersion: { status: string } } }>().knowledge.currentVersion
        .status,
      document.id,
    ).toBe('approved');
  }
  if (options.embed) {
    for (let pass = 0; pass < 20; pass += 1) {
      const run = await h.request('POST', api('/knowledge/semantic-index/run'), {
        cookie,
        payload: { limit: 1000 },
      });
      expect(run.statusCode, run.body).toBe(200);
      const result = run.json<{ enabled: boolean; asked?: number; failedBatches?: number }>();
      expect(result.enabled, 'semantic search must be on for this part').toBe(true);
      expect(result.failedBatches, 'the provider failed while indexing').toBe(0);
      if (result.asked === 0) break;
    }
    const status = (await h.request('GET', api('/knowledge/semantic-index'), { cookie })).json<{
      eligible: number;
      embedded: number;
    }>();
    expect(status.embedded).toBe(status.eligible);
  }
  const runs: EvalRun[] = [];
  detail.length = 0;
  for (const query of corpus.queries) {
    const response = await h.request('POST', api('/knowledge/retrieve'), {
      cookie,
      payload: { query: query.query, limit: 10 },
    });
    expect(response.statusCode, response.body).toBe(200);
    const results = response.json<{ results: ResultRow[] }>().results;
    runs.push({ query, returned: results.map((item) => docOf.get(item.knowledgeId) ?? '?') });
    detail.push(
      results.map((item) => ({
        doc: docOf.get(item.knowledgeId) ?? '?',
        score: item.score,
        similarity: item.similarity,
        lexicalRank: item.lexicalRank,
        vectorRank: item.vectorRank,
      })),
    );
  }
  return { summary: summarize(runs, K), runs };
}

/** A full per-question report, for a person to read when a number moves. */
function writeReport(runs: readonly EvalRun[], variable: string): void {
  const path = process.env[variable];
  if (!path) return;
  writeFileSync(
    path,
    `${JSON.stringify(
      runs.map((run) => ({
        id: run.query.id,
        category: run.query.category,
        query: run.query.query,
        relevant: run.query.relevant,
        returned: [...new Set(run.returned)],
        results: detail[runs.indexOf(run)],
      })),
      null,
      2,
    )}\n`,
  );
}

describe.skipIf(!adminUrl)('retrieval evaluation on the Persian corpus (QA-004)', () => {
  let h: Harness;
  let summary: EvalSummary;

  beforeAll(async () => {
    h = await createHarness('retrievaleval');
    const done = await evaluate(h, { embed: false });
    summary = done.summary;
    writeReport(done.runs, 'RETRIEVAL_EVAL_REPORT');
    console.log(`\n${formatSummary(summary)}\n`);
  }, 120_000);

  afterAll(async () => {
    await h?.close();
  });

  it('every question was answered by a retrieval of ingested, audited documents', () => {
    expect(summary.overall.queries + summary.noAnswer.queries).toBe(corpus.queries.length);
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

const providerKey = process.env['RETRIEVAL_EVAL_OPENAI_API_KEY'];

describe.skipIf(!adminUrl || !providerKey)(
  'retrieval evaluation with the provider embeddings (ADR-0061)',
  () => {
    const model = process.env['RETRIEVAL_EVAL_EMBEDDING_MODEL'] || 'text-embedding-3-small';
    let h: Harness;
    let summary: EvalSummary;

    beforeAll(async () => {
      h = await createHarness('retrievalsem', {
        overrides: [
          {
            provide: SEMANTIC_SEARCH,
            useValue: openAiSemanticSearch({ apiKey: providerKey!, model }),
          },
        ],
      });
      const done = await evaluate(h, { embed: true });
      summary = done.summary;
      writeReport(done.runs, 'RETRIEVAL_EVAL_SEMANTIC_REPORT');
      const hashOnly = JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalSummary;
      console.log(
        `\nSemantic (${model}) against the local embedding only\n\nlocal only:\n${formatSummary(hashOnly)}\n\nwith ${model}:\n${formatSummary(summary)}\n`,
      );
    }, 300_000);

    afterAll(async () => {
      await h?.close();
    });

    it('is not worse than the local embedding on any metric overall (it is kept only if better)', () => {
      const hashOnly = JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalSummary;
      expect(summary.overall.hitAtK).toBeGreaterThanOrEqual(hashOnly.overall.hitAtK);
      expect(summary.overall.mrr).toBeGreaterThanOrEqual(hashOnly.overall.mrr);
    });

    it('does not make a category the local embedding already answered worse', () => {
      const hashOnly = JSON.parse(readFileSync(baselinePath, 'utf8')) as EvalSummary;
      expect(regressions(summary, hashOnly, TOLERANCE)).toEqual([]);
    });

    it('records its numbers when asked to', () => {
      if (process.env['RETRIEVAL_EVAL_WRITE_BASELINE'] !== '1') return;
      writeFileSync(
        semanticBaselinePath,
        `${JSON.stringify({ corpus: 'v0', model, ...summary }, null, 2)}\n`,
      );
    });
  },
);
