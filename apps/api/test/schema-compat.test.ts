import { SYSTEM_RUBRIC } from '@docoo/documents';
import { strictSchemaProblems } from '@docoo/providers';
import { describe, expect, it } from 'vitest';

import { judgeSchema } from '../src/documents/documents.service.js';
import { solutionSchema } from '../src/documents/solutions.service.js';

/** Every schema the API sends to a provider must pass the strictest structured-output mode. */
describe('provider schemas the API sends', () => {
  it('the solutions schema is accepted by strict structured outputs for any count', () => {
    for (const count of [2, 5, 20]) expect(strictSchemaProblems(solutionSchema(count))).toEqual([]);
  });

  it('the evaluation judge schema is accepted for the system rubric', () => {
    expect(strictSchemaProblems(judgeSchema(SYSTEM_RUBRIC))).toEqual([]);
  });
});
