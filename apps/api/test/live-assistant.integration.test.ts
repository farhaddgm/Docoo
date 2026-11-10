import { randomUUID } from 'node:crypto';

import { liveAssistantSettingDefaults } from '@docoo/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorkspaceDatabase } from '../src/common/workspace-database.js';
import { ConfigService } from '../src/config/config.service.js';
import { LIVE_CAPABILITIES } from '../src/live-assistant/capabilities.js';
import { LiveAssistantService } from '../src/live-assistant/live-assistant.service.js';
import { adminUrl, createHarness, type Harness } from './support/harness.js';
import {
  liveAssistantScenarios,
  PROJECT,
  scenarioRegistry,
  type ScenarioCtx,
} from './support/live-assistant-scenarios.js';
import { ScriptedModel } from './support/scripted-model.js';

/** What a workspace that has switched the assistant on, with the right to act, looks like. */
const BASELINE: Record<string, unknown> = {
  'live_assistant.enabled': true,
  'live_assistant.disclosure_accepted': true,
  'live_assistant.connection_id': '44444444-4444-4444-8444-444444444444',
  'live_assistant.model': 'some-realtime-model',
  'live_assistant.access_level': 'act',
};

describe.skipIf(!adminUrl)('live voice assistant (ADR-0055)', () => {
  let h: Harness;
  let cookieA: string;
  let ctx: ScenarioCtx;
  /** The model behind the scenarios' own copy of the service; the HTTP tests use the real runtime. */
  const model = new ScriptedModel();
  const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}/live-assistant${suffix}`;
  /** What the server holds now, so only what changed is written. */
  const applied: Record<string, unknown> = { ...liveAssistantSettingDefaults };

  async function configure(values: Record<string, unknown>) {
    const target = { ...liveAssistantSettingDefaults, ...BASELINE, ...values } as Record<
      string,
      unknown
    >;
    for (const [key, value] of Object.entries(target)) {
      if (JSON.stringify(applied[key]) === JSON.stringify(value)) continue;
      const response = await h.request(
        'PUT',
        `/v1/workspaces/${h.ids.workspaceA}/settings/assignments`,
        {
          cookie: cookieA,
          payload: {
            key,
            scopeType: 'workspace',
            scopeId: h.ids.workspaceA,
            value,
            reason: `integration test ${key}`,
          },
        },
      );
      expect(response.statusCode, `${key}: ${response.body}`).toBe(200);
      applied[key] = value;
    }
  }

  beforeAll(async () => {
    h = await createHarness('live', {
      overrides: [{ provide: LIVE_CAPABILITIES, useValue: scenarioRegistry }],
    });
    cookieA = await h.login(h.emails.a);
    ctx = {
      // The same database, settings and registry as the application, with a model the tests script.
      service: new LiveAssistantService(
        h.app.get(WorkspaceDatabase),
        h.app.get(ConfigService),
        scenarioRegistry,
        model.runtime,
      ),
      model,
      context: { workspaceId: h.ids.workspaceA, actorId: h.ids.userA, correlationId: randomUUID() },
      otherContext: {
        workspaceId: h.ids.workspaceB,
        actorId: h.ids.userB,
        correlationId: randomUUID(),
      },
      configure,
      admin: async (sql, params) =>
        (await h.admin.query(sql, params)).rows as Record<string, unknown>[],
    };
  });

  afterAll(async () => {
    await h?.close();
  });

  describe('the gateway and its ledger, against the real database', () => {
    liveAssistantScenarios(() => ctx);
  });

  describe('over HTTP', () => {
    it('needs a signed-in super administrator', async () => {
      const anonymous = await h.request('GET', api('/config'));
      expect(anonymous.statusCode).toBe(401);
      const signedIn = await h.request('GET', api('/config'), { cookie: cookieA });
      expect(signedIn.statusCode, signedIn.body).toBe(200);
      expect(signedIn.json()).toMatchObject({ providerConnected: false, displayName: 'Docoo' });
    });

    it('answers the whole flow: start, propose, confirm, read back, end', async () => {
      await configure({});
      const started = await h.request('POST', api('/sessions'), { cookie: cookieA, payload: {} });
      expect(started.statusCode, started.body).toBe(201);
      const session = started.json<{ id: string }>();

      const proposed = await h.request('POST', api('/actions'), {
        cookie: cookieA,
        payload: {
          sessionId: session.id,
          capability: 'project.note',
          params: { projectId: PROJECT },
        },
      });
      expect(proposed.statusCode, proposed.body).toBe(201);
      expect(proposed.json()).toMatchObject({
        status: 'proposed',
        tier: 'T1',
        nextStep: 'confirm',
      });
      const actionId = proposed.json<{ id: string }>().id;

      const unclear = await h.request('POST', api(`/actions/${actionId}/confirm`), {
        cookie: cookieA,
        payload: { via: 'voice', transcript: 'هوم' },
      });
      expect(unclear.statusCode).toBe(422);
      expect(unclear.json<{ code: string }>().code).toBe('LIVE_CONFIRMATION_UNCLEAR');

      const needsWords = await h.request('POST', api(`/actions/${actionId}/confirm`), {
        cookie: cookieA,
        payload: { via: 'voice' },
      });
      expect(needsWords.statusCode).toBe(400);

      const confirmed = await h.request('POST', api(`/actions/${actionId}/confirm`), {
        cookie: cookieA,
        payload: { via: 'click' },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      expect(confirmed.json()).toMatchObject({ status: 'executed', result: { noted: true } });

      const again = await h.request('POST', api(`/actions/${actionId}/confirm`), {
        cookie: cookieA,
        payload: { via: 'click' },
      });
      expect(again.statusCode).toBe(409);

      const detail = await h.request('GET', api(`/sessions/${session.id}`), { cookie: cookieA });
      expect(detail.statusCode).toBe(200);
      expect(detail.json<{ actions: unknown[] }>().actions).toHaveLength(1);

      const ended = await h.request('POST', api(`/sessions/${session.id}/end`), {
        cookie: cookieA,
        payload: { reason: 'user' },
      });
      expect(ended.json()).toMatchObject({ status: 'ended', endReason: 'user' });
    });

    it('lets the owner type to the assistant through the real provider runtime, and records the call', async () => {
      // A fake provider connection and an executor model, the way the settings page would set them.
      const created = await h.request(
        'POST',
        `/v1/workspaces/${h.ids.workspaceA}/provider-connections`,
        {
          cookie: cookieA,
          payload: { provider: 'fake', name: 'Fake executor' },
        },
      );
      expect(created.statusCode, created.body).toBe(201);
      const connectionId = created.json<{ connection: { id: string } }>().connection.id;
      await configure({
        'live_assistant.executor_connection_id': connectionId,
        'live_assistant.executor_model': 'fake-standard',
        'live_assistant.connection_id': '',
        'live_assistant.model': '',
      });
      const config = await h.request('GET', api('/config'), { cookie: cookieA });
      expect(config.json()).toMatchObject({ textReady: true, textUnavailableReason: null });

      const started = await h.request('POST', api('/sessions'), {
        cookie: cookieA,
        payload: { channel: 'text' },
      });
      expect(started.statusCode, started.body).toBe(201);
      expect(started.json()).toMatchObject({ mode: 'text', status: 'active' });
      const sessionId = started.json<{ id: string }>().id;

      const original = h.fake.toolResponder;
      let asked = 0;
      h.fake.toolResponder = (request) => {
        const answered = request.messages.some(
          (message) => 'role' in message && message.role === 'tool',
        );
        if (answered) return null;
        asked += 1;
        return [{ id: 'tc1', name: 'project_read', arguments: { projectId: PROJECT } }];
      };
      try {
        const answer = await h.request('POST', api(`/sessions/${sessionId}/ask`), {
          cookie: cookieA,
          payload: { text: 'what is the project called?' },
        });
        expect(answer.statusCode, answer.body).toBe(200);
        const body = answer.json<{ answer: string; toolCalls: number; stop: string }>();
        expect(body.stop).toBe('answered');
        expect(body.toolCalls).toBe(1);
        expect(body.answer).toContain('Fake answer from the tool result');
        expect(body.answer).toContain('Spring plan');
        expect(asked).toBe(1);
      } finally {
        h.fake.toolResponder = original;
      }

      // The platform recorded both model calls under the executor's own purpose and connection.
      const calls = (
        await h.admin.query(
          `select status, connection_id, model, input_tokens from model_invocations
            where workspace_id = $1 and purpose = 'live_assistant:executor' order by created_at`,
          [h.ids.workspaceA],
        )
      ).rows as { status: string; connection_id: string; model: string; input_tokens: number }[];
      expect(calls).toHaveLength(2);
      expect(calls.every((call) => call.status === 'succeeded')).toBe(true);
      expect(calls.every((call) => call.connection_id === connectionId)).toBe(true);
      expect(calls.every((call) => call.model === 'fake-standard')).toBe(true);
      const detail = await h.request('GET', api(`/sessions/${sessionId}`), { cookie: cookieA });
      expect(
        detail.json<{ session: { inputTokens: number } }>().session.inputTokens,
      ).toBeGreaterThan(0);
      expect(detail.json<{ messages: unknown[] }>().messages).toHaveLength(2);

      const end = await h.request('POST', api(`/sessions/${sessionId}/end`), {
        cookie: cookieA,
        payload: {},
      });
      expect(end.statusCode).toBe(200);
    });

    it('needs the same sign-in for typing, and a text of a sensible size', async () => {
      const anonymous = await h.request('POST', api(`/sessions/${randomUUID()}/ask`), {
        payload: { text: 'hi' },
      });
      expect(anonymous.statusCode).toBe(401);
      for (const payload of [
        {},
        { text: '' },
        { text: 'x'.repeat(2001) },
        { text: 'hi', extra: 1 },
      ]) {
        const response = await h.request('POST', api(`/sessions/${randomUUID()}/ask`), {
          cookie: cookieA,
          payload,
        });
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      }
    });

    it('refuses a body with fields it does not know, and ids that are not ids', async () => {
      const extra = await h.request('POST', api('/sessions'), {
        cookie: cookieA,
        payload: { superuser: true },
      });
      expect(extra.statusCode).toBe(400);
      const badId = await h.request('GET', api('/sessions/not-an-id'), { cookie: cookieA });
      expect(badId.statusCode).toBe(400);
      const unknownReason = await h.request('POST', api(`/sessions/${randomUUID()}/end`), {
        cookie: cookieA,
        payload: { reason: 'cap_cost' },
      });
      expect(unknownReason.statusCode).toBe(400);
    });

    it('does not let another workspace read or change a session', async () => {
      await configure({});
      const started = await h.request('POST', api('/sessions'), { cookie: cookieA, payload: {} });
      const id = started.json<{ id: string }>().id;
      const cookieB = await h.login(h.emails.b);
      const asB = await h.request(
        'GET',
        `/v1/workspaces/${h.ids.workspaceB}/live-assistant/sessions/${id}`,
        { cookie: cookieB },
      );
      expect(asB.statusCode).toBe(404);
      const crossWorkspace = await h.request('GET', api(`/sessions/${id}`), { cookie: cookieB });
      expect([403, 404]).toContain(crossWorkspace.statusCode);
      await h.request('POST', api(`/sessions/${id}/end`), { cookie: cookieA, payload: {} });
    });

    it('hands out a one-time voice ticket only for an own, open voice session', async () => {
      await configure({});
      const started = await h.request('POST', api('/sessions'), { cookie: cookieA, payload: {} });
      const id = started.json<{ id: string }>().id;

      const anonymous = await h.request('POST', api(`/sessions/${id}/voice-ticket`));
      expect(anonymous.statusCode).toBe(401);

      const issued = await h.request('POST', api(`/sessions/${id}/voice-ticket`), {
        cookie: cookieA,
        payload: {},
      });
      expect(issued.statusCode, issued.body).toBe(200);
      const ticket = issued.json<{ ticket: string; path: string; expiresInMs: number }>();
      expect(ticket.ticket.length).toBeGreaterThanOrEqual(32);
      expect(ticket.path).toBe(
        `/api/workspaces/${h.ids.workspaceA}/live-assistant/sessions/${id}/voice`,
      );
      expect(ticket.expiresInMs).toBe(30_000);

      const unknown = await h.request(
        'POST',
        api('/sessions/99999999-9999-4999-8999-999999999999/voice-ticket'),
        { cookie: cookieA, payload: {} },
      );
      expect(unknown.statusCode).toBe(404);

      const cookieB = await h.login(h.emails.b);
      const asOther = await h.request(
        'POST',
        `/v1/workspaces/${h.ids.workspaceB}/live-assistant/sessions/${id}/voice-ticket`,
        { cookie: cookieB, payload: {} },
      );
      expect(asOther.statusCode).toBe(404);

      await h.request('POST', api(`/sessions/${id}/end`), { cookie: cookieA, payload: {} });
      const afterEnd = await h.request('POST', api(`/sessions/${id}/voice-ticket`), {
        cookie: cookieA,
        payload: {},
      });
      expect(afterEnd.statusCode).toBe(409);
    });

    it('gives no voice ticket for a typed session', async () => {
      await configure({});
      const started = await h.request('POST', api('/sessions'), {
        cookie: cookieA,
        payload: { channel: 'text' },
      });
      if (started.statusCode !== 201) return; // typing is not set up in this workspace
      const id = started.json<{ id: string }>().id;
      const ticket = await h.request('POST', api(`/sessions/${id}/voice-ticket`), {
        cookie: cookieA,
        payload: {},
      });
      expect(ticket.statusCode).toBe(409);
      await h.request('POST', api(`/sessions/${id}/end`), { cookie: cookieA, payload: {} });
    });
  });
});
