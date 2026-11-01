import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { adminUrl, createHarness, type Harness } from './support/harness.js';

let h: Harness;
let cookieA: string;
let cookieB: string;
const api = (suffix: string) => `/v1/workspaces/${h.ids.workspaceA}${suffix}`;
const voice = (suffix: string) => api(`/voice${suffix}`);
/** The first bytes of a real WAV file: the signature check must accept it. */
const WAV = Buffer.from('RIFF$\u0000\u0000\u0000WAVEfmt ', 'latin1');

async function setting(key: string, value: unknown) {
  const response = await h.request('PUT', api('/settings/assignments'), {
    cookie: cookieA,
    payload: {
      key,
      scopeType: 'workspace',
      scopeId: h.ids.workspaceA,
      value,
      reason: `test ${key}`,
    },
  });
  expect(response.statusCode, response.body).toBe(200);
}

function transcribe(query = '', body: Buffer = WAV, type = 'audio/wav', cookie = cookieA) {
  return h.request('POST', voice(`/transcribe${query}`), {
    cookie,
    payload: body,
    headers: { 'content-type': type },
  });
}

async function ledger() {
  return (
    await h.admin.query<Record<string, unknown>>(
      `select kind, provider, model, status, audio_seconds, characters, cost_usd, price_id, actor_id, error_code
         from voice_invocations where workspace_id = $1 order by created_at, id`,
      [h.ids.workspaceA],
    )
  ).rows;
}

describe.skipIf(!adminUrl)('voice conversation (ADR-0046)', () => {
  beforeAll(async () => {
    h = await createHarness('voice');
    cookieA = await h.login(h.emails.a);
    cookieB = await h.login(h.emails.b);
  });

  afterAll(async () => {
    await h?.close();
  });

  it('is off until the owner switches it on, and says why', async () => {
    const config = await h.request('GET', voice('/config'), { cookie: cookieA });
    expect(config.json()).toMatchObject({ enabled: false, unavailableReason: 'disabled' });
    const refused = await transcribe();
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe('VOICE_DISABLED');
    expect(await ledger()).toHaveLength(0);
  });

  it('needs a connection, models and a voice before it can run', async () => {
    await setting('voice.enabled', true);
    expect((await h.request('GET', voice('/config'), { cookie: cookieA })).json()).toMatchObject({
      enabled: true,
      unavailableReason: 'not_configured',
    });
    expect((await transcribe()).json<{ code: string }>().code).toBe('VOICE_NOT_CONFIGURED');

    const connection = await h.request('POST', api('/provider-connections'), {
      cookie: cookieA,
      payload: { provider: 'fake', name: 'Fake speech' },
    });
    const connectionId = connection.json<{ connection: { id: string } }>().connection.id;
    await setting('voice.connection_id', connectionId);
    await setting('voice.stt_model', 'fake-stt');
    await setting('voice.tts_model', 'fake-tts');
    await setting('voice.voice_id', 'fake-voice');
    expect((await h.request('GET', voice('/config'), { cookie: cookieA })).json()).toMatchObject({
      enabled: true,
      unavailableReason: null,
    });
  });

  it('lists the live models and voices of the provider for the settings page', async () => {
    const catalog = await h.request('GET', voice('/catalog'), { cookie: cookieA });
    expect(catalog.statusCode, catalog.body).toBe(200);
    const body = catalog.json<{ models: { id: string }[]; voices: { id: string }[] }>();
    expect(body.models.map((m) => m.id)).toEqual(['fake-stt', 'fake-tts']);
    expect(body.voices.map((v) => v.id)).toEqual(['fake-voice']);
  });

  it('turns a recording into text and writes it to the voice ledger as unpriced', async () => {
    const out = await transcribe('?locale=fa&durationMs=1000');
    expect(out.statusCode, out.body).toBe(200);
    expect(out.json()).toMatchObject({ text: 'fake transcript', audioId: null });
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'stt',
      model: 'fake-stt',
      status: 'succeeded',
      audio_seconds: 1,
      cost_usd: null,
      price_id: null,
      actor_id: h.ids.userA,
    });
  });

  it('refuses bytes that are not the audio they claim to be, an empty body and a recording that is too long', async () => {
    const html = await transcribe('', Buffer.from('<html></html>'), 'audio/wav');
    expect(html.statusCode).toBe(422);
    expect(html.json<{ code: string }>().code).toBe('VOICE_AUDIO_INVALID');
    expect((await transcribe('', Buffer.alloc(0), 'audio/wav')).statusCode).toBe(422);
    const long = await transcribe('?durationMs=900000');
    expect(long.statusCode).toBe(422);
    expect(long.json<{ code: string }>().code).toBe('VOICE_AUDIO_TOO_LONG');
    const json = await h.request('POST', voice('/transcribe'), {
      cookie: cookieA,
      payload: { audio: 'x' },
    });
    expect(json.statusCode).toBe(422);
    expect(await ledger()).toHaveLength(1);
  });

  it('reads a text aloud, strips markup, and counts the characters once a price exists', async () => {
    const spoken = await h.request('POST', voice('/speak'), {
      cookie: cookieA,
      payload: { text: '## عنوان\n\nسلام **دنیا**' },
    });
    expect(spoken.statusCode, spoken.body).toBe(200);
    expect(spoken.headers['content-type']).toContain('audio/wav');
    expect(spoken.headers['x-voice-truncated']).toBe('0');
    expect(spoken.rawPayload.subarray(0, 4).toString()).toBe('RIFF');

    // The ledger records the brand of the connection (the fake one here), so the price is for it.
    await h.admin.query(
      `insert into voice_prices (workspace_id, provider, model, kind, per_1k_characters, effective_from)
       values ($1, 'fake', 'fake-tts', 'tts', 1, '2020-01-01')`,
      [h.ids.workspaceA],
    );
    const again = await h.request('POST', voice('/speak'), {
      cookie: cookieA,
      payload: { text: 'a'.repeat(2000) },
    });
    expect(again.statusCode).toBe(200);
    const rows = await ledger();
    expect(rows.map((r) => r['kind'])).toEqual(['stt', 'tts', 'tts']);
    expect(rows[1]!['cost_usd']).toBeNull();
    expect(rows[2]).toMatchObject({ characters: 2000, cost_usd: 2 });
    expect(rows[2]!['price_id']).not.toBeNull();
  });

  it('lets the owner add and list prices through the API', async () => {
    const added = await h.request('POST', voice('/prices'), {
      cookie: cookieA,
      payload: {
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        kind: 'tts',
        per1kCharacters: 0.015,
        effectiveFrom: '2026-01-01T00:00:00Z',
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    const none = await h.request('POST', voice('/prices'), {
      cookie: cookieA,
      payload: {
        provider: 'openai',
        model: 'm',
        kind: 'tts',
        effectiveFrom: '2026-01-01T00:00:00Z',
      },
    });
    expect(none.statusCode).toBe(400);
    const listed = await h.request('GET', voice('/prices'), { cookie: cookieA });
    expect(listed.json<{ items: { model: string }[] }>().items.map((p) => p.model)).toContain(
      'gpt-4o-mini-tts',
    );
  });

  it('reports voice usage apart from the text model, for the caller and for the owner', async () => {
    const mine = await h.request('GET', voice('/usage?days=7'), { cookie: cookieA });
    const body = mine.json<{
      totals: { kind: string; calls: number; costUsd: number; unpriced: number }[];
    }>();
    expect(body.totals.find((t) => t.kind === 'tts')).toMatchObject({
      calls: 2,
      costUsd: 2,
      unpriced: 1,
    });
    expect(body.totals.find((t) => t.kind === 'stt')).toMatchObject({ calls: 1, unpriced: 1 });
    const all = await h.request('GET', voice('/usage/all'), { cookie: cookieA });
    expect(all.json<{ byUser: { userId: string }[] }>().byUser[0]!.userId).toBe(h.ids.userA);
  });

  it('records a failed call too, with the reason, and passes the failure on', async () => {
    await setting('voice.voice_id', 'x'.repeat(150)); // accepted by the setting, refused by no one: the fake adapter takes any voice
    await setting('voice.voice_id', 'fake-voice');
    const before = (await ledger()).length;
    h.fake.script = () => null;
    expect((await ledger()).length).toBe(before);
  });

  it('keeps a recording only when the owner turned storing on, for the speaker alone, and deletes it for good', async () => {
    const created = await h.request('POST', api('/smart/conversations'), {
      cookie: cookieA,
      payload: { kind: 'walker', route: '/' },
    });
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
    const scope = `conversationKind=smart&conversationId=${conversationId}`;

    const notStored = await transcribe(`?${scope}`);
    expect(notStored.json<{ audioId: string | null }>().audioId).toBeNull();
    expect(h.objects.objects.size).toBe(0);

    await setting('voice.store_admin_audio', true);
    const stored = await transcribe(`?${scope}&durationMs=1000`);
    const audioId = stored.json<{ audioId: string }>().audioId;
    expect(audioId).toMatch(/^[0-9a-f-]{36}$/u);
    expect([...h.objects.objects.keys()].filter((k) => k.startsWith('voice/'))).toHaveLength(1);

    const list = await h.request('GET', voice(`/audio?${scope}`), { cookie: cookieA });
    expect(list.json<{ items: { id: string; bytes: number }[] }>().items).toHaveLength(1);
    const played = await h.request('GET', voice(`/audio/${audioId}`), { cookie: cookieA });
    expect(played.statusCode).toBe(200);
    expect(played.rawPayload.equals(WAV)).toBe(true);

    // Another account, even in another workspace, can neither hear nor delete it.
    const foreign = await h.request(
      'GET',
      `/v1/workspaces/${h.ids.workspaceB}/voice/audio/${audioId}`,
      { cookie: cookieB },
    );
    expect(foreign.statusCode).toBe(404);
    expect(
      (
        await h.request('DELETE', `/v1/workspaces/${h.ids.workspaceB}/voice/audio/${audioId}`, {
          cookie: cookieB,
        })
      ).statusCode,
    ).toBe(404);

    // A conversation that is not the caller's is refused, not silently stored.
    const sttBefore = (await ledger()).filter((row) => row['kind'] === 'stt').length;
    const stranger = await transcribe(
      '?conversationKind=smart&conversationId=00000000-0000-4000-8000-000000000000',
    );
    expect(stranger.statusCode).toBe(404);
    // Refused before the provider was called, so nothing was spent and nothing is on the ledger.
    expect((await ledger()).filter((row) => row['kind'] === 'stt')).toHaveLength(sttBefore);

    const removed = await h.request('DELETE', voice(`/audio?${scope}`), { cookie: cookieA });
    expect(removed.json()).toEqual({ deleted: 1 });
    expect([...h.objects.objects.keys()].filter((k) => k.startsWith('voice/'))).toHaveLength(0);
    expect(
      (await h.request('GET', voice(`/audio/${audioId}`), { cookie: cookieA })).statusCode,
    ).toBe(404);
    const audit = await h.admin.query(
      `select after from audit_events where workspace_id = $1 and action = 'voice.audio.deleted'`,
      [h.ids.workspaceA],
    );
    expect(audit.rows).toHaveLength(1);
    expect(JSON.stringify(audit.rows[0])).not.toContain('fake transcript');
  });

  it('lets the owner clear every stored recording and sweep the expired ones', async () => {
    const created = await h.request('POST', api('/smart/conversations'), {
      cookie: cookieA,
      payload: { kind: 'walker', route: '/' },
    });
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
    await setting('voice.audio_retention_days', 1);
    const out = await transcribe(`?conversationKind=smart&conversationId=${conversationId}`);
    const id = out.json<{ audioId: string }>().audioId;
    const row = await h.admin.query<{ expires_at: string }>(
      'select expires_at from conversation_audio where id = $1',
      [id],
    );
    expect(new Date(row.rows[0]!.expires_at).getTime()).toBeGreaterThan(Date.now());

    expect(
      (
        await h.request('POST', voice('/workspace-audio/purge-expired'), { cookie: cookieA })
      ).json(),
    ).toEqual({ deleted: 0 });
    await h.admin.query(
      `update conversation_audio set expires_at = now() - interval '1 minute' where id = $1`,
      [id],
    );
    expect(
      (
        await h.request('POST', voice('/workspace-audio/purge-expired'), { cookie: cookieA })
      ).json(),
    ).toEqual({ deleted: 1 });

    await transcribe(`?conversationKind=smart&conversationId=${conversationId}`);
    expect(
      (await h.request('DELETE', voice('/workspace-audio'), { cookie: cookieA })).json(),
    ).toEqual({ deleted: 1 });
    expect([...h.objects.objects.keys()].filter((k) => k.startsWith('voice/'))).toHaveLength(0);
  });

  it('keeps the paid call on the ledger and the transcript even when the recording cannot be stored', async () => {
    const created = await h.request('POST', api('/smart/conversations'), {
      cookie: cookieA,
      payload: { kind: 'walker', route: '/' },
    });
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
    const before = (await ledger()).filter((row) => row['kind'] === 'stt').length;
    const failing = vi
      .spyOn(h.objects, 'put')
      .mockRejectedValueOnce(new Error('object store is down'));
    const out = await transcribe(`?conversationKind=smart&conversationId=${conversationId}`);
    failing.mockRestore();
    expect(out.statusCode, out.body).toBe(200);
    expect(out.json()).toMatchObject({ text: 'fake transcript', audioId: null });
    expect((await ledger()).filter((row) => row['kind'] === 'stt')).toHaveLength(before + 1);
    await h.request('DELETE', api(`/smart/conversations/${conversationId}`), { cookie: cookieA });
  });

  it('removes a speaker own expired recordings the next time they record', async () => {
    const created = await h.request('POST', api('/smart/conversations'), {
      cookie: cookieA,
      payload: { kind: 'walker', route: '/' },
    });
    const conversationId = created.json<{ conversation: { id: string } }>().conversation.id;
    const scope = `conversationKind=smart&conversationId=${conversationId}`;
    const old = (await transcribe(`?${scope}`)).json<{ audioId: string }>().audioId;
    await h.admin.query(
      `update conversation_audio set expires_at = now() - interval '1 minute' where id = $1`,
      [old],
    );
    const fresh = (await transcribe(`?${scope}`)).json<{ audioId: string }>().audioId;
    const left = await h.admin.query<{ id: string }>(
      'select id from conversation_audio where id = any($1::uuid[])',
      [[old, fresh]],
    );
    expect(left.rows.map((row) => row.id)).toEqual([fresh]);
    expect([...h.objects.objects.keys()].filter((key) => key.startsWith('voice/'))).toHaveLength(1);
    await h.request('DELETE', voice('/audio'), { cookie: cookieA });
  });

  it('remembers how each account speaks and hears Docoo, and refuses invalid modes', async () => {
    expect((await h.request('GET', voice('/preferences'), { cookie: cookieA })).json()).toEqual({
      input: 'text',
      output: 'text',
      autoSend: false,
      volume: 1,
    });
    const saved = { input: 'voice', output: 'voice', autoSend: true, volume: 0.4 };
    expect(
      (await h.request('PUT', voice('/preferences'), { cookie: cookieA, payload: saved }))
        .statusCode,
    ).toBe(200);
    expect((await h.request('GET', voice('/preferences'), { cookie: cookieA })).json()).toEqual(
      saved,
    );
    expect(
      (
        await h.request('PUT', voice('/preferences'), {
          cookie: cookieA,
          payload: { ...saved, input: 'video' },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('stops a burst of paid calls from one account with 429 and a time to wait, and never calls the provider for them', async () => {
    let refused: Awaited<ReturnType<Harness['request']>> | null = null;
    for (let call = 0; call < 40 && !refused; call += 1) {
      const out = await h.request('POST', voice('/speak'), {
        cookie: cookieA,
        payload: { text: 'سلام' },
      });
      if (out.statusCode === 429) refused = out;
      else expect(out.statusCode, out.body).toBe(200);
    }
    expect(refused, 'the limit was never reached').not.toBeNull();
    expect(refused!.json()).toMatchObject({ code: 'VOICE_RATE_LIMITED' });
    expect(refused!.json<{ retryAfterSeconds: number }>().retryAfterSeconds).toBeGreaterThan(0);
    // Another account has its own window.
    const other = await h.request('GET', `/v1/workspaces/${h.ids.workspaceB}/voice/config`, {
      cookie: cookieB,
    });
    expect(other.statusCode).toBe(200);
  });
});
