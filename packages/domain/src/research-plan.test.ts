import { describe, expect, it } from 'vitest';

import {
  normalizeResearchQuestions,
  questionRef,
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
