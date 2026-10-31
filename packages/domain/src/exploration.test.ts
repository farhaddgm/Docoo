import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_DECISIONS,
  EXPLORATION_LIMITS,
  EXPLORATION_PROPOSAL_SCHEMA,
  isCandidateDecision,
  normalizeCandidate,
  normalizeCandidates,
} from './exploration.js';

const good = (title: string) => ({
  title,
  problemDraft: `Why ${title}`,
  why: 'matters',
  assumptions: '',
  expectedOutput: '',
});

describe('exploration candidates (ADR-0044)', () => {
  it('lets an administrator set only the states that need no project', () => {
    expect(CANDIDATE_DECISIONS).toEqual(['proposed', 'parked', 'dropped']);
    expect(isCandidateDecision('parked')).toBe(true);
    expect(isCandidateDecision('promoted')).toBe(false);
    expect(isCandidateDecision('nonsense')).toBe(false);
  });

  it('keeps a usable candidate and trims and cuts its texts to the limits', () => {
    const candidate = normalizeCandidate({
      title: '  Churn of large clients  ',
      problemDraft: ' Three clients left. ',
      why: 'x'.repeat(5000),
      assumptions: 7,
    });
    expect(candidate).toMatchObject({ title: 'Churn of large clients', assumptions: '' });
    expect(candidate!.why).toHaveLength(EXPLORATION_LIMITS.candidateText);
  });

  it('rejects a candidate without a title or a problem', () => {
    expect(normalizeCandidate({ title: 'A', problemDraft: 'x' })).toBeNull();
    expect(normalizeCandidate({ title: 'Valid title', problemDraft: '  ' })).toBeNull();
    expect(normalizeCandidate(null)).toBeNull();
    expect(normalizeCandidate('text')).toBeNull();
  });

  it('drops and counts repeats, unusable entries, existing titles and what exceeds the room', () => {
    const result = normalizeCandidates(
      [
        good('One'),
        good('one'),
        good('Two'),
        { title: 'x' },
        good('Existing'),
        good('Three'),
        good('Four'),
      ],
      { existingTitles: ['existing'], room: 3 },
    );
    expect(result.items.map((item) => item.title)).toEqual(['One', 'Two', 'Three']);
    expect(result.discarded).toBe(4);
  });

  it('never adds more than one proposal may and nothing when there is no room', () => {
    const many = Array.from({ length: 20 }, (_, index) => good(`Problem ${index}`));
    expect(normalizeCandidates(many, { room: 100 }).items).toHaveLength(
      EXPLORATION_LIMITS.perProposal,
    );
    expect(normalizeCandidates(many, { room: 0 })).toEqual({ items: [], discarded: 20 });
    expect(normalizeCandidates('not a list', { room: 5 })).toEqual({ items: [], discarded: 0 });
  });

  it('has a strict schema where every property is required', () => {
    const item = (
      EXPLORATION_PROPOSAL_SCHEMA['properties'] as Record<
        string,
        { items: Record<string, unknown> }
      >
    )['candidates']!.items as {
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
    expect(item.additionalProperties).toBe(false);
  });
});
