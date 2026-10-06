import { FakeAdapter } from '@docoo/providers';
import { describe, expect, it } from 'vitest';

import { fakeResponder } from './fake-responders.js';
import {
  isSelfCheckStep,
  prepareSelfCheck,
  runSelfCheckStep,
  SELF_CHECK_STEPS,
  type StructuredSelfCheckStep,
} from './self-check.js';
import type { ProviderRuntime } from './runtime.js';
import { fakeToolResponder } from './fake-responders.js';

const STRUCTURED = SELF_CHECK_STEPS.filter(
  (step): step is StructuredSelfCheckStep => step !== 'tool_calling',
);

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
      'tool_calling',
    ]);
    expect(isSelfCheckStep('stage_research')).toBe(true);
    expect(isSelfCheckStep('stage_unknown')).toBe(false);
    expect(isSelfCheckStep(undefined)).toBe(false);
  });

  for (const language of ['fa', 'en'] as const) {
    for (const step of STRUCTURED) {
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
    for (const step of STRUCTURED) {
      const call = prepareSelfCheck(step, 'en');
      expect(call.judge(null), step).not.toBeNull();
      expect(call.judge('plain text'), step).not.toBeNull();
      expect(call.judge({}), step).not.toBeNull();
    }
  });

  describe('tool_calling', () => {
    /** A runtime that talks to the fake adapter directly, like the offline provider does. */
    function runtimeOver(adapter: FakeAdapter) {
      const recorded: string[] = [];
      const runtime = {
        invoke: async (scope: { purpose: string }, _connection: string, request: never) => {
          recorded.push(scope.purpose);
          const response = await adapter.invoke(request);
          return { response, invocationId: `i${recorded.length}`, costUsd: 0.5 };
        },
      } as unknown as ProviderRuntime;
      return { runtime, recorded };
    }
    const input = {
      workspaceId: 'w',
      connectionId: 'c',
      model: 'fake-standard',
      step: 'tool_calling' as const,
      language: 'en' as const,
    };

    it('passes when the model calls the calculator and uses its result', async () => {
      const adapter = new FakeAdapter();
      adapter.toolResponder = fakeToolResponder;
      const { runtime, recorded } = runtimeOver(adapter);
      const result = await runSelfCheckStep(runtime, input);
      expect(result).toMatchObject({ status: 'passed', problem: null, finishReason: 'stop' });
      expect(recorded).toEqual(['selfcheck:tool_calling', 'selfcheck:tool_calling:answer']);
      // Both calls are added up: the cost of the step is the cost of the exchange.
      expect(result.costUsd).toBe(1);
      expect(result.invocationId).toBe('i1');
    });

    it('fails with a reason when the model does not call the tool', async () => {
      const { runtime, recorded } = runtimeOver(new FakeAdapter());
      expect(await runSelfCheckStep(runtime, input)).toMatchObject({
        status: 'failed',
        problem: 'no_tool_call',
      });
      expect(recorded).toHaveLength(1);
    });

    it('fails when the call is for another tool or the arguments compute something else', async () => {
      for (const [name, expression, problem] of [
        ['web_search', '17 * 23', 'wrong_tool'],
        ['calculator', '17 + 23', 'wrong_tool_arguments'],
        ['calculator', 'process.exit()', 'wrong_tool_arguments'],
      ] as const) {
        const adapter = new FakeAdapter();
        adapter.toolResponder = () => [{ id: 'c', name, arguments: { expression } }];
        const { runtime } = runtimeOver(adapter);
        expect(await runSelfCheckStep(runtime, input), `${name} ${expression}`).toMatchObject({
          status: 'failed',
          problem,
        });
      }
    });

    it('fails when the final answer ignores the tool result', async () => {
      const adapter = new FakeAdapter();
      adapter.toolResponder = fakeToolResponder;
      const { runtime } = runtimeOver(adapter);
      const original = adapter.invoke.bind(adapter);
      adapter.invoke = async (request) => ({
        ...(await original(request)),
        text: 'I am not sure.',
      });
      expect(await runSelfCheckStep(runtime, input)).toMatchObject({
        status: 'failed',
        problem: 'tool_result_not_used',
      });
    });
  });
});
