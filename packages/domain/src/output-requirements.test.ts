import { describe, expect, it } from 'vitest';

import {
  COVERAGE_SCHEMA,
  normalizeCoverage,
  normalizeRequirementText,
  OUTPUT_REQUIREMENT_LIMITS,
  stagesBehindRequirement,
  summarizeCoverage,
} from './output-requirements.js';

describe('requirement text', () => {
  it('collapses blanks, trims and caps the length', () => {
    expect(normalizeRequirementText('  must   have\n a   budget ')).toBe('must have a budget');
    expect(normalizeRequirementText('x'.repeat(5000))).toHaveLength(
      OUTPUT_REQUIREMENT_LIMITS.textMax,
    );
  });

  it('refuses text that is too short or not text', () => {
    expect(normalizeRequirementText('  ab ')).toBeNull();
    expect(normalizeRequirementText(42)).toBeNull();
    expect(normalizeRequirementText(undefined)).toBeNull();
  });
});

describe('coverage answer', () => {
  const ids = ['a', 'b', 'c'];

  it('gives exactly one result per requirement, in order', () => {
    const { results, discarded } = normalizeCoverage(
      [
        { requirementId: 'b', verdict: 'partial', evidence: ' vague ', foundIn: 'research' },
        { requirementId: 'a', verdict: 'covered', evidence: 'stated', foundIn: 'documents' },
      ],
      ids,
    );
    expect(discarded).toBe(0);
    expect(results.map((r) => [r.requirementId, r.verdict])).toEqual([
      ['a', 'covered'],
      ['b', 'partial'],
      ['c', 'unknown'],
    ]);
    expect(results[1]?.evidence).toBe('vague');
  });

  it('drops unknown ids, repeats and verdicts the model may not give', () => {
    const { results, discarded } = normalizeCoverage(
      [
        { requirementId: 'zzz', verdict: 'covered', evidence: '', foundIn: '' },
        { requirementId: 'a', verdict: 'unknown', evidence: '', foundIn: '' },
        { requirementId: 'a', verdict: 'maybe', evidence: '', foundIn: '' },
        { requirementId: 'a', verdict: 'covered', evidence: 'ok', foundIn: 'x' },
        { requirementId: 'a', verdict: 'not_covered', evidence: 'repeat', foundIn: '' },
        'text',
        null,
      ],
      ['a'],
    );
    expect(discarded).toBe(6);
    expect(results).toEqual([
      { requirementId: 'a', verdict: 'covered', evidence: 'ok', foundIn: 'x' },
    ]);
  });

  it('treats a non-list answer as nothing checked', () => {
    expect(normalizeCoverage(null, ['a']).results[0]?.verdict).toBe('unknown');
    expect(normalizeCoverage('x', []).results).toEqual([]);
  });

  it('counts the verdicts', () => {
    expect(
      summarizeCoverage([
        { verdict: 'covered' },
        { verdict: 'covered' },
        { verdict: 'partial' },
        { verdict: 'not_covered' },
        { verdict: 'unknown' },
      ]),
    ).toEqual({ total: 5, covered: 2, partial: 1, notCovered: 1, unknown: 1 });
  });

  it('asks the model for every key of a result', () => {
    const item = (
      COVERAGE_SCHEMA['properties'] as Record<string, { items: { required: string[] } }>
    )['results']!.items;
    expect(item.required).toEqual(['requirementId', 'verdict', 'evidence', 'foundIn']);
  });
});

describe('stages behind a requirement', () => {
  it('lists the stages whose output is older than the requirement', () => {
    const behind = stagesBehindRequirement('2026-10-20T10:00:00.000Z', [
      { stage: 'analysis', outputCreatedAt: '2026-10-19T10:00:00.000Z' },
      { stage: 'research', outputCreatedAt: '2026-10-20T11:00:00.000Z' },
      { stage: 'ideation', outputCreatedAt: null },
    ]);
    expect(behind).toEqual(['analysis']);
  });
});
