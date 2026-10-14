import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countBlocks } from './writing.js';
import { decisionConditionBlocks, decisionConditions } from './decision-conditions.js';
import { validateDocument } from './model.js';

describe('approved decision conditions', () => {
  it('retains declared conditions without inventing, truncating or duplicating them', () => {
    const result = decisionConditions({
      objectives: [' Absolute 30% ', 'SEK12,000 total'],
      constraints: ['SEK12,000 total', '58.8% floor', null, 4],
      successCriteria: ['Adults18+; voluntary; no IDs'],
      outOfScope: ['No individual tracking'],
    });
    expect(result).toEqual([
      'Absolute 30%',
      'SEK12,000 total',
      '58.8% floor',
      'Adults18+; voluntary; no IDs',
      'No individual tracking',
    ]);
    expect(
      validateDocument({
        title: 'Synthetic',
        language: 'en',
        blocks: decisionConditionBlocks(result, 'en'),
      }).blocks,
    ).toHaveLength(2);
    expect(decisionConditionBlocks([], 'fa')).toEqual([]);
  });

  it('demonstrates that the clean real-provider fixture cannot fit a level1 document', () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          '../../../qa/regressions/short-writing/approved-synthetic-cafe.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as { problem: Record<string, unknown> };
    const conditions = decisionConditions(fixture.problem);
    expect(conditions).toHaveLength(36);
    expect(countBlocks(decisionConditionBlocks(conditions, 'en'), 'en')).toBeGreaterThan(3000);
    expect(conditions.join('\n')).toContain('at least 30%');
    expect(conditions.join('\n')).toContain('58.8%');
    expect(conditions.join('\n')).toContain('four staff hours per week');
  });
});
