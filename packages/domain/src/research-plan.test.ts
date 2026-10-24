import { describe, expect, it } from 'vitest';

import {
  normalizeRequirementGaps,
  normalizeResearchQuestions,
  openFollowupQuestions,
  planExtends,
  questionRef,
  REQUIREMENT_GAP_SCHEMA,
  RESEARCH_PLAN_LIMITS,
  RESEARCH_PLAN_SCHEMA,
} from './research-plan.js';

describe('research plan questions', () => {
  it('keeps usable questions, collapses blanks and counts what it drops', () => {
    const { items, discarded } = normalizeResearchQuestions([
      { question: '  What   drives   early churn? ', why: ' to decide ', channel: 'web' },
      { question: 'what drives early churn?', channel: 'both' },
      { question: 'abc', channel: 'both' },
      { question: 'Which laws apply?', channel: 'telepathy' },
      'text',
      null,
    ]);
    expect(items).toEqual([
      { question: 'What drives early churn?', why: 'to decide', channel: 'web' },
      { question: 'Which laws apply?', why: '', channel: 'both' },
    ]);
    expect(discarded).toBe(4);
  });

  it('stops at the limit of questions', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      question: `Question number ${index}`,
      channel: 'knowledge',
    }));
    const { items, discarded } = normalizeResearchQuestions(many);
    expect(items).toHaveLength(RESEARCH_PLAN_LIMITS.maxQuestions);
    expect(discarded).toBe(8);
  });

  it('treats anything but a list as an empty plan', () => {
    expect(normalizeResearchQuestions(undefined)).toEqual({ items: [], discarded: 0 });
    expect(normalizeResearchQuestions('x')).toEqual({ items: [], discarded: 0 });
  });

  it('names a question by its position', () => {
    expect(questionRef(1)).toBe('Q1');
    expect(questionRef(12)).toBe('Q12');
  });

  it('asks the model for every key of a question', () => {
    const item = (
      RESEARCH_PLAN_SCHEMA['properties'] as Record<string, { items: { required: string[] } }>
    )['questions']!.items;
    expect(item.required).toEqual(['question', 'why', 'channel']);
  });
});

describe('follow-up rounds and requirement gaps (ADR-0039)', () => {
  const asked = (texts: string[]) =>
    texts.map((question, index) => ({
      id: `Q${index + 1}`,
      question,
      why: '',
      channel: 'both' as const,
    }));

  it('sees a plan that only adds questions as an extension', () => {
    expect(
      planExtends([{ question: 'A  question' }], [{ question: 'a question' }, { question: 'B' }]),
    ).toBe(true);
    expect(
      planExtends([{ question: 'A' }, { question: 'B' }], [{ question: 'B' }, { question: 'A' }]),
    ).toBe(false);
    expect(planExtends([{ question: 'A' }, { question: 'B' }], [{ question: 'A' }])).toBe(false);
  });

  it('opens the weak and unanswered questions and the ones added later', () => {
    const output = [
      { id: 'Q1', question: 'one one', status: 'answered' },
      { id: 'Q2', question: 'two two', status: 'weak' },
      { id: 'Q3', question: 'three', status: 'unanswered' },
    ];
    const current = asked(['one one', 'two two', 'three', 'four four']);
    expect(openFollowupQuestions(output, current).map((item) => item.id)).toEqual([
      'Q2',
      'Q3',
      'Q4',
    ]);
    // A reordered plan means the ids no longer match: nothing can be followed up.
    expect(openFollowupQuestions(output, asked(['two two', 'one one', 'three']))).toEqual([]);
  });

  it('gives exactly one result per requirement and keeps a suggestion only where one is needed', () => {
    const { results, discarded } = normalizeRequirementGaps(
      [
        {
          requirementId: 'a',
          verdict: 'supported',
          evidence: ' ok ',
          question: 'ignored question',
          why: '',
          channel: 'web',
        },
        {
          requirementId: 'b',
          verdict: 'missing',
          evidence: 'none',
          question: ' What do rivals charge? ',
          why: 'price',
          channel: 'web',
        },
        {
          requirementId: 'b',
          verdict: 'partial',
          evidence: 'dup',
          question: '',
          why: '',
          channel: 'web',
        },
        {
          requirementId: 'zzz',
          verdict: 'missing',
          evidence: '',
          question: 'Unknown requirement?',
          why: '',
          channel: 'web',
        },
        {
          requirementId: 'c',
          verdict: 'maybe',
          evidence: '',
          question: '',
          why: '',
          channel: 'web',
        },
      ],
      ['a', 'b', 'c', 'd'],
    );
    expect(discarded).toBe(3);
    expect(results.map((item) => [item.requirementId, item.verdict])).toEqual([
      ['a', 'supported'],
      ['b', 'missing'],
      ['c', 'unchecked'],
      ['d', 'unchecked'],
    ]);
    expect(results[0]).toMatchObject({ evidence: 'ok', suggestion: null });
    expect(results[1]?.suggestion).toEqual({
      question: 'What do rivals charge?',
      why: 'price',
      channel: 'web',
    });
  });

  it('drops a suggestion that is not a usable question', () => {
    const { results } = normalizeRequirementGaps(
      [
        {
          requirementId: 'a',
          verdict: 'missing',
          evidence: '',
          question: 'no',
          why: '',
          channel: 'web',
        },
      ],
      ['a'],
    );
    expect(results[0]?.suggestion).toBeNull();
  });

  it('asks the model for every key of a gap result', () => {
    const item = (
      REQUIREMENT_GAP_SCHEMA['properties'] as Record<string, { items: { required: string[] } }>
    )['results']!.items;
    expect(item.required).toEqual([
      'requirementId',
      'verdict',
      'evidence',
      'question',
      'why',
      'channel',
    ]);
  });
});
