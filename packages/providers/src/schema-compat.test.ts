import { describe, expect, it } from 'vitest';

import { strictSchemaProblems, STRICT_LIMITS } from './schema-compat.js';

const ok = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    score: { type: 'integer', minimum: 1, maximum: 5 },
    tags: { type: 'array', items: { type: 'string' }, minItems: 0 },
    kind: { type: 'string', enum: ['a', 'b'] },
    nested: {
      type: 'object',
      properties: { flag: { type: 'boolean' } },
      required: ['flag'],
      additionalProperties: false,
    },
  },
  required: ['name', 'score', 'tags', 'kind', 'nested'],
  additionalProperties: false,
} as const;

describe('strict structured-output compatibility', () => {
  it('accepts a closed object whose properties are all required', () => {
    expect(strictSchemaProblems(ok)).toEqual([]);
  });

  it('names an open object and a property that is not required', () => {
    const problems = strictSchemaProblems({
      ...ok,
      properties: { ...ok.properties, extra: { type: 'string' } },
      additionalProperties: true,
    });
    expect(problems).toContain('$: an object must set additionalProperties to false');
    expect(problems).toContain('$.extra: every property must be required');
  });

  it('names a required key that is not declared and an array without items', () => {
    const problems = strictSchemaProblems({
      type: 'object',
      properties: { list: { type: 'array' } },
      required: ['list', 'ghost'],
      additionalProperties: false,
    });
    expect(problems).toContain('$: "ghost" is required but not declared');
    expect(problems).toContain('$.list: an array must declare its items');
  });

  it('refuses keywords and types outside the supported subset', () => {
    const problems = strictSchemaProblems({
      type: 'object',
      properties: {
        a: { type: 'string', pattern: '^x$', default: 'x' },
        b: { oneOf: [{ type: 'string' }] },
        c: { type: 'date' },
      },
      required: ['a', 'b', 'c'],
      additionalProperties: false,
    });
    expect(problems).toContain('$.a: keyword "default" is not supported');
    expect(problems).toContain('$.b: keyword "oneOf" is not supported');
    expect(problems.some((problem) => problem.startsWith('$.c: "type" must be one of'))).toBe(true);
  });

  it('requires an object at the root and limits the nesting depth', () => {
    expect(strictSchemaProblems({ type: 'array', items: { type: 'string' } })).toContain(
      '$: the root of a schema must be an object',
    );
    let deep: Record<string, unknown> = { type: 'string' };
    for (let level = 0; level < STRICT_LIMITS.maxDepth + 1; level += 1) {
      deep = {
        type: 'object',
        properties: { next: deep },
        required: ['next'],
        additionalProperties: false,
      };
    }
    expect(strictSchemaProblems(deep).some((problem) => problem.includes('nested deeper'))).toBe(
      true,
    );
  });
});
