'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, apiGet, apiSend } from '../api-client';
import type { Locale } from '../i18n';
import { voiceApi, type VoiceInfo, type VoiceModelInfo } from './voice-api';
import { problemFor } from './voice-helpers';
import { fillText, voiceMessages } from './voice-messages';

const KEYS = [
  'voice.enabled',
  'voice.provider',
  'voice.connection_id',
  'voice.stt_model',
  'voice.tts_model',
  'voice.voice_id',
  'voice.speed',
  'voice.language_hint',
  'voice.max_record_s',
  'voice.max_tts_chars',
  'voice.store_admin_audio',
  'voice.audio_retention_days',
] as const;
type Key = (typeof KEYS)[number];
type Draft = Record<Key, unknown>;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;

interface Connection {
  id: string;
  provider: string;
  name: string;
  status: string;
}

const copy = {
  fa: {
    title: 'گفتگوی صوتی',
    intro:
      'ضبط صدا و پاسخ صوتی در جعبه‌های گفتگو. صدا به سرویس‌دهنده بیرونی فرستاده می‌شود و هزینه آن جدا از مدل متنی در گزارش هزینه‌ها می‌آید.',
    enabled: 'گفتگوی صوتی فعال باشد',
    brand: 'برند سرویس‌دهنده',
    connection: 'اتصال',
    auto: 'خودکار (تازه‌ترین اتصال این برند)',
    load: 'خواندن مدل‌ها و صداها از سرویس‌دهنده',
    loading: 'در حال خواندن…',
    stt: 'مدل تبدیل گفتار به متن',
    tts: 'مدل تبدیل متن به گفتار',
    voice: 'صدا',
    pick: '— انتخاب کنید —',
    preview: 'پیش‌شنیدن',
    previewText: 'سلام، من داکو هستم. این نمونه‌ای از صدای من است.',
    speed: 'سرعت پخش',
    language: 'زبان گفتار',
    langAuto: 'خودکار (زبان رابط)',
    maxRecord: 'حداکثر مدت ضبط (ثانیه)',
    maxChars: 'حداکثر نویسه در یک پخش',
    store: 'صدای ادمین در هر گفتگو ذخیره شود',
    retention: 'مدت نگهداری صدا (روز؛ ۰ تا حذف دستی)',
    save: 'ذخیره',
    saved: 'ذخیره شد.',
    nothing: 'تغییری برای ذخیره نیست.',
    cleanup: 'پاک‌سازی صداهای ذخیره‌شده',
    purgeExpired: 'پاک کردن صداهای منقضی',
    deleteAll: 'پاک کردن همه صداهای سامانه',
    confirm: 'مطمئن هستید؟ این کار برگشت‌پذیر نیست. دوباره بزنید.',
    deleted: '{n} صدا پاک شد.',
    noConnection: 'برای این برند هنوز اتصالی در «ارائه‌دهنده‌ها» ساخته نشده است.',
    failed: 'ذخیره یا خواندن انجام نشد.',
    privacy: 'هشدار: صدا و متن پاسخ‌ها برای پردازش به سرویس‌دهنده انتخاب‌شده فرستاده می‌شود.',
  },
  en: {
    title: 'Voice conversation',
    intro:
      'Voice recording and spoken replies in the chat boxes. Audio goes to an external provider and its cost is reported apart from the text model on the costs page.',
    enabled: 'Voice conversation is on',
    brand: 'Provider brand',
    connection: 'Connection',
    auto: 'Automatic (newest connection of this brand)',
    load: 'Read models and voices from the provider',
    loading: 'Reading…',
    stt: 'Speech to text model',
    tts: 'Text to speech model',
    voice: 'Voice',
    pick: '— choose —',
    preview: 'Hear a sample',
    previewText: 'Hello, I am Docoo. This is a sample of my voice.',
    speed: 'Playback speed',
    language: 'Spoken language',
    langAuto: 'Automatic (interface language)',
    maxRecord: 'Longest recording (seconds)',
    maxChars: 'Most characters read in one playback',
    store: 'Store the administrator voice in each conversation',
    retention: 'Days a recording is kept (0: until deleted by hand)',
    save: 'Save',
    saved: 'Saved.',
    nothing: 'Nothing changed.',
    cleanup: 'Stored recordings',
    purgeExpired: 'Delete expired recordings',
    deleteAll: 'Delete every recording of the workspace',
    confirm: 'Are you sure? This cannot be undone. Press again.',
    deleted: '{n} recordings deleted.',
    noConnection: 'No connection exists for this brand yet; add one under Providers.',
    failed: 'Could not save or read.',
    privacy: 'Note: audio and the text of replies are sent to the chosen provider to be processed.',
  },
} as const;

interface Assignment {
  key: string;
  sequence: number;
}

/** The voice page of the system settings (ADR-0046): brand, models, voice with a sample, storage. */
export function VoiceSettings({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = copy[locale];
  const problems = voiceMessages(locale).problems;
  const base = `/workspaces/${workspaceId}/settings`;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [sequences, setSequences] = useState<Map<string, number>>(new Map());
  const [connections, setConnections] = useState<Connection[]>([]);
  const [models, setModels] = useState<VoiceModelInfo[]>([]);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    try {
      const scope = `?scopeType=workspace&scopeId=${workspaceId}`;
      const [eff, assigned, list] = await Promise.all([
        apiGet<{ config: { values: Record<string, unknown> } }>(`${base}/effective${scope}`),
        apiGet<{ items: Assignment[] }>(`${base}/assignments${scope}`),
        apiGet<{ items: Connection[] }>(`/workspaces/${workspaceId}/provider-connections`),
      ]);
      const values = Object.fromEntries(KEYS.map((key) => [key, eff.config.values[key]])) as Draft;
      setDraft(values);
      setSaved(values);
      setSequences(new Map(assigned.items.map((item) => [item.key, item.sequence])));
      setConnections(list.items);
    } catch {
      setFailure(text.failed);
    }
  }, [base, text.failed, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const explain = (error: unknown) =>
    setFailure(
      error instanceof ApiError ? problems[problemFor(error.code, error.status)] : text.failed,
    );

  if (!draft || !saved) return failure ? <p className="notice error">{failure}</p> : null;

  const set = (key: Key, value: unknown) => setDraft({ ...draft, [key]: value });
  const brand = draft['voice.provider'] === 'elevenlabs' ? 'elevenlabs' : 'openai';
  const brandConnections = connections.filter((item) => item.provider === brand);
  const sttModels = models.filter((model) => model.kind === 'stt');
  const ttsModels = models.filter((model) => model.kind === 'tts');

  async function readCatalog() {
    setBusy('catalog');
    setFailure('');
    try {
      const catalog = await voiceApi.catalog(workspaceId, brand);
      setModels(catalog.models);
      setVoices(catalog.voices);
    } catch (error) {
      explain(error);
    } finally {
      setBusy('');
    }
  }

  async function hear() {
    setBusy('preview');
    setFailure('');
    try {
      const blob = await voiceApi.preview(workspaceId, {
        text: text.previewText,
        voiceId: str(draft?.['voice.voice_id'], ''),
        model: str(draft?.['voice.tts_model'], ''),
        speed: Number(draft?.['voice.speed'] ?? 1),
      });
      player.current?.pause();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      player.current = audio;
      await audio.play();
    } catch (error) {
      explain(error);
    } finally {
      setBusy('');
    }
  }

  async function save() {
    if (!draft || !saved) return;
    const changed = KEYS.filter((key) => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]));
    if (changed.length === 0) {
      setMessage(text.nothing);
      return;
    }
    setBusy('save');
    setFailure('');
    setMessage('');
    try {
      for (const key of changed) {
        await apiSend('PUT', `${base}/assignments`, {
          scopeType: 'workspace',
          scopeId: workspaceId,
          key,
          value: draft[key],
          reason: 'voice settings',
          expectedSequence: sequences.get(key) ?? 0,
        });
      }
      setMessage(text.saved);
      await load();
    } catch (error) {
      explain(error);
      await load();
    } finally {
      setBusy('');
    }
  }

  async function clean(kind: 'expired' | 'all') {
    if (kind === 'all' && !confirmAll) {
      setConfirmAll(true);
      return;
    }
    setConfirmAll(false);
    try {
      const result =
        kind === 'all'
          ? await voiceApi.deleteWorkspaceAudio(workspaceId)
          : await voiceApi.purgeExpired(workspaceId);
      setMessage(fillText(text.deleted, { n: result.deleted }));
    } catch (error) {
      explain(error);
    }
  }

  const options = (items: { id: string; name: string }[], current: unknown) => {
    const known = items.some((item) => item.id === current);
    return (
      <>
        <option value="">{text.pick}</option>
        {!known && typeof current === 'string' && current && (
          <option value={current}>{current}</option>
        )}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </>
    );
  };

  return (
    <section className="card stack" aria-labelledby="voice-settings-title">
      <h2 id="voice-settings-title">{text.title}</h2>
      <p className="muted">{text.intro}</p>
      <p className="notice">{text.privacy}</p>

      <label className="voice-check">
        <input
          type="checkbox"
          checked={draft['voice.enabled'] === true}
          onChange={(event) => set('voice.enabled', event.target.checked)}
        />{' '}
        {text.enabled}
      </label>

      <label className="field-stack">
        {text.brand}
        <select
          value={brand}
          onChange={(event) => {
            setDraft({
              ...draft,
              'voice.provider': event.target.value,
              'voice.connection_id': '',
              'voice.stt_model': '',
              'voice.tts_model': '',
              'voice.voice_id': '',
            });
            setModels([]);
            setVoices([]);
          }}
        >
          <option value="openai">OpenAI (ChatGPT)</option>
          <option value="elevenlabs">ElevenLabs</option>
        </select>
      </label>

      <label className="field-stack">
        {text.connection}
        <select
          value={str(draft['voice.connection_id'], '')}
          onChange={(event) => set('voice.connection_id', event.target.value)}
        >
          <option value="">{text.auto}</option>
          {brandConnections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        {brandConnections.length === 0 && <small className="muted">{text.noConnection}</small>}
      </label>

      <div className="toolbar">
        <button
          type="button"
          className="secondary-button"
          disabled={busy !== ''}
          onClick={() => void readCatalog()}
        >
          {busy === 'catalog' ? text.loading : text.load}
        </button>
      </div>

      <label className="field-stack">
        {text.stt}
        <select
          value={str(draft['voice.stt_model'], '')}
          onChange={(event) => set('voice.stt_model', event.target.value)}
        >
          {options(
            sttModels.map((model) => ({ id: model.id, name: model.displayName })),
            draft['voice.stt_model'],
          )}
        </select>
      </label>
      <label className="field-stack">
        {text.tts}
        <select
          value={str(draft['voice.tts_model'], '')}
          onChange={(event) => set('voice.tts_model', event.target.value)}
        >
          {options(
            ttsModels.map((model) => ({ id: model.id, name: model.displayName })),
            draft['voice.tts_model'],
          )}
        </select>
      </label>
      <label className="field-stack">
        {text.voice}
        <select
          value={str(draft['voice.voice_id'], '')}
          onChange={(event) => set('voice.voice_id', event.target.value)}
        >
          {options(
            voices.map((voice) => ({ id: voice.id, name: voice.name })),
            draft['voice.voice_id'],
          )}
        </select>
      </label>
      <div className="toolbar">
        <button
          type="button"
          className="secondary-button"
          disabled={busy !== '' || !draft['voice.voice_id'] || !draft['voice.tts_model']}
          onClick={() => void hear()}
        >
          {text.preview}
        </button>
      </div>

      <label className="field-stack">
        {text.speed}: {str(draft['voice.speed'])}
        <input
          type="range"
          min={0.7}
          max={1.25}
          step={0.05}
          value={Number(draft['voice.speed'] ?? 1)}
          onChange={(event) => set('voice.speed', Number(event.target.value))}
        />
      </label>
      <label className="field-stack">
        {text.language}
        <select
          value={str(draft['voice.language_hint'], 'auto')}
          onChange={(event) => set('voice.language_hint', event.target.value)}
        >
          <option value="auto">{text.langAuto}</option>
          <option value="fa">فارسی</option>
          <option value="en">English</option>
        </select>
      </label>
      <label className="field-stack">
        {text.maxRecord}
        <input
          type="number"
          min={5}
          max={600}
          value={Number(draft['voice.max_record_s'] ?? 120)}
          onChange={(event) => set('voice.max_record_s', Number(event.target.value))}
        />
      </label>
      <label className="field-stack">
        {text.maxChars}
        <input
          type="number"
          min={200}
          max={20000}
          value={Number(draft['voice.max_tts_chars'] ?? 4000)}
          onChange={(event) => set('voice.max_tts_chars', Number(event.target.value))}
        />
      </label>

      <label className="voice-check">
        <input
          type="checkbox"
          checked={draft['voice.store_admin_audio'] === true}
          onChange={(event) => set('voice.store_admin_audio', event.target.checked)}
        />{' '}
        {text.store}
      </label>
      <label className="field-stack">
        {text.retention}
        <input
          type="number"
          min={0}
          max={3650}
          value={Number(draft['voice.audio_retention_days'] ?? 30)}
          onChange={(event) => set('voice.audio_retention_days', Number(event.target.value))}
        />
      </label>

      <div className="toolbar">
        <button
          type="button"
          className="primary-button"
          disabled={busy !== ''}
          onClick={() => void save()}
        >
          {text.save}
        </button>
      </div>

      <h3>{text.cleanup}</h3>
      <div className="toolbar">
        <button type="button" className="secondary-button" onClick={() => void clean('expired')}>
          {text.purgeExpired}
        </button>
        <button type="button" className="secondary-button" onClick={() => void clean('all')}>
          {text.deleteAll}
        </button>
      </div>
      {confirmAll && <p className="notice">{text.confirm}</p>}
      {message && <p role="status">{message}</p>}
      {failure && (
        <p className="notice error" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}
