import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  defaultVoicePreferences,
  voiceBrands,
  type VoiceBrand,
  type VoiceClientConfig,
  type VoiceConversationKind,
  type VoicePreferences,
} from '@docoo/contracts';
import type { ObjectStore } from '@docoo/ingestion';
import { ProviderRuntime } from '@docoo/orchestration';
import {
  audioSignatureMatches,
  AUDIO_MIME_TYPES,
  ProviderError,
  sanitizeError,
  type AudioMimeType,
  type SpeechKind,
  type SpeechProviderAdapter,
  type SpeechUsage,
} from '@docoo/providers';
import type { PoolClient, QueryResultRow } from 'pg';

import { writeAudit } from '../common/audit.js';
import { isoColumn } from '../common/pagination.js';
import { badRequest, conflict, notFound, unprocessable } from '../common/problems.js';
import type { WorkspaceRequestContext } from '../common/request-context.js';
import { WorkspaceDatabase } from '../common/workspace-database.js';
import { ConfigService } from '../config/config.service.js';
import { PROVIDER_RUNTIME } from '../providers/providers.service.js';
import { OBJECT_STORE } from '../sources/ingestion.providers.js';
import { textToSpeak, voiceCostUsd, type VoicePrice } from './voice-pricing.js';

/** Below the 30 s proxy timeout of the web rewrite, so a slow provider fails visibly. */
const PROVIDER_TIMEOUT_MS = 25_000;
/** A recording longer than the limit by this much is refused; the browser's clock is not exact. */
const RECORD_SLACK_S = 3;

export interface VoiceSettings {
  readonly enabled: boolean;
  readonly provider: VoiceBrand;
  readonly connectionId: string | null;
  readonly sttModel: string;
  readonly ttsModel: string;
  readonly voiceId: string;
  readonly speed: number;
  readonly languageHint: 'auto' | 'fa' | 'en';
  readonly maxRecordSeconds: number;
  readonly maxTtsCharacters: number;
  readonly storeAdminAudio: boolean;
  readonly retentionDays: number;
}

interface Resolved {
  readonly settings: VoiceSettings;
  readonly adapter: SpeechProviderAdapter;
  readonly connectionId: string;
  readonly brand: 'openai' | 'elevenlabs' | 'fake';
}

interface AudioRow extends QueryResultRow {
  id: string;
  object_key: string;
}

export interface VoiceCallScope {
  readonly conversationKind?: VoiceConversationKind | undefined;
  readonly conversationId?: string | undefined;
  readonly messageId?: string | undefined;
}

const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const flag = (value: unknown): boolean => value === true;
const count = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export function extensionFor(mime: AudioMimeType): string {
  return {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'mp4',
    'audio/wav': 'wav',
    'audio/mpeg': 'mp3',
  }[mime];
}

export function audioMimeOf(contentType: string | undefined): AudioMimeType | null {
  const type = contentType?.split(';')[0]?.trim().toLowerCase();
  return AUDIO_MIME_TYPES.find((mime) => mime === type) ?? null;
}

/** Voice conversation (ADR-0046): speech to text and text to speech around the text chat. */
@Injectable()
export class VoiceService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly config: ConfigService,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
    @Inject(OBJECT_STORE) private readonly objects: ObjectStore | null,
  ) {}

  // ---- settings and configuration -------------------------------------------------------

  async settings(client: PoolClient, context: WorkspaceRequestContext): Promise<VoiceSettings> {
    const values = (await this.config.resolve(client, context, 'workspace', context.workspaceId))
      .values;
    const provider = voiceBrands.find((brand) => brand === values['voice.provider']) ?? 'openai';
    const hint = values['voice.language_hint'];
    return {
      enabled: flag(values['voice.enabled']),
      provider,
      connectionId: text(values['voice.connection_id']) || null,
      sttModel: text(values['voice.stt_model']),
      ttsModel: text(values['voice.tts_model']),
      voiceId: text(values['voice.voice_id']),
      speed: count(values['voice.speed'], 1),
      languageHint: hint === 'fa' || hint === 'en' ? hint : 'auto',
      maxRecordSeconds: count(values['voice.max_record_s'], 120),
      maxTtsCharacters: count(values['voice.max_tts_chars'], 4000),
      storeAdminAudio: flag(values['voice.store_admin_audio']),
      retentionDays: count(values['voice.audio_retention_days'], 30),
    };
  }

  /** The connection voice uses: the one named in the settings, else the newest usable one of the brand. */
  private async connectionFor(client: PoolClient, settings: VoiceSettings): Promise<string | null> {
    if (settings.connectionId) return settings.connectionId;
    const row = (
      await client.query<{ id: string }>(
        `select id from provider_connections
          where provider = $1::provider_kind and disabled_at is null and status <> 'unconfigured'
          order by created_at desc limit 1`,
        [settings.provider],
      )
    ).rows[0];
    return row?.id ?? null;
  }

  async clientConfig(context: WorkspaceRequestContext): Promise<VoiceClientConfig> {
    return this.database.run(context, async (client) => {
      const settings = await this.settings(client, context);
      const connectionId = settings.enabled ? await this.connectionFor(client, settings) : null;
      const configured = Boolean(
        connectionId && settings.sttModel && settings.ttsModel && settings.voiceId,
      );
      return {
        enabled: settings.enabled,
        unavailableReason: !settings.enabled ? 'disabled' : configured ? null : 'not_configured',
        provider: settings.provider,
        speed: settings.speed,
        maxRecordSeconds: settings.maxRecordSeconds,
        maxTtsCharacters: settings.maxTtsCharacters,
        storesAdminAudio: settings.storeAdminAudio,
      };
    });
  }

  /** Settings, a usable connection and its adapter; refuses with the reason when voice cannot run. */
  private async resolve(
    context: WorkspaceRequestContext,
    need: SpeechKind | 'catalog',
  ): Promise<Resolved> {
    return this.database.run(context, async (client) => {
      const settings = await this.settings(client, context);
      if (need !== 'catalog' && !settings.enabled)
        throw conflict(
          'VOICE_DISABLED',
          'Voice conversation is switched off in the system settings.',
        );
      const connectionId = await this.connectionFor(client, settings);
      const missingModel =
        need === 'stt'
          ? !settings.sttModel
          : need === 'tts'
            ? !settings.ttsModel || !settings.voiceId
            : false;
      if (!connectionId || missingModel)
        throw conflict(
          'VOICE_NOT_CONFIGURED',
          'Choose the voice provider connection, the model and the voice in the system settings.',
        );
      const { adapter, connection } = await this.runtime
        .speechAdapterFor(client, connectionId)
        .catch((error: unknown) => {
          throw conflict(
            'VOICE_NOT_CONFIGURED',
            error instanceof ProviderError ? error.message : 'No usable connection.',
          );
        });
      return { settings, adapter, connectionId, brand: connection.provider as Resolved['brand'] };
    });
  }

  // ---- catalog and preview (system settings page) ------------------------------------

  async catalog(context: WorkspaceRequestContext, brand: VoiceBrand | undefined) {
    const resolved = await this.database.run(context, async (client) => {
      const settings = await this.settings(client, context);
      const wanted = brand ?? settings.provider;
      const connectionId =
        brand && brand !== settings.provider
          ? await this.connectionFor(client, { ...settings, provider: brand, connectionId: null })
          : await this.connectionFor(client, settings);
      if (!connectionId)
        throw conflict('VOICE_NOT_CONFIGURED', `Add a ${wanted} provider connection first.`);
      return (await this.runtime.speechAdapterFor(client, connectionId)).adapter;
    });
    try {
      const [models, voices] = await Promise.all([resolved.listModels(), resolved.listVoices()]);
      return { provider: resolved.kind, models, voices };
    } catch (error) {
      throw this.providerFailure(error);
    }
  }

  /** A short sample in the chosen voice, so the owner can hear it before saving the setting. */
  async preview(
    context: WorkspaceRequestContext,
    input: {
      text: string;
      voiceId?: string | undefined;
      model?: string | undefined;
      speed?: number | undefined;
    },
  ) {
    const resolved = await this.resolve(context, 'catalog');
    const model = input.model ?? resolved.settings.ttsModel;
    const voiceId = input.voiceId ?? resolved.settings.voiceId;
    if (!model || !voiceId)
      throw badRequest('VOICE_INVALID_REQUEST', 'Choose a speech model and a voice to preview.');
    return this.speakWith(
      context,
      resolved,
      { text: input.text, model, voiceId, speed: input.speed ?? resolved.settings.speed },
      {},
    );
  }

  // ---- speech to text ------------------------------------------------------------------

  async transcribe(
    context: WorkspaceRequestContext,
    input: {
      audio: Uint8Array;
      mimeType: AudioMimeType;
      locale: 'fa' | 'en';
      durationMs?: number | undefined;
      scope: VoiceCallScope;
    },
  ) {
    if (input.audio.byteLength === 0 || !audioSignatureMatches(input.mimeType, input.audio))
      throw unprocessable(
        'VOICE_AUDIO_INVALID',
        'The recording is empty or is not the audio format it claims.',
      );
    const resolved = await this.resolve(context, 'stt');
    const { settings } = resolved;
    if (
      input.durationMs !== undefined &&
      input.durationMs / 1000 > settings.maxRecordSeconds + RECORD_SLACK_S
    )
      throw unprocessable(
        'VOICE_AUDIO_TOO_LONG',
        `A recording can be at most ${settings.maxRecordSeconds} seconds.`,
      );
    const language = settings.languageHint === 'auto' ? input.locale : settings.languageHint;
    const started = performance.now();
    let result;
    try {
      result = await resolved.adapter.transcribe({
        model: settings.sttModel,
        audio: input.audio,
        mimeType: input.mimeType,
        language,
        durationMsHint: input.durationMs ?? null,
        timeoutMs: PROVIDER_TIMEOUT_MS,
      });
    } catch (error) {
      await this.record(context, resolved, 'stt', settings.sttModel, null, input.scope, {
        failure: error,
        latencyMs: Math.round(performance.now() - started),
      });
      throw this.providerFailure(error);
    }
    const audioId = await this.database.run(context, async (client) => {
      await this.record(context, resolved, 'stt', settings.sttModel, null, input.scope, {
        result,
        client,
      });
      return settings.storeAdminAudio
        ? this.storeRecording(client, context, settings, input, result.durationMs)
        : null;
    });
    return { text: result.text, language: result.language, durationMs: result.durationMs, audioId };
  }

  // ---- text to speech -------------------------------------------------------------------

  async speak(context: WorkspaceRequestContext, input: { text: string; scope: VoiceCallScope }) {
    const resolved = await this.resolve(context, 'tts');
    const { settings } = resolved;
    return this.speakWith(
      context,
      resolved,
      {
        text: input.text,
        model: settings.ttsModel,
        voiceId: settings.voiceId,
        speed: settings.speed,
      },
      input.scope,
    );
  }

  private async speakWith(
    context: WorkspaceRequestContext,
    resolved: Resolved,
    input: { text: string; model: string; voiceId: string; speed: number },
    scope: VoiceCallScope,
  ) {
    const spoken = textToSpeak(input.text, resolved.settings.maxTtsCharacters);
    if (spoken.text.length === 0)
      throw unprocessable('VOICE_NOTHING_TO_SAY', 'There is no text to read aloud.');
    const started = performance.now();
    let result;
    try {
      result = await resolved.adapter.synthesize({
        model: input.model,
        voiceId: input.voiceId,
        text: spoken.text,
        speed: input.speed,
        language: resolved.settings.languageHint === 'auto' ? null : resolved.settings.languageHint,
        timeoutMs: PROVIDER_TIMEOUT_MS,
      });
    } catch (error) {
      await this.record(context, resolved, 'tts', input.model, input.voiceId, scope, {
        failure: error,
        latencyMs: Math.round(performance.now() - started),
      });
      throw this.providerFailure(error);
    }
    await this.database.run(context, (client) =>
      this.record(context, resolved, 'tts', input.model, input.voiceId, scope, { result, client }),
    );
    return { audio: result.audio, mimeType: result.mimeType, truncated: spoken.truncated };
  }

  // ---- ledger ---------------------------------------------------------------------------

  private async price(
    client: PoolClient,
    context: WorkspaceRequestContext,
    brand: string,
    model: string,
    kind: SpeechKind,
  ): Promise<(VoicePrice & { id: string }) | null> {
    const row = (
      await client.query<{
        id: string;
        per_minute: number | null;
        per_1k_characters: number | null;
        input_per_million: number | null;
        output_per_million: number | null;
      }>(
        `select id, per_minute, per_1k_characters, input_per_million, output_per_million
           from voice_prices
          where workspace_id = $1 and provider = $2::provider_kind and model = $3 and kind = $4
            and effective_from <= now()
          order by effective_from desc, created_at desc limit 1`,
        [context.workspaceId, brand, model, kind],
      )
    ).rows[0];
    return row
      ? {
          id: row.id,
          perMinute: row.per_minute,
          per1kCharacters: row.per_1k_characters,
          inputPerMillion: row.input_per_million,
          outputPerMillion: row.output_per_million,
        }
      : null;
  }

  /** Every call is written to the voice ledger, failed ones too, in their own transaction when no client is given. */
  private async record(
    context: WorkspaceRequestContext,
    resolved: Resolved,
    kind: SpeechKind,
    model: string,
    voiceId: string | null,
    scope: VoiceCallScope,
    outcome:
      | {
          result: { usage: SpeechUsage; latencyMs: number; providerRequestId: string | null };
          client: PoolClient;
        }
      | { failure: unknown; latencyMs: number },
  ): Promise<void> {
    const write = async (client: PoolClient) => {
      const ok = 'result' in outcome;
      const usage: SpeechUsage = ok
        ? outcome.result.usage
        : { audioSeconds: null, characters: null, inputTokens: 0, outputTokens: 0 };
      const price = ok ? await this.price(client, context, resolved.brand, model, kind) : null;
      const failure = ok ? null : outcome.failure instanceof ProviderError ? outcome.failure : null;
      const permanent =
        failure?.kind === 'auth' ||
        failure?.kind === 'invalid_request' ||
        failure?.kind === 'permanent';
      const status = ok ? 'succeeded' : permanent ? 'permanent_failed' : 'transient_failed';
      await client.query(
        `insert into voice_invocations (workspace_id, connection_id, provider, kind, model, voice_id, actor_id,
           conversation_kind, conversation_id, message_id, status, audio_seconds, characters, input_tokens,
           output_tokens, cost_usd, price_id, latency_ms, provider_request_id, error_code)
         values ($1,$2,$3::provider_kind,$4,$5,$6,$7,$8,$9,$10,$11::invocation_status,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          context.workspaceId,
          resolved.connectionId,
          resolved.brand,
          kind,
          model,
          voiceId,
          context.actorId,
          scope.conversationKind ?? null,
          scope.conversationId ?? null,
          scope.messageId ?? null,
          status,
          usage.audioSeconds,
          usage.characters,
          usage.inputTokens,
          usage.outputTokens,
          ok ? voiceCostUsd(kind, usage, price) : null,
          price?.id ?? null,
          ok ? outcome.result.latencyMs : outcome.latencyMs,
          ok ? outcome.result.providerRequestId : null,
          ok ? null : (failure?.message ?? 'voice_call_failed'),
        ],
      );
    };
    if ('client' in outcome) await write(outcome.client);
    else await this.database.run(context, write);
  }

  // ---- stored recordings ----------------------------------------------------------------

  /** The conversation must exist and be the speaker's own (Smart) or inside the workspace (a stage run). */
  private async assertConversation(
    client: PoolClient,
    context: WorkspaceRequestContext,
    kind: VoiceConversationKind,
    id: string,
  ): Promise<void> {
    const table = kind === 'smart' ? 'smart_conversations' : kind === 'stage' ? 'stage_runs' : null;
    if (!table)
      throw badRequest(
        'VOICE_INVALID_REQUEST',
        'Recordings are not kept for this kind of conversation.',
      );
    const found = await client.query(`select 1 from ${table} where id = $1 and workspace_id = $2`, [
      id,
      context.workspaceId,
    ]);
    if (found.rowCount === 0)
      throw notFound('VOICE_CONVERSATION_NOT_FOUND', 'The conversation was not found.');
  }

  private async storeRecording(
    client: PoolClient,
    context: WorkspaceRequestContext,
    settings: VoiceSettings,
    input: { audio: Uint8Array; mimeType: AudioMimeType; scope: VoiceCallScope },
    durationMs: number | null,
  ): Promise<string | null> {
    const { conversationKind, conversationId } = input.scope;
    if (!this.objects || !conversationKind || !conversationId) return null;
    await this.assertConversation(client, context, conversationKind, conversationId);
    const key = `voice/${context.workspaceId}/${context.actorId}/${randomUUID()}.${extensionFor(input.mimeType)}`;
    await this.objects.put(key, input.audio, input.mimeType);
    try {
      const row = (
        await client.query<{ id: string }>(
          `insert into conversation_audio (workspace_id, user_id, conversation_kind, conversation_id, message_id,
             object_key, mime, bytes, duration_ms, expires_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9, case when $10::int > 0 then now() + make_interval(days => $10::int) end)
           returning id`,
          [
            context.workspaceId,
            context.actorId,
            conversationKind,
            conversationId,
            input.scope.messageId ?? null,
            key,
            input.mimeType,
            input.audio.byteLength,
            durationMs ?? 0,
            settings.retentionDays,
          ],
        )
      ).rows[0]!;
      return row.id;
    } catch (error) {
      await this.objects.delete(key).catch(() => undefined);
      throw error;
    }
  }

  /** The recording's message link is set once the message exists (the chat saves the text after the transcript). */
  async attachAudio(context: WorkspaceRequestContext, audioId: string, messageId: string) {
    await this.database.run(context, async (client) => {
      const done = await client.query(
        `update conversation_audio set message_id = $2 where id = $1 and message_id is null`,
        [audioId, messageId],
      );
      if (done.rowCount === 0)
        throw notFound('VOICE_AUDIO_NOT_FOUND', 'The recording was not found.');
    });
  }

  async listAudio(context: WorkspaceRequestContext, scope: VoiceCallScope) {
    return this.database.run(context, async (client) => ({
      items: (
        await client.query(
          `select id, conversation_kind as "conversationKind", conversation_id as "conversationId",
                  message_id as "messageId", mime, bytes, duration_ms as "durationMs",
                  ${isoColumn('expires_at', 'expiresAt')}, ${isoColumn('created_at', 'createdAt')}
             from conversation_audio
            where user_id = $1 and ($2::text is null or conversation_kind = $2)
              and ($3::uuid is null or conversation_id = $3)
            order by created_at desc limit 200`,
          [context.actorId, scope.conversationKind ?? null, scope.conversationId ?? null],
        )
      ).rows,
    }));
  }

  async audioBytes(context: WorkspaceRequestContext, id: string) {
    const row = await this.database.run(
      context,
      async (client) =>
        (
          await client.query<AudioRow & { mime: string }>(
            'select id, object_key, mime from conversation_audio where id = $1 and user_id = $2',
            [id, context.actorId],
          )
        ).rows[0],
    );
    if (!row || !this.objects)
      throw notFound('VOICE_AUDIO_NOT_FOUND', 'The recording was not found.');
    const bytes = await this.objects.get(row.object_key, 12 * 1024 * 1024).catch(() => {
      throw notFound('VOICE_AUDIO_NOT_FOUND', 'The recording was not found.');
    });
    return { bytes, mime: row.mime };
  }

  /** Removes the files first and the rows after; a file that is already gone does not stop the rest. */
  private async removeRows(client: PoolClient, rows: readonly AudioRow[]): Promise<number> {
    for (const row of rows) await this.objects?.delete(row.object_key).catch(() => undefined);
    if (rows.length > 0)
      await client.query('delete from conversation_audio where id = any($1::uuid[])', [
        rows.map((row) => row.id),
      ]);
    return rows.length;
  }

  /** `mine`: the speaker's own, optionally of one message or one conversation. `workspace`: the owner clears all. */
  async deleteAudio(
    context: WorkspaceRequestContext,
    target:
      | { kind: 'one'; id: string }
      | { kind: 'conversation'; conversationKind: VoiceConversationKind; conversationId: string }
      | { kind: 'mine' }
      | { kind: 'workspace' }
      | { kind: 'expired' },
  ) {
    return this.database.run(context, async (client) => {
      const where =
        target.kind === 'one'
          ? { sql: 'user_id = $1 and id = $2', args: [context.actorId, target.id] }
          : target.kind === 'conversation'
            ? {
                sql: 'user_id = $1 and conversation_kind = $2 and conversation_id = $3',
                args: [context.actorId, target.conversationKind, target.conversationId],
              }
            : target.kind === 'mine'
              ? { sql: 'user_id = $1', args: [context.actorId] }
              : target.kind === 'expired'
                ? {
                    sql: 'workspace_id = $1 and expires_at is not null and expires_at <= now()',
                    args: [context.workspaceId],
                  }
                : { sql: 'workspace_id = $1', args: [context.workspaceId] };
      const rows = (
        await client.query<AudioRow>(
          `select id, object_key from conversation_audio where ${where.sql} for update`,
          where.args,
        )
      ).rows;
      if (target.kind === 'one' && rows.length === 0)
        throw notFound('VOICE_AUDIO_NOT_FOUND', 'The recording was not found.');
      const deleted = await this.removeRows(client, rows);
      if (deleted > 0)
        await writeAudit(client, context, {
          action: 'voice.audio.deleted',
          targetType: 'conversation_audio',
          targetId: target.kind === 'one' ? target.id : null,
          after: { scope: target.kind, count: deleted },
        });
      return { deleted };
    });
  }

  // ---- preferences ----------------------------------------------------------------------

  async preferences(context: WorkspaceRequestContext): Promise<VoicePreferences> {
    return this.database.run(context, async (client) => {
      const row = (
        await client.query<{
          input_mode: 'text' | 'voice';
          output_mode: 'text' | 'voice';
          auto_send: boolean;
          volume: number;
        }>(
          'select input_mode, output_mode, auto_send, volume from voice_preferences where user_id = $1',
          [context.actorId],
        )
      ).rows[0];
      return row
        ? {
            input: row.input_mode,
            output: row.output_mode,
            autoSend: row.auto_send,
            volume: row.volume,
          }
        : defaultVoicePreferences;
    });
  }

  async setPreferences(
    context: WorkspaceRequestContext,
    input: VoicePreferences,
  ): Promise<VoicePreferences> {
    await this.database.run(context, (client) =>
      client.query(
        `insert into voice_preferences (user_id, input_mode, output_mode, auto_send, volume)
         values ($1,$2,$3,$4,$5)
         on conflict (user_id) do update set input_mode = excluded.input_mode, output_mode = excluded.output_mode,
           auto_send = excluded.auto_send, volume = excluded.volume, updated_at = now()`,
        [context.actorId, input.input, input.output, input.autoSend, input.volume],
      ),
    );
    return input;
  }

  // ---- usage report and prices ----------------------------------------------------------

  /** Voice usage apart from the cost of the text model; `all` is the owner's view of every account. */
  async usage(context: WorkspaceRequestContext, options: { all: boolean; days: number }) {
    return this.database.run(context, async (client) => {
      const args = [context.workspaceId, options.all ? null : context.actorId, options.days];
      const filter = `workspace_id = $1 and ($2::uuid is null or actor_id = $2)
                      and created_at >= now() - make_interval(days => $3::int)`;
      const totals = (
        await client.query(
          `select kind, provider, model, count(*)::int as calls,
                  count(*) filter (where status <> 'succeeded')::int as failed,
                  coalesce(sum(audio_seconds), 0)::float8 as "audioSeconds",
                  coalesce(sum(characters), 0)::int as characters,
                  coalesce(sum(input_tokens), 0)::int as "inputTokens",
                  coalesce(sum(output_tokens), 0)::int as "outputTokens",
                  coalesce(sum(cost_usd), 0)::float8 as "costUsd",
                  count(*) filter (where status = 'succeeded' and price_id is null)::int as unpriced
             from voice_invocations where ${filter}
            group by kind, provider, model order by "costUsd" desc, calls desc`,
          args,
        )
      ).rows;
      const days = (
        await client.query(
          `select to_char(date_trunc('day', created_at at time zone 'utc'), 'YYYY-MM-DD') as day, kind,
                  count(*)::int as calls, coalesce(sum(cost_usd), 0)::float8 as "costUsd"
             from voice_invocations where ${filter}
            group by 1, kind order by 1`,
          args,
        )
      ).rows;
      const users = options.all
        ? (
            await client.query(
              `select actor_id as "userId", count(*)::int as calls, coalesce(sum(cost_usd), 0)::float8 as "costUsd"
                 from voice_invocations where ${filter} group by actor_id order by "costUsd" desc limit 100`,
              args,
            )
          ).rows
        : [];
      return { days: options.days, totals, byDay: days, byUser: users };
    });
  }

  async listPrices(context: WorkspaceRequestContext) {
    return this.database.run(context, async (client) => ({
      items: (
        await client.query(
          `select id, provider, model, kind, per_minute as "perMinute", per_1k_characters as "per1kCharacters",
                  input_per_million as "inputPerMillion", output_per_million as "outputPerMillion",
                  ${isoColumn('effective_from', 'effectiveFrom')}
             from voice_prices where workspace_id = $1 order by effective_from desc, created_at desc limit 200`,
          [context.workspaceId],
        )
      ).rows,
    }));
  }

  async addPrice(
    context: WorkspaceRequestContext,
    input: {
      provider: VoiceBrand;
      model: string;
      kind: SpeechKind;
      perMinute?: number | undefined;
      per1kCharacters?: number | undefined;
      inputPerMillion?: number | undefined;
      outputPerMillion?: number | undefined;
      effectiveFrom: string;
    },
  ) {
    return this.database.run(context, async (client) => {
      const row = (
        await client.query<{ id: string }>(
          `insert into voice_prices (workspace_id, provider, model, kind, per_minute, per_1k_characters,
             input_per_million, output_per_million, effective_from, created_by)
           values ($1,$2::provider_kind,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [
            context.workspaceId,
            input.provider,
            input.model,
            input.kind,
            input.perMinute ?? null,
            input.per1kCharacters ?? null,
            input.inputPerMillion ?? null,
            input.outputPerMillion ?? null,
            input.effectiveFrom,
            context.actorId,
          ],
        )
      ).rows[0]!;
      await writeAudit(client, context, {
        action: 'voice.price.add',
        targetType: 'voice_price',
        targetId: row.id,
        after: { provider: input.provider, model: input.model, kind: input.kind },
      });
      return { id: row.id };
    });
  }

  private providerFailure(error: unknown): Error {
    if (error instanceof ProviderError) {
      const code = error.kind === 'timeout' ? 'VOICE_PROVIDER_TIMEOUT' : 'VOICE_PROVIDER_ERROR';
      return conflict(code, sanitizeError(error.message), { reason: error.kind });
    }
    return conflict('VOICE_PROVIDER_ERROR', 'The voice provider failed.');
  }
}
