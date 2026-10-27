import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyMeetingState, meetingProblemPattern } from '@docoo/contracts';
import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookie: string;
let other: string;
let patternId: string;
let versionId: string;
let project: { id: string; version: number; problemPattern: unknown };
const api = (path: string) => `/v1/workspaces/${h.ids.workspaceA}${path}`;
const send = (method: 'POST' | 'PUT' | 'GET', path: string, payload?: unknown, auth = cookie) =>
  h.request(method, api(path), { cookie: auth, ...(payload ? { payload } : {}) });

describe.skipIf(!adminUrl)(
  'optional patterns and meeting preparation on the production API',
  () => {
    beforeAll(async () => {
      h = await createHarness('patterns');
      cookie = await h.login(h.emails.a);
      other = await h.login(h.emails.b);
      const connection = await send('POST', '/provider-connections', {
        provider: 'fake',
        name: 'Pattern test',
      });
      const id = connection.json<{ connection: { id: string } }>().connection.id;
      await send('POST', `/provider-connections/${id}/health-check`, {});
      for (const [key, value] of [
        ['ai.connection_id', id],
        ['ai.model', 'fake-standard'],
      ]) {
        const result = await send('PUT', '/settings/assignments', {
          key,
          value,
          scopeType: 'workspace',
          scopeId: h.ids.workspaceA,
          reason: 'test',
        });
        expect(result.statusCode, result.body).toBe(200);
      }
      h.fake.responder = (request) => {
        if (request.responseSchema?.name !== 'docoo_pattern_response') return null;
        const input = JSON.parse(request.messages[0]!.content) as { mode: string };
        if (input.mode === 'test')
          return {
            answer: 'Preview',
            definition: null,
            preview: {
              questions: ['Desired result?'],
              researchDecision: 'No external research.',
              sampleOutput: 'An opening and three questions.',
              limitations: ['Simulation only.'],
            },
          };
        const state = emptyMeetingState();
        if (input.mode === 'prepare')
          return {
            answer: 'What outcome would help?',
            context: { ...state.context, goal: 'Agree next steps' },
            brief: { ...state.brief, goal: 'Agree next steps' },
            perspectives: [{ kind: 'hypothesis', text: 'They may want clarity.' }],
            feedback: null,
          };
        return {
          answer: 'What outcome do you propose?',
          context: null,
          brief: null,
          perspectives: [],
          feedback: {
            strength: 'Clear opening',
            improvement: 'Name a next step',
            retrySuggestion: 'Propose a date',
          },
        };
      };
    }, 30000);
    afterAll(async () => {
      await h?.close();
    });
    it('keeps patterns optional and publishes only a tested version', async () => {
      const plain = await send('POST', '/projects', {
        code: 'plain',
        title: 'Plain',
        initialProblem: 'A normal problem',
      });
      expect(plain.statusCode, plain.body).toBe(201);
      expect(
        plain.json<{ project: { problemPattern: unknown } }>().project.problemPattern,
      ).toBeNull();
      const created = await send('POST', '/problem-patterns', {
        definition: meetingProblemPattern,
        idempotencyKey: randomUUID(),
      });
      expect(created.statusCode, created.body).toBe(201);
      patternId = created.json<{ id: string }>().id;
      const rejected = await send('POST', `/problem-patterns/${patternId}/versions`, {
        expectedRevision: 1,
        testRunId: randomUUID(),
        idempotencyKey: randomUUID(),
      });
      expect(rejected.statusCode).toBe(409);
      const test = await send('POST', `/problem-patterns/${patternId}/tests`, {
        expectedRevision: 1,
        content: 'Prepare for a planning meeting',
        providerConsent: true,
        idempotencyKey: randomUUID(),
      });
      expect(test.statusCode, test.body).toBe(201);
      expect(test.json<{ status: string }>().status).toBe('complete');
      const published = await send('POST', `/problem-patterns/${patternId}/versions`, {
        expectedRevision: 1,
        testRunId: test.json<{ id: string }>().id,
        idempotencyKey: randomUUID(),
      });
      expect(published.statusCode, published.body).toBe(201);
      versionId = published.json<{ id: string }>().id;
      const denied = await send('GET', `/problem-patterns/${patternId}`, undefined, other);
      expect(denied.statusCode).toBe(404);
      const selected = await send('POST', '/projects', {
        code: 'meeting',
        title: 'Meeting',
        initialProblem: 'Plan a real interaction',
        problemPatternVersionId: versionId,
      });
      expect(selected.statusCode, selected.body).toBe(201);
      project = selected.json<{ project: typeof project }>().project;
      expect(project.problemPattern).toMatchObject({ patternId, version: 1 });
    });
    it('supports changing the draft selection and freezes it when preparation starts', async () => {
      const changed = await send('PUT', `/projects/${project.id}/problem-pattern`, {
        expectedVersion: project.version,
        versionId: null,
      });
      expect(changed.statusCode, changed.body).toBe(200);
      project = changed.json<{ project: typeof project }>().project;
      expect(project.problemPattern).toBeNull();
      const restored = await send('PUT', `/projects/${project.id}/problem-pattern`, {
        expectedVersion: project.version,
        versionId,
      });
      expect(restored.statusCode, restored.body).toBe(200);
      project = restored.json<{ project: typeof project }>().project;
      const saved = await send('PUT', `/projects/${project.id}/meeting`, {
        expectedRevision: 0,
        state: emptyMeetingState(),
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const locked = await send('PUT', `/projects/${project.id}/problem-pattern`, {
        expectedVersion: project.version,
        versionId: null,
      });
      expect(locked.statusCode).toBe(409);
      const runInput = {
        expectedRevision: 1,
        mode: 'prepare',
        difficulty: 'hesitant',
        content: 'I want a clear next step',
        providerConsent: true,
        idempotencyKey: randomUUID(),
      };
      const prepared = await send('POST', `/projects/${project.id}/meeting/messages`, runInput);
      expect(prepared.statusCode, prepared.body).toBe(201);
      expect(prepared.json<{ status: string }>().status).toBe('complete');
      const replay = await send('POST', `/projects/${project.id}/meeting/messages`, runInput);
      expect(replay.json<{ id: string }>().id).toBe(prepared.json<{ id: string }>().id);
      const current = await send('GET', `/projects/${project.id}/meeting`);
      expect(current.json<{ revision: number }>().revision).toBe(1);
      expect(current.json<{ state: unknown }>().state).toEqual(emptyMeetingState());
      const ledger = await h.admin.query(
        "select purpose from model_invocations where workspace_id=$1 and purpose in ('pattern_authoring','meeting_preparation')",
        [h.ids.workspaceA],
      );
      expect(ledger.rows).toHaveLength(2);
      const denied = await send('GET', `/projects/${project.id}/meeting`, undefined, other);
      expect(denied.statusCode).toBe(404);
    });
    it('requires consent and real practice state and rejects stale saves', async () => {
      const base = `/projects/${project.id}/meeting`;
      const input = {
        expectedRevision: 1,
        mode: 'rehearse',
        difficulty: 'challenging',
        content: 'Could we agree a review date?',
        providerConsent: true,
        idempotencyKey: randomUUID(),
      };
      expect(
        (await send('POST', `${base}/messages`, { ...input, providerConsent: false })).statusCode,
      ).toBe(422);
      expect((await send('POST', `${base}/messages`, input)).statusCode).toBe(409);
      const state = { ...emptyMeetingState(), practice: 'practicing' };
      const saved = await send('PUT', base, { expectedRevision: 1, state });
      expect(saved.statusCode, saved.body).toBe(200);
      expect((await send('PUT', base, { expectedRevision: 1, state })).statusCode).toBe(409);
      const rehearsal = await send('POST', `${base}/messages`, { ...input, expectedRevision: 2 });
      expect(rehearsal.statusCode, rehearsal.body).toBe(201);
      expect(rehearsal.json()).toMatchObject({
        status: 'complete',
        result: { feedback: { retrySuggestion: 'Propose a date' } },
      });
      const reflection = await send('PUT', base, {
        expectedRevision: 2,
        state: {
          ...state,
          reflection: { occurred: false, outcome: 'Invented meeting', surprises: '', nextTime: '' },
        },
      });
      expect(reflection.statusCode).toBe(422);
    });
  },
);
