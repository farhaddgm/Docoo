import { randomUUID } from 'node:crypto';

import { liveAssistantSettingDefaults } from '@docoo/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LIVE_CAPABILITIES } from '../src/live-assistant/capabilities.js';
import { LiveAssistantService } from '../src/live-assistant/live-assistant.service.js';
import { adminUrl, createHarness, type Harness } from './support/harness.js';
import {
  liveAssistantScenarios,
  PROJECT,
  scenarioRegistry,
  type ScenarioCtx,
} from './support/live-assistant-scenarios.js';

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
      service: h.app.get(LiveAssistantService),
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
  });
});
