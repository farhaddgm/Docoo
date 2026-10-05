import { describe, expect, it } from 'vitest';

import { levelBoundsProblem } from './count.js';
import { validateDocument } from './model.js';
import { scoreSolution, DEFAULT_CRITERIA } from './scoring.js';
import {
  buildDocument,
  DOCUMENT_TEMPLATES,
  isTemplateKey,
  templateFor,
  TEMPLATE_KEYS,
  type TemplateInput,
} from './templates.js';

const input: TemplateInput = {
  title: 'Support first',
  summary: 'Answer within one hour.',
  assumptions: ['Staff can be hired'],
  evidence: ['Survey 2025'],
  plan: ['Hire', 'Train'],
  risks: ['Cost'],
  problem: 'Churn is too high.',
  score: scoreSolution(
    { impact: 4, feasibility: 3, evidence: 4, cost: 2, risk: 3, time: 4 },
    DEFAULT_CRITERIA,
  ),
};

const headings = (document: ReturnType<typeof buildDocument>) =>
  document.blocks.filter((block) => block.type === 'heading').map((block) => block.id);

describe('document templates (ADR-0018)', () => {
  it('has three templates whose versions name them', () => {
    expect([...TEMPLATE_KEYS]).toEqual(['brief', 'standard', 'detailed']);
    for (const key of TEMPLATE_KEYS) {
      expect(DOCUMENT_TEMPLATES[key].key).toBe(key);
      expect(DOCUMENT_TEMPLATES[key].version).toBe(`${key}-v1`);
    }
  });

  it('standard keeps the five required parts, with the ids the first release used', () => {
    const document = buildDocument(DOCUMENT_TEMPLATES.standard, input, 'en');
    expect(document.blocks.map((block) => block.id)).toEqual([
      'summary',
      'summary-text',
      'assumptions',
      'assumptions-list',
      'evidence',
      'evidence-list',
      'plan',
      'plan-list',
      'risks',
      'risks-list',
    ]);
    expect(document.blocks[1]).toMatchObject({
      type: 'paragraph',
      runs: [{ text: input.summary }],
    });
    expect(document.blocks[7]).toMatchObject({ type: 'list', ordered: true, items: input.plan });
  });

  it('brief is the decision on one page and detailed adds the problem and the scoring table', () => {
    expect(headings(buildDocument(DOCUMENT_TEMPLATES.brief, input, 'en'))).toEqual([
      'summary',
      'plan',
      'risks',
    ]);
    const detailed = buildDocument(DOCUMENT_TEMPLATES.detailed, input, 'en');
    expect(headings(detailed)).toEqual([
      'problem',
      'summary',
      'assumptions',
      'evidence',
      'plan',
      'risks',
      'scores',
    ]);
    expect(detailed.blocks[1]).toMatchObject({ runs: [{ text: input.problem }] });
    const table = detailed.blocks.find((block) => block.type === 'table');
    expect(table).toMatchObject({
      id: 'scores-table',
      columns: ['Criterion', 'Score', 'Weight', 'Contribution'],
    });
    expect(table && 'rows' in table ? table.rows : []).toHaveLength(6);
    expect(table && 'rows' in table ? table.rows[0] : []).toEqual([
      'Impact on the problem',
      '4/5',
      '25',
      expect.any(String),
    ]);
  });

  it('writes the headings in the document language and leaves the scoring out without a score', () => {
    const persian = buildDocument(DOCUMENT_TEMPLATES.detailed, { ...input, score: null }, 'fa');
    expect(persian.blocks[0]).toMatchObject({ text: 'مسئله' });
    expect(headings(persian)).not.toContain('scores');
  });

  it('every template produces a valid structured document', () => {
    for (const key of TEMPLATE_KEYS) {
      expect(() =>
        validateDocument(buildDocument(DOCUMENT_TEMPLATES[key], input, 'fa')),
      ).not.toThrow();
    }
  });

  it('falls back to standard for an unknown setting value', () => {
    expect(templateFor('detailed').key).toBe('detailed');
    expect(templateFor('mystery').key).toBe('standard');
    expect(templateFor(undefined).key).toBe('standard');
    expect(isTemplateKey('brief')).toBe(true);
    expect(isTemplateKey(3)).toBe(false);
  });
});

describe('level bounds rule (ADR-0018)', () => {
  const defaults = [1000, 3000, 5000, 7000, 9000, 11000, 13000, 17000, 22000, 28000];

  it('accepts the system default and any increasing, non-overlapping ranges', () => {
    expect(levelBoundsProblem(defaults)).toBeNull();
    expect(levelBoundsProblem([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
  });

  it.each([
    ['not a list', 'x'],
    ['nine numbers', defaults.slice(1)],
    ['a fraction', [1000.5, 3000, 5000, 7000, 9000, 11000, 13000, 17000, 22000, 28000]],
    ['a negative number', [-1, 3000, 5000, 7000, 9000, 11000, 13000, 17000, 22000, 28000]],
    ['min equal to max', [1000, 1000, 5000, 7000, 9000, 11000, 13000, 17000, 22000, 28000]],
    ['min above max', [3000, 1000, 5000, 7000, 9000, 11000, 13000, 17000, 22000, 28000]],
    ['overlapping levels', [1000, 3000, 3000, 7000, 9000, 11000, 13000, 17000, 22000, 28000]],
    ['levels out of order', [1000, 3000, 5000, 7000, 4000, 11000, 13000, 17000, 22000, 28000]],
  ])('rejects %s', (_label, value) => {
    expect(levelBoundsProblem(value)).toEqual(expect.any(String));
  });
});
