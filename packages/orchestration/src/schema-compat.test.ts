import { OUTLINE_SCHEMA, SECTION_SCHEMA } from '@docoo/documents';
import { ROLE_EVALUATION_SCHEMA } from '@docoo/domain';
import { strictSchemaProblems, type JsonSchema } from '@docoo/providers';
import { describe, expect, it } from 'vitest';

import { ANALYSIS_ROUND_SCHEMA } from './analysis.js';
import { STAGE_SCHEMAS, STAGES } from './stages.js';

/**
 * A provider must never be the first to reject a schema of the platform: every structured
 * output of the stages, the analyst's rounds and the Brain's role evaluation passes the strictest
 * mode (OpenAI `strict: true`), so the offline fake provider and the real ones accept the same.
 */
describe('provider schemas of the platform', () => {
  for (const stage of STAGES) {
    it(`the ${stage} stage output is accepted by strict structured outputs`, () => {
      expect(strictSchemaProblems(STAGE_SCHEMAS[stage])).toEqual([]);
    });
  }

  it('the analyst round schema is accepted', () => {
    expect(strictSchemaProblems(ANALYSIS_ROUND_SCHEMA)).toEqual([]);
  });

  it('the Brain role evaluation schema is accepted', () => {
    expect(strictSchemaProblems(ROLE_EVALUATION_SCHEMA)).toEqual([]);
  });

  it('the documenter outline and section schemas are accepted', () => {
    expect(strictSchemaProblems(OUTLINE_SCHEMA as unknown as JsonSchema)).toEqual([]);
    expect(strictSchemaProblems(SECTION_SCHEMA as unknown as JsonSchema)).toEqual([]);
  });
});
