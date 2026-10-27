import { describe, expect, it } from 'vitest';

import { candidateProblemTemplates, problemTemplateSchema } from './problem-template.js';

describe('candidate problem templates', () => {
  it('provides uniquely versioned bilingual candidates with bounded prompts', () => {
    expect(candidateProblemTemplates).toHaveLength(3);
    expect(
      new Set(candidateProblemTemplates.map(({ id, version }) => `${id}@${version}`)).size,
    ).toBe(candidateProblemTemplates.length);
    for (const template of candidateProblemTemplates) {
      expect(problemTemplateSchema.parse(template)).toEqual(template);
      expect(template.lifecycle).toBe('candidate');
      expect(new Set(template.prompts.map(({ id }) => id)).size).toBe(template.prompts.length);
    }
  });

  it('rejects duplicate prompt identifiers and unapproved lifecycle states', () => {
    const template = candidateProblemTemplates[0];
    expect(
      problemTemplateSchema.safeParse({
        ...template,
        prompts: [...template.prompts, { ...template.prompts[0]! }],
      }).success,
    ).toBe(false);
    expect(problemTemplateSchema.safeParse({ ...template, lifecycle: 'approved' }).success).toBe(
      false,
    );
  });

  it('provides candidate rubrics whose weights total 100 without applying them', () => {
    for (const template of candidateProblemTemplates) {
      expect(template.rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)).toBe(
        100,
      );
      expect(template.rubric.passThreshold).toBe(80);
      expect(
        Object.keys(template.rubric.minimums).every((key) =>
          template.rubric.criteria.some((criterion) => criterion.key === key),
        ),
      ).toBe(true);
    }
    const template = candidateProblemTemplates[0];
    expect(
      problemTemplateSchema.safeParse({
        ...template,
        rubric: {
          ...template.rubric,
          criteria: template.rubric.criteria.map((criterion, index) =>
            index === 0 ? { ...criterion, weight: criterion.weight - 1 } : criterion,
          ),
        },
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields to prevent accidental execution metadata', () => {
    expect(
      problemTemplateSchema.safeParse({
        ...candidateProblemTemplates[0],
        defaultForAllProjects: true,
      }).success,
    ).toBe(false);
  });

  it('accepts an immutable project snapshot carrying the exact catalog version', () => {
    expect(problemTemplateSchema.parse(candidateProblemTemplates[1])).toMatchObject({
      id: 'go-to-market',
      version: 1,
      lifecycle: 'candidate',
    });
  });
});
