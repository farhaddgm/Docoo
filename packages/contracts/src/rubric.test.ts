import { describe, expect, it } from 'vitest';

import { projectRubricSchema, rubricProblem } from './rubric.js';

const validRubric = {
  criteria: [
    { key: 'evidence', label: 'Evidence quality', weight: 60, targetStage: 'research' },
    { key: 'feasibility', label: 'Feasibility', weight: 40, targetStage: 'ideation' },
  ],
  passThreshold: 80,
  minimums: { evidence: 50 },
} as const;

describe('shared evaluation rubric contract', () => {
  it('accepts the project evaluation rubric shape used by the evaluator', () => {
    expect(projectRubricSchema.parse(validRubric)).toEqual(validRubric);
    expect(rubricProblem(validRubric)).toBeNull();
  });

  it('reports invalid shared scoring constraints', () => {
    expect(rubricProblem({ ...validRubric, criteria: validRubric.criteria.slice(0, 1) })).toContain(
      'weights must add up to 100',
    );
    expect(rubricProblem({ ...validRubric, minimums: { not_a_criterion: 50 } })).toContain(
      'unknown criterion',
    );
  });
});
