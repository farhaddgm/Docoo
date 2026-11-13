'use client';

import type {
  MonitorKind,
  MonitorShareLinkCreated,
  MonitorShareLinkSummary,
} from '@docoo/contracts';
import { monitorShareLimits } from '@docoo/contracts';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { apiGet, apiSend } from '../api-client';
import { formatNumber, type Locale } from '../i18n';
import { expiryFromPreset, shareMessages } from './share-messages';

import './monitor.css';

const EXPIRIES = ['day', 'hour', 'week', 'month', 'never', 'custom'] as const;

/**
 * The share links of the monitors, kept small: one short form and one list. The address of a new
 * link is shown once (the server keeps only a digest), so the owner copies it right away.
 */
export function ShareLinks({
  locale,
  workspaceId,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
}) {
  const text = shareMessages(locale).admin;
  const base = `/workspaces/${workspaceId}/monitor/links`;
  const [links, setLinks] = useState<MonitorShareLinkSummary[]>([]);
  const [kind, setKind] = useState<MonitorKind>('viewer');
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState<(typeof EXPIRIES)[number]>('day');
  const [custom, setCustom] = useState('');
  const [max, setMax] = useState<number>(monitorShareLimits.maxSessions.fallback);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<{ url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLinks(await apiGet<MonitorShareLinkSummary[]>(base));
    } catch {
      setNote(text.loadFailed);
    }
  }, [base, text.loadFailed]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setNote('');
    const expiresAt =
      expiry === 'custom'
        ? custom === ''
          ? 'invalid'
          : new Date(custom).toISOString()
        : expiryFromPreset(expiry, Date.now());
    if (expiresAt === 'invalid' || (expiresAt !== null && Date.parse(expiresAt) <= Date.now())) {
      setNote(text.badExpiry);
      return;
    }
    setBusy(true);
    try {
      const made = await apiSend<MonitorShareLinkCreated>('POST', base, {
        kind,
        password,
        expiresAt,
        maxSessions: max,
        label,
      });
      setFresh({ url: `${window.location.origin}/${locale}/monitor/share/${made.token}` });
      setCopied(false);
      setPassword('');
      setLabel('');
      await load();
    } catch {
      setNote(text.failed);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await apiSend('DELETE', `${base}/${id}`);
      setNote(text.revoked);
      await load();
    } catch {
      setNote(text.failed);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const date = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <section className="card stack" aria-labelledby="monitor-share">
      <h2 id="monitor-share">{text.title}</h2>
      <p className="muted">{text.text}</p>

      <form className="monitor-share-admin" onSubmit={(event) => void create(event)}>
        <label>
          {text.kind}
          <select value={kind} onChange={(event) => setKind(event.target.value as MonitorKind)}>
            <option value="viewer">{text.kinds.viewer}</option>
            <option value="voice">{text.kinds.voice}</option>
          </select>
        </label>
        <label>
          {text.password}
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={monitorShareLimits.password.min}
            maxLength={monitorShareLimits.password.max}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          {text.expiry}
          <select
            value={expiry}
            onChange={(event) => setExpiry(event.target.value as (typeof EXPIRIES)[number])}
          >
            {EXPIRIES.map((item) => (
              <option key={item} value={item}>
                {text.expiries[item]}
              </option>
            ))}
          </select>
        </label>
        {expiry === 'custom' && (
          <label>
            <span className="monitor-sr">{text.expiry}</span>
            <input
              type="datetime-local"
              required
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
            />
          </label>
        )}
        <label>
          {text.maxSessions}
          <input
            type="number"
            required
            min={monitorShareLimits.maxSessions.min}
            max={monitorShareLimits.maxSessions.max}
            value={max}
            onChange={(event) => setMax(Number(event.target.value))}
          />
        </label>
        <label>
          {text.label}
          <input
            type="text"
            maxLength={monitorShareLimits.label.max}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <div className="toolbar">
          <button type="submit" className="primary-button" disabled={busy}>
            {text.create}
          </button>
        </div>
      </form>

      {fresh && (
        <div className="notice ok monitor-share-created" role="status">
          <p>{text.created}</p>
          <div className="toolbar">
            <input
              readOnly
              dir="ltr"
              value={fresh.url}
              aria-label={text.title}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button type="button" className="secondary-button" onClick={() => void copy(fresh.url)}>
              {copied ? text.copied : text.copy}
            </button>
          </div>
        </div>
      )}
      {note && (
        <p className="notice info" role="status">
          {note}
        </p>
      )}

      {links.length === 0 ? (
        <p className="muted">{text.empty}</p>
      ) : (
        <ul className="monitor-share-list">
          {links.map((link) => (
            <li key={link.id}>
              <span>
                <strong>{link.label || text.kinds[link.kind]}</strong>
                {link.label && ` · ${text.kinds[link.kind]}`}
                {' · '}
                {text.status[link.status]}
                {' · '}
                {link.expiresAt ? date.format(new Date(link.expiresAt)) : text.never}
                {link.status === 'active' &&
                  ` · ${formatNumber(locale, link.activeSessions)}/${formatNumber(locale, link.maxSessions)} ${text.watching}`}
              </span>
              {link.status === 'active' && (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void revoke(link.id)}
                >
                  {text.revoke}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
