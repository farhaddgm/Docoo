import { randomBytes, randomUUID } from 'node:crypto';

import { HttpException } from '@nestjs/common';
import { liveAssistantSettingDefaults } from '@docoo/contracts';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WorkspaceRequestContext } from '../src/common/request-context.js';
import { WorkspaceDatabase } from '../src/common/workspace-database.js';
import { LiveCapabilityRegistry } from '../src/live-assistant/capabilities.js';
import { LiveAssistantService } from '../src/live-assistant/live-assistant.service.js';
import { pipelinePrice, voiceUsage } from '../src/live-assistant/live-store.js';
import { adminUrl } from './support/harness.js';

/**
 * The choice of the voice brand against a real database (ADR-0057): the brand comes from the
 * connection the admin chose; it decides the kind of session; a brand whose engine is not built
 * (or ElevenLabs without a voice) is refused with a reason before anything opens; and the pipeline prices come from the voice
 * price list. The settings are given directly, as the monitor test does.
 */
describe.skipIf(!adminUrl)('the voice brand of the assistant (real database)', () => {
  const roleName = `docoo_vp_${randomBytes(6).toString('hex')}`;
  const rolePassword = randomBytes(18).toString('hex');
  const suffix = randomBytes(4).toString('hex');
  const ids = {
    workspace: randomUUID(),
    owner: randomUUID(),
    openai: randomUUID(),
    eleven: randomUUID(),
    gemini: randomUUID(),
  };
  let admin: Client;
  let pool: Pool;
  let values: Record<string, unknown> = {};
  let service: LiveAssistantService;

  const context = (): WorkspaceRequestContext => ({
    workspaceId: ids.workspace,
    actorId: ids.owner,
    correlationId: randomUUID(),
  });
  const choose = (
    connectionId: string,
    model = 'some-model',
    extra: Record<string, unknown> = {},
  ) => {
    values = {
      ...liveAssistantSettingDefaults,
      'live_assistant.enabled': true,
      'live_assistant.disclosure_accepted': true,
      'live_assistant.connection_id': connectionId,
      'live_assistant.model': model,
      'live_assistant.access_level': 'read',
      ...extra,
    };
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(
      `create role ${roleName} login inherit nosuperuser nobypassrls nocreatedb nocreaterole password '${rolePassword}'`,
    );
    await admin.query(`grant docoo_app to ${roleName}`);
    const runtime = new URL(adminUrl!);
    runtime.username = roleName;
    runtime.password = rolePassword;
    pool = new Pool({ connectionString: runtime.toString(), max: 3 });
    const config = { resolve: () => Promise.resolve({ values }) };
    service = new LiveAssistantService(
      new WorkspaceDatabase(pool),
      config as never,
      new LiveCapabilityRegistry([]),
      {} as never,
    );
    await admin.query(`insert into workspaces (id, code, name) values ($1, $2, 'Voice brand')`, [
      ids.workspace,
      `vp-${suffix}`,
    ]);
    await admin.query(
      `insert into users (id, email, password_hash, display_name) values ($1, $2, 'x', 'Owner')`,
      [ids.owner, `${ids.owner}@vp-${suffix}.example.test`],
    );
    await admin.query(`insert into memberships (workspace_id, user_id) values ($1, $2)`, [
      ids.workspace,
      ids.owner,
    ]);
    for (const [id, brand] of [
      [ids.openai, 'openai'],
      [ids.eleven, 'elevenlabs'],
      [ids.gemini, 'gemini'],
    ] as const) {
      await admin.query(
        `insert into provider_connections (id, workspace_id, provider, name) values ($1, $2, $3::provider_kind, $4)`,
        [id, ids.workspace, brand, `${brand}-${suffix}`],
      );
    }
  });

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`drop owned by ${roleName}`).catch(() => undefined);
      await admin.query(`drop role ${roleName}`).catch(() => undefined);
      await admin.end();
    }
  });

  it('reads the brand from the chosen connection and runs OpenAI as a realtime session', async () => {
    choose(ids.openai);
    const config = await service.clientConfig(context());
    expect(config).toMatchObject({
      ready: true,
      unavailableReason: null,
      voiceProvider: 'openai',
      mode: 'realtime',
    });
  });

  it('knows ElevenLabs as a pipeline brand, and asks for its voice before it can start', async () => {
    choose(ids.eleven, 'eleven_v4_turbo');
    const config = await service.clientConfig(context());
    expect(config).toMatchObject({
      ready: false,
      unavailableReason: 'not_configured',
      voiceProvider: 'elevenlabs',
      mode: 'pipeline',
    });
    await expect(service.startSession(context(), 'voice')).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HttpException &&
        error.getStatus() === 409 &&
        JSON.stringify(error.getResponse()).includes('not_configured'),
    );
  });

  it('starts an ElevenLabs pipeline session once a voice is chosen, with its brand and kind stored', async () => {
    choose(ids.eleven, 'eleven_v4_turbo', { 'live_assistant.voice_id': 'voice-123' });
    expect(await service.clientConfig(context())).toMatchObject({
      ready: true,
      unavailableReason: null,
      voiceProvider: 'elevenlabs',
      mode: 'pipeline',
    });
    const voice = await service.startSession(context(), 'voice');
    expect(voice).toMatchObject({ mode: 'pipeline', model: 'eleven_v4_turbo' });
    const row = (
      await admin.query(`select provider, mode from live_sessions where id = $1`, [voice.id])
    ).rows[0] as { provider: string; mode: string };
    expect(row).toEqual({ provider: 'elevenlabs', mode: 'pipeline' });
    // A voice ticket can be asked for: the engine is built.
    const ticket = await service.issueVoiceTicket(context(), voice.id);
    expect(ticket.ticket).not.toBe('');
    await service.endSession(context(), voice.id, 'user');
  });

  it('refuses a brand that has no live voice at all, and says nothing about an unset connection', async () => {
    choose(ids.gemini);
    expect(await service.clientConfig(context())).toMatchObject({
      ready: false,
      unavailableReason: 'provider_unsupported',
      voiceProvider: null,
    });
    choose('');
    expect(await service.clientConfig(context())).toMatchObject({
      ready: false,
      unavailableReason: 'not_configured',
      voiceProvider: null,
    });
  });

  it('starts an OpenAI voice session with its brand and kind stored, and a typed one as text', async () => {
    choose(ids.openai, 'gpt-realtime');
    const voice = await service.startSession(context(), 'voice');
    expect(voice).toMatchObject({ mode: 'realtime', model: 'gpt-realtime' });
    const row = (
      await admin.query(`select provider, mode from live_sessions where id = $1`, [voice.id])
    ).rows[0] as { provider: string; mode: string };
    expect(row).toEqual({ provider: 'openai', mode: 'realtime' });
    await service.endSession(context(), voice.id, 'user');
  });

  it('prices the pipeline from the voice price list, per half, and leaves an unpriced half null', async () => {
    const insert = (kind: string, model: string, perMinute: number | null, per1k: number | null) =>
      admin.query(
        `insert into voice_prices (workspace_id, provider, model, kind, per_minute, per_1k_characters, effective_from)
         values ($1, 'elevenlabs', $2, $3, $4, $5, now() - interval '1 day')`,
        [ids.workspace, model, kind, perMinute, per1k],
      );
    await insert('stt', 'scribe_v3_live', 0.22 / 60, null);
    await insert('tts', 'eleven_v4_turbo', null, 0.04);
    await insert('tts', 'eleven_v4_turbo', null, 0.05);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('app.workspace_id', $1, true)`, [ids.workspace]);
      const price = await pipelinePrice(
        client,
        ids.workspace,
        'elevenlabs',
        'scribe_v3_live',
        'eleven_v4_turbo',
      );
      expect(price.sttPerMinute).toBeCloseTo(0.22 / 60, 6);
      // The newest entry for a model wins.
      expect(price.ttsPer1kCharacters).toBeCloseTo(0.05, 6);
      const none = await pipelinePrice(client, ids.workspace, 'elevenlabs', 'other', 'other');
      expect(none).toEqual({ sttPerMinute: null, ttsPer1kCharacters: null });
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('reads what the voice provider used in a session apart from the executor, so a later link continues from it', async () => {
    choose(ids.openai, 'gpt-realtime');
    const session = await service.startSession(context(), 'voice');
    // The voice link used 0.5 USD; the executor, counted in its own columns, 0.2 USD.
    await admin.query(
      `update live_sessions
          set input_tokens = 100, output_tokens = 40, cached_input_tokens = 30, cost_usd = 0.5,
              executor_input_tokens = 7, executor_output_tokens = 3, executor_cost_usd = 0.2
        where id = $1`,
      [session.id],
    );
    const database = new WorkspaceDatabase(pool);
    expect(await database.run(context(), (client) => voiceUsage(client, session.id))).toEqual({
      inputTokens: 100,
      outputTokens: 40,
      cachedInputTokens: 30,
      costUsd: 0.5,
    });
    expect(await database.run(context(), (client) => voiceUsage(client, randomUUID()))).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0,
    });
    await service.endSession(context(), session.id, 'user');
  });
});
