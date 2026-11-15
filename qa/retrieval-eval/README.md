# Retrieval evaluation (QA-004)

A small Persian and English corpus with questions whose right answer is known, run through the real
path (create knowledge, Brain audit, `POST /knowledge/retrieve`). It tells you whether a change to
retrieval made the ranking better or worse, with numbers instead of a feeling.

## What is in `v0/`

- `corpus.json`: 28 synthetic documents of a fictional company (no real person, company or
  figure) — 24 short ones and 4 longer ones with `##` sections — and 78 questions. Each question lists the document ids that answer it; a question with an
  empty list is one the corpus cannot answer.
- `baseline.json`: the numbers of the last accepted run. A run that does worse than this by more than
  0.02 on any metric, overall or in a category, fails.

Categories, from easy to hard: `exact` (the words are in the document), `orthography` (Arabic
letters, ZWNJ, Persian digits), `morphology`, `typo`, `confusable` (two documents on a near topic),
`synonym`, `natural-question`, `paraphrase` (no word in common), `section-context` (the answer is in a
section of a long document whose text does not repeat the topic, which only the title and the heading
say), `cross-lingual` (Persian question, English document and the reverse), `no-answer`.

Metrics, at the first 5 documents: hit (any right document), recall, MRR (1 / rank of the first
right one) and nDCG. Several chunks of one document count as one document. For `no-answer` the
report only says how many questions still got results back.

## Run it

It needs PostgreSQL 18 like the other integration tests:

```bash
DATABASE_TEST_ADMIN_URL=postgresql://docoo_admin:...@localhost:5432/docoo_ci \
  pnpm --filter @docoo/api exec vitest run test/retrieval-eval.integration.test.ts
```

- `RETRIEVAL_EVAL_REPORT=/path/report.json` writes what every question returned, with the score, the similarity and the ranks of each result, to see what failed.
- `RETRIEVAL_EVAL_WRITE_BASELINE=1` raises the baseline. Do it only when the numbers are better
  and you mean it: the diff of `baseline.json` is what the reviewer reads.

## Limits

The corpus is small (28 documents), so one question moves a category by several points; read the
list of misses, not only the averages. The documents are synthetic and short; real documents are
longer and noisier, so absolute numbers say little and changes between two runs say more. Add
questions when you meet a real failure, and never delete one to make a number rise.
