import { fakeResponder } from '@docoo/orchestration';
import type { NormalizedModelRequest } from '@docoo/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StageFlow } from './support/flow.js';
import type { TemporalTestRuntime } from './support/harness.js';
import { adminUrl, createHarness, temporalAddress, type Harness } from './support/harness.js';

// An exploration is a project of kind `exploration` (ADR-0045). Step B: the analysis asks about an
// event or topic, and the research stage is off unless a research plan was confirmed.
let h: Harness;
let flow: StageFlow;
let temporal: TemporalTestRuntime;
const captured: NormalizedModelRequest[] = [];

describe.skipIf(!adminUrl || !temporalAddress)(
  'exploration as a project kind (ADR-0045 step B)',
  () => {
    beforeAll(async () => {
      h = await createHarness('explproj', { workflow: true });
      temporal = h.engine as TemporalTestRuntime;
      flow = new StageFlow(h, await h.login(h.emails.a));
      await flow.prepare();
      temporal.fake.responder = (request) => {
        captured.push(request);
        return fakeResponder(request);
      };
    }, 90_000);
    afterAll(async () => {
      temporal.fake.responder = fakeResponder;
      await h?.close();
    });

    async function create(code: string, kind?: 'exploration'): Promise<string> {
      const created = await flow.post<{ project: { id: string } }>('/projects', {
        code,
        title: `Project ${code}`,
        initialProblem: 'A new regulation was announced for retail.',
        topics: [{ topicId: flow.topicId }],
        ...(kind ? { kind } : {}),
      });
      return created.project.id;
    }

    async function toResearch(projectId: string) {
      await flow.activate(projectId);
      await flow.analysis.reachDefinition(projectId);
      const view = await flow.waitFor(projectId, flow.waiting('analysis'), 'analysis gate');
      await flow.decide(projectId, flow.stageOf(view, 'analysis'), 'approve');
      await flow.waitFor(projectId, flow.waiting('research'), 'research gate');
    }

    const analystRequests = () =>
      captured.filter((request) => (request.instructions ?? '').includes('Your role: analyst.'));

    it('asks the analyst about an event or topic and gives research no knowledge to retrieve', async () => {
      captured.length = 0;
      const projectId = await create('expl-1', 'exploration');
      await toResearch(projectId);

      const analyst = analystRequests();
      expect(analyst.length).toBeGreaterThan(0);
      expect(
        analyst.every((r) => (r.instructions ?? '').includes('This project is an exploration')),
      ).toBe(true);

      const research = captured.filter((r) => r.responseSchema?.name === 'research_output');
      expect(research.length).toBeGreaterThan(0);
      expect(research[0]!.instructions).toContain('Research is disabled');
      expect(research[0]!.tools ?? []).toHaveLength(0);
      const output = (await flow.stageOutput(projectId, 'research')) as {
        knowledge?: { offered?: unknown[] };
      };
      expect(output.knowledge?.offered ?? []).toHaveLength(0);
    }, 120_000);

    it('leaves an ordinary project exactly as it was', async () => {
      captured.length = 0;
      const projectId = await create('std-1');
      await toResearch(projectId);

      const analyst = analystRequests();
      expect(analyst.length).toBeGreaterThan(0);
      expect(analyst.some((r) => (r.instructions ?? '').includes('exploration'))).toBe(false);
      const research = captured.filter((r) => r.responseSchema?.name === 'research_output');
      expect(research.length).toBeGreaterThan(0);
      expect(research[0]!.instructions).not.toContain('Research is disabled');
    }, 120_000);

    async function toIdeation(projectId: string) {
      await toResearch(projectId);
      const view = await flow.waitFor(projectId, flow.waiting('research'), 'research gate');
      await flow.decide(projectId, flow.stageOf(view, 'research'), 'approve');
      await flow.waitFor(projectId, flow.waiting('ideation'), 'ideation gate');
    }

    const ideator = () =>
      captured.filter((request) => (request.instructions ?? '').includes('Your role: ideator.'));
    const solutionRequest = () =>
      captured.filter((request) => request.responseSchema?.name === 'solutions');

    it('asks for the dimensions of the topic and scores them on the exploration criteria', async () => {
      captured.length = 0;
      const projectId = await create('expl-dim', 'exploration');
      await toIdeation(projectId);
      expect(ideator().length).toBeGreaterThan(0);
      expect(
        ideator().every((r) => (r.instructions ?? '').includes('a dimension of the topic')),
      ).toBe(true);

      const criteria = await flow.get<{ criteria: { criteria: { key: string }[] } }>(
        `/projects/${projectId}/solution-criteria`,
      );
      expect(criteria.criteria.criteria.map((item) => item.key)).toEqual([
        'importance',
        'urgency',
        'clarity',
        'independence',
      ]);

      const generated = await flow.post<{
        solutionSet: { items: { score: { criteria: { key: string }[] } }[] };
      }>(`/projects/${projectId}/solutions/generate`, { count: 2 });
      expect(generated.solutionSet.items).toHaveLength(2);
      expect(solutionRequest()).toHaveLength(1);
      expect(solutionRequest()[0]!.instructions).toContain('dimensions of the topic');
      expect(generated.solutionSet.items[0]!.score.criteria.map((item) => item.key)).toEqual([
        'importance',
        'urgency',
        'clarity',
        'independence',
      ]);
    }, 180_000);

    it('keeps the ideation and the solutions of an ordinary project as they were', async () => {
      captured.length = 0;
      const projectId = await create('std-dim');
      await toIdeation(projectId);
      expect(ideator().length).toBeGreaterThan(0);
      expect(ideator().some((r) => (r.instructions ?? '').includes('dimension of the topic'))).toBe(
        false,
      );
      const generated = await flow.post<{
        solutionSet: { items: { score: { criteria: { key: string }[] } }[] };
      }>(`/projects/${projectId}/solutions/generate`, { count: 2 });
      expect(solutionRequest()[0]!.instructions).not.toContain('dimensions of the topic');
      expect(generated.solutionSet.items[0]!.score.criteria.map((item) => item.key)).toEqual([
        'impact',
        'feasibility',
        'evidence',
        'cost',
        'risk',
        'time',
      ]);
    }, 180_000);
  },
);
