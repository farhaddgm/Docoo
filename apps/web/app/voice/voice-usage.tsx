'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '../api-client';
import { formatNumber, type Locale } from '../i18n';
import { voiceApi, type VoicePrice, type VoiceUsage } from './voice-api';

const copy = {
  fa: {
    title: 'مصرف صدا',
    note: 'هزینه سرویس‌های صوتی جداست و در جمع هزینه مدل متنی بالا نیست؛ اما از همان سقف ماهانه و روزانه حساب کم می‌شود.',
    period: 'بازه',
    days: '{n} روز اخیر',
    stt: 'گفتار به متن',
    tts: 'متن به گفتار',
    provider: 'سرویس‌دهنده',
    model: 'مدل',
    kind: 'نوع',
    calls: 'تماس',
    failed: 'ناموفق',
    seconds: 'ثانیه صدا',
    chars: 'نویسه',
    tokens: 'توکن',
    cost: 'هزینه (دلار)',
    unpriced: 'بدون قیمت',
    unpricedHint: 'تماس‌های بدون قیمت صفر حساب نمی‌شوند؛ قیمت را پایین ثبت کنید.',
    total: 'جمع',
    byDay: 'به تفکیک روز',
    byUser: 'به تفکیک حساب',
    empty: 'در این بازه مصرف صوتی نبوده است.',
    prices: 'قیمت مدل‌های صوتی',
    perMinute: 'به‌ازای دقیقه',
    perKChars: 'به‌ازای هزار نویسه',
    from: 'از تاریخ',
    add: 'افزودن قیمت',
    added: 'قیمت ثبت شد.',
    failure: 'خواندن یا ثبت انجام نشد.',
    mine: 'این جدول فقط مصرف خود شماست.',
  },
  en: {
    title: 'Voice usage',
    note: 'Voice provider cost is kept apart and is not in the text model total above; it does count against the monthly and daily allowance of the account.',
    period: 'Period',
    days: 'Last {n} days',
    stt: 'Speech to text',
    tts: 'Text to speech',
    provider: 'Provider',
    model: 'Model',
    kind: 'Kind',
    calls: 'Calls',
    failed: 'Failed',
    seconds: 'Audio seconds',
    chars: 'Characters',
    tokens: 'Tokens',
    cost: 'Cost (USD)',
    unpriced: 'Unpriced',
    unpricedHint: 'Unpriced calls are not counted as free; add a price below.',
    total: 'Total',
    byDay: 'By day',
    byUser: 'By account',
    empty: 'No voice usage in this period.',
    prices: 'Voice model prices',
    perMinute: 'Per minute',
    perKChars: 'Per 1,000 characters',
    from: 'Effective from',
    add: 'Add price',
    added: 'Price saved.',
    failure: 'Could not read or save.',
    mine: 'This table shows only your own usage.',
  },
} as const;

const fmt = (locale: Locale, value: number, digits = 4) =>
  formatNumber(locale, Number(value.toFixed(digits)));

/** Voice usage apart from the text model (ADR-0046): per provider, model, day and account. */
export function VoiceUsagePanel({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = copy[locale];
  const [days, setDays] = useState(30);
  const [usage, setUsage] = useState<VoiceUsage | null>(null);
  const [owner, setOwner] = useState(false);
  const [prices, setPrices] = useState<VoicePrice[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    provider: 'openai' as 'openai' | 'elevenlabs',
    model: '',
    kind: 'tts' as 'stt' | 'tts',
    perMinute: '',
    per1kCharacters: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(async () => {
    setError('');
    try {
      let isOwner = true;
      let result: VoiceUsage;
      try {
        result = await voiceApi.usage(workspaceId, days, true);
      } catch (caught) {
        if (!(caught instanceof ApiError) || caught.status !== 403) throw caught;
        isOwner = false;
        result = await voiceApi.usage(workspaceId, days, false);
      }
      setUsage(result);
      setOwner(isOwner);
      if (isOwner) setPrices((await voiceApi.prices(workspaceId)).items);
    } catch {
      setError(text.failure);
    }
  }, [days, text.failure, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addPrice(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    try {
      await voiceApi.addPrice(workspaceId, {
        provider: form.provider,
        model: form.model.trim(),
        kind: form.kind,
        perMinute: form.perMinute === '' ? null : Number(form.perMinute),
        per1kCharacters: form.per1kCharacters === '' ? null : Number(form.per1kCharacters),
        inputPerMillion: null,
        outputPerMillion: null,
        effectiveFrom: new Date(`${form.effectiveFrom}T00:00:00Z`).toISOString(),
      });
      setMessage(text.added);
      await load();
    } catch {
      setError(text.failure);
    }
  }

  const kindLabel = (kind: 'stt' | 'tts') => (kind === 'stt' ? text.stt : text.tts);
  const sum = (field: 'calls' | 'costUsd' | 'unpriced') =>
    usage?.totals.reduce((total, row) => total + row[field], 0) ?? 0;

  return (
    <section className="card stack" aria-labelledby="voice-usage-title">
      <h2 id="voice-usage-title">{text.title}</h2>
      <p className="muted">{text.note}</p>
      {!owner && usage && <p className="muted">{text.mine}</p>}
      <label className="field-stack">
        {text.period}
        <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
          {[7, 30, 90, 365].map((n) => (
            <option key={n} value={n}>
              {text.days.replace('{n}', String(n))}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {usage && usage.totals.length === 0 && <p className="muted">{text.empty}</p>}
      {usage && usage.totals.length > 0 && (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>{text.provider}</th>
                <th>{text.model}</th>
                <th>{text.kind}</th>
                <th>{text.calls}</th>
                <th>{text.failed}</th>
                <th>{text.seconds}</th>
                <th>{text.chars}</th>
                <th>{text.tokens}</th>
                <th>{text.cost}</th>
                <th>{text.unpriced}</th>
              </tr>
            </thead>
            <tbody>
              {usage.totals.map((row) => (
                <tr key={`${row.provider}-${row.model}-${row.kind}`}>
                  <td>{row.provider}</td>
                  <td dir="ltr">{row.model}</td>
                  <td>{kindLabel(row.kind)}</td>
                  <td>{formatNumber(locale, row.calls)}</td>
                  <td>{formatNumber(locale, row.failed)}</td>
                  <td>{fmt(locale, row.audioSeconds, 1)}</td>
                  <td>{formatNumber(locale, row.characters)}</td>
                  <td>{formatNumber(locale, row.inputTokens + row.outputTokens)}</td>
                  <td>{fmt(locale, row.costUsd)}</td>
                  <td>{formatNumber(locale, row.unpriced)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={3}>{text.total}</th>
                <td>{formatNumber(locale, sum('calls'))}</td>
                <td colSpan={5} />
                <td>{fmt(locale, sum('costUsd'))}</td>
                <td>{formatNumber(locale, sum('unpriced'))}</td>
              </tr>
            </tfoot>
          </table>
          {sum('unpriced') > 0 && <p className="notice">{text.unpricedHint}</p>}

          <h3>{text.byDay}</h3>
          <table className="data-table">
            <tbody>
              {usage.byDay.map((row) => (
                <tr key={`${row.day}-${row.kind}`}>
                  <td dir="ltr">{row.day}</td>
                  <td>{kindLabel(row.kind)}</td>
                  <td>{formatNumber(locale, row.calls)}</td>
                  <td>{fmt(locale, row.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {usage.byUser.length > 0 && (
            <>
              <h3>{text.byUser}</h3>
              <table className="data-table">
                <tbody>
                  {usage.byUser.map((row) => (
                    <tr key={row.userId ?? 'none'}>
                      <td dir="ltr">{row.userId ?? '—'}</td>
                      <td>{formatNumber(locale, row.calls)}</td>
                      <td>{fmt(locale, row.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      {owner && (
        <>
          <h3>{text.prices}</h3>
          <ul className="plain-list">
            {prices.map((price) => (
              <li key={price.id} dir="ltr">
                {price.provider} · {price.model} · {price.kind} ·{' '}
                {price.perMinute !== null && `${price.perMinute}/min `}
                {price.per1kCharacters !== null && `${price.per1kCharacters}/1k chars `}·{' '}
                {price.effectiveFrom.slice(0, 10)}
              </li>
            ))}
          </ul>
          <form className="stack" onSubmit={(event) => void addPrice(event)}>
            <div className="toolbar">
              <select
                value={form.provider}
                aria-label={text.provider}
                onChange={(event) =>
                  setForm({
                    ...form,
                    provider: event.target.value === 'elevenlabs' ? 'elevenlabs' : 'openai',
                  })
                }
              >
                <option value="openai">openai</option>
                <option value="elevenlabs">elevenlabs</option>
              </select>
              <input
                value={form.model}
                required
                placeholder={text.model}
                aria-label={text.model}
                dir="ltr"
                onChange={(event) => setForm({ ...form, model: event.target.value })}
              />
              <select
                value={form.kind}
                aria-label={text.kind}
                onChange={(event) =>
                  setForm({ ...form, kind: event.target.value === 'stt' ? 'stt' : 'tts' })
                }
              >
                <option value="tts">{text.tts}</option>
                <option value="stt">{text.stt}</option>
              </select>
            </div>
            <div className="toolbar">
              {form.kind === 'stt' ? (
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder={text.perMinute}
                  aria-label={text.perMinute}
                  value={form.perMinute}
                  onChange={(event) => setForm({ ...form, perMinute: event.target.value })}
                />
              ) : (
                <input
                  type="number"
                  min={0}
                  step="any"
                  placeholder={text.perKChars}
                  aria-label={text.perKChars}
                  value={form.per1kCharacters}
                  onChange={(event) => setForm({ ...form, per1kCharacters: event.target.value })}
                />
              )}
              <label>
                {text.from}{' '}
                <input
                  type="date"
                  value={form.effectiveFrom}
                  onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
                />
              </label>
              <button type="submit" className="secondary-button">
                {text.add}
              </button>
            </div>
          </form>
          {message && <p role="status">{message}</p>}
        </>
      )}
    </section>
  );
}
