import { defaultDefinition, OUTPUT_REQUIREMENT_RULES } from '@docoo/domain';
import { describe, expect, it } from 'vitest';

import { stagePrompt, STAGES, type StageContext } from './stages.js';

const context = (
  stage: StageContext['stage'],
  extra: Partial<StageContext> = {},
): StageContext => ({
  stage,
  definition: defaultDefinition('analyst'),
  language: 'en',
  projectTitle: 'Churn',
  problem: 'Reduce churn',
  topics: [],
  previous: [],
  feedback: [],
  ...extra,
});
const data = (message: string) => JSON.parse(message.slice(6, -7)) as Record<string, unknown>;

describe('output requirements in the stage prompt (ADR-0037)', () => {
  const requirements = [
    { id: 'r1', kind: 'must', text: 'Include a risk register' },
    { id: 'r2', kind: 'must_not', text: 'Name no staff' },
  ] as const;

  it('hands every stage the active requirements as data and adds the rules', () => {
    for (const stage of STAGES) {
      const prompt = stagePrompt(context(stage, { requirements }));
      for (const rule of OUTPUT_REQUIREMENT_RULES) expect(prompt.instructions).toContain(rule);
      expect(data(prompt.message)['outputRequirements']).toEqual(requirements);
      // The administrator's words stay out of the instruction channel.
      expect(prompt.instructions).not.toContain('Include a risk register');
    }
  });

  it('leaves the prompt as it was when there is no requirement', () => {
    for (const requirementsValue of [undefined, []]) {
      const prompt = stagePrompt(context('ideation', { requirements: requirementsValue }));
      expect(prompt.instructions).not.toContain('outputRequirements');
      expect(data(prompt.message)).not.toHaveProperty('outputRequirements');
    }
  });
});
