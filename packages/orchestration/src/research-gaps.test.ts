import { strictSchemaProblems } from '@docoo/providers';
import { describe, expect, it } from 'vitest';
import type { PromptResearchQuestion } from '@docoo/domain';

import {
  GAP_SCHEMA,
  gapPrompt,
  mergeGaps,
  missingHints,
  openQuestions,
  parseGaps,
  unanswerableOf,
  updateLedger,
  type GapLedgerEntry,
} from './research-gaps.js';

const q = (id: string, question = `question ${id}`): PromptResearchQuestion => ({
  id,
  question,
  why: 'why',
  channel: 'web',
});
const asked = [q('Q1'), q('Q2'), q('Q3')];

describe('parseGaps', () => {
  it('reads one verdict per asked question, in plan order, ignoring ids that were not asked', () => {
    const result = parseGaps(
      {
        questions: [
          { id: 'q3', covered: false, missing: 'a 2024 figure' },
          { id: 'Q1', covered: true, missing: '' },
          { id: 'Q9', covered: true, missing: '' },
        ],
      },
      asked,
    );
    expect(result).toEqual([
      { id: 'Q1', covered: true, missing: '' },
      { id: 'Q2', covered: false, missing: '' },
      { id: 'Q3', covered: false, missing: 'a 2024 figure' },
    ]);
  });

  it('treats a question as not covered when the verdict is unsure, repeated or absent', () => {
    const result = parseGaps(
      {
        questions: [
          { id: 'Q1', covered: true, missing: '' },
          { id: 'Q1', covered: false, missing: 'conflicting' },
          { id: 'Q2', covered: 'yes', missing: 5 },
        ],
      },
      asked,
    );
    expect(result.map((item) => item.covered)).toEqual([false, false, false]);
    expect(result[0]!.missing).toBe('conflicting');
  });

  it('survives a malformed answer by asking again about everything', () => {
    for (const bad of [
      null,
      'x',
      {},
      { questions: 'no' },
      { questions: [null, 3, { covered: true }] },
    ]) {
      expect(parseGaps(bad, asked).every((item) => !item.covered)).toBe(true);
    }
  });

  it('caps a long missing-text', () => {
    const result = parseGaps(
      { questions: [{ id: 'Q1', covered: false, missing: 'x'.repeat(900) }] },
      asked,
    );
    expect(result[0]!.missing.length).toBe(300);
  });
});

describe('openQuestions and missingHints', () => {
  it('keep exactly the questions that are not covered, and pass what each lacks', () => {
    const coverage = [
      { id: 'Q1', covered: true, missing: '' },
      { id: 'Q2', covered: false, missing: 'needs a regulator source' },
      { id: 'Q3', covered: false, missing: '' },
    ];
    const open = openQuestions(asked, coverage);
    expect(open.map((item) => item.id)).toEqual(['Q2', 'Q3']);
    expect(missingHints(open, coverage)).toEqual([
      { id: 'Q2', missing: 'needs a regulator source' },
      { id: 'Q3', missing: '' },
    ]);
  });

  it('leave nothing open when everything is covered', () => {
    const coverage = asked.map((item) => ({ id: item.id, covered: true, missing: '' }));
    expect(openQuestions(asked, coverage)).toEqual([]);
  });
});

describe('the ledger and unanswerable questions', () => {
  const round = (ids: string[], covered: boolean) =>
    ids.map((id) => ({ id, covered, missing: covered ? '' : 'still nothing' }));

  it('counts the rounds that searched for a question and calls it unanswerable after two', () => {
    let ledger: GapLedgerEntry[] = [];
    ledger = updateLedger(ledger, [...round(['Q1'], true), ...round(['Q2', 'Q3'], false)]);
    expect(unanswerableOf(ledger)).toEqual([]);
    // Round 2 searched only the open ones; Q3 is covered now, Q2 is not.
    ledger = updateLedger(ledger, [...round(['Q3'], true), ...round(['Q2'], false)]);
    expect(ledger.find((entry) => entry.id === 'Q1')).toMatchObject({ rounds: 1, covered: true });
    expect(ledger.find((entry) => entry.id === 'Q2')).toMatchObject({ rounds: 2, covered: false });
    expect(unanswerableOf(ledger).map((entry) => entry.id)).toEqual(['Q2']);
  });

  it('never calls a covered question unanswerable, even after many rounds', () => {
    let ledger: GapLedgerEntry[] = [];
    for (let i = 0; i < 3; i += 1) ledger = updateLedger(ledger, round(['Q1'], i === 2));
    expect(unanswerableOf(ledger)).toEqual([]);
  });
});

describe('gapPrompt', () => {
  it('lists the questions, the notes and the pages, and tells the model to cover nothing vague', () => {
    const prompt = gapPrompt({
      language: 'en',
      questions: asked,
      notes: 'Q1: revenue 12M (2023)',
      pages: [{ title: 'T', url: 'https://example.test/a' }],
    });
    expect(prompt.instructions).toContain('covered false');
    expect(prompt.message).toContain('Q1: revenue 12M');
    expect(prompt.message).toContain('https://example.test/a');
    expect(prompt.message).toContain('question Q3');
  });
});

describe('mergeGaps (two search models)', () => {
  const entry = (id: string, rounds: number, covered: boolean, missing = ''): GapLedgerEntry => ({
    id,
    rounds,
    covered,
    missing,
  });

  it('counts a question covered when either model covered it, and keeps the larger round count', () => {
    const merged = mergeGaps(
      [entry('Q1', 2, false, 'no figure'), entry('Q2', 1, true)],
      [entry('Q1', 1, true), entry('Q3', 2, false, 'no regulator source')],
    );
    expect(merged.find((item) => item.id === 'Q1')).toMatchObject({
      covered: true,
      rounds: 2,
      missing: '',
      unanswerable: false,
    });
    expect(merged.find((item) => item.id === 'Q3')).toMatchObject({
      covered: false,
      missing: 'no regulator source',
      unanswerable: true,
    });
  });

  it('is still open, and unanswerable, only when neither model found an answer in two rounds', () => {
    const merged = mergeGaps([entry('Q1', 2, false, 'a')], [entry('Q1', 2, false, 'b')]);
    expect(merged[0]).toMatchObject({ covered: false, unanswerable: true, missing: 'a' });
    expect(mergeGaps([entry('Q1', 1, false)], [])[0]!.unanswerable).toBe(false);
  });
});

describe('provider schemas of the research loop', () => {
  it('the gap schema is accepted by strict structured outputs', () => {
    expect(strictSchemaProblems(GAP_SCHEMA as never)).toEqual([]);
  });
});
