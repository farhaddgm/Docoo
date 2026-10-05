import { FakeAdapter } from '@docoo/providers';
import { describe, expect, it } from 'vitest';

import { fakeResponder } from './fake-responders.js';
import { isSelfCheckStep, prepareSelfCheck, SELF_CHECK_STEPS } from './self-check.js';

describe('the model self-check', () => {
  it('covers every kind of call the platform makes', () => {
    expect(SELF_CHECK_STEPS).toEqual([
      'analysis_round',
      'stage_analysis',
      'stage_research',
      'stage_ideation',
      'stage_documentation',
      'stage_evaluation',
      'document_outline',
      'document_section',
      'role_evaluation',
    ]);
    expect(isSelfCheckStep('stage_research')).toBe(true);
    expect(isSelfCheckStep('stage_unknown')).toBe(false);
    expect(isSelfCheckStep(undefined)).toBe(false);
  });

  for (const language of ['fa', 'en'] as const) {
    for (const step of SELF_CHECK_STEPS) {
      it(`${step} (${language}): the platform's own offline answer passes its check`, async () => {
        const call = prepareSelfCheck(step, language);
        expect(call.instructions.length).toBeGreaterThan(20);
        expect(call.message).toContain('<data>');
        const adapter = new FakeAdapter();
        adapter.responder = fakeResponder;
        const response = await adapter.invoke({
          model: 'fake-standard',
          instructions: call.instructions,
          messages: [{ role: 'user', content: call.message }],
          responseSchema: { name: call.schemaName, schema: call.schema },
        });
        expect(response.finishReason).toBe('stop');
        expect(call.judge(response.json), JSON.stringify(response.json).slice(0, 300)).toBeNull();
      });
    }
  }

  it('says what is wrong with an answer the pipeline could not read', () => {
    for (const step of SELF_CHECK_STEPS) {
      const call = prepareSelfCheck(step, 'en');
      expect(call.judge(null), step).not.toBeNull();
      expect(call.judge('plain text'), step).not.toBeNull();
      expect(call.judge({}), step).not.toBeNull();
    }
  });
});
