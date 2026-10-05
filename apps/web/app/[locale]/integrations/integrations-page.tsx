'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';

import { apiGet, apiSend } from '../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { Notice, explainError, useAction } from '../use-action';
import { WorkspacePage } from '../workspace-page';
import { integrationMessages } from './messages';

interface Connection {
  apiUrl: string;
  webUrl: string | null;
  status: string;
  secret: { configured: boolean; version: number; fingerprint: string | null };
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
}

export function IntegrationsPage({ locale }: { locale: Locale }) {
  const text = integrationMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <Integrations locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

/** The connection to Contenter (ADR-0021): address, write-only token, status and a test. */
function Integrations({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = integrationMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}/integrations/contenter`;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [webUrl, setWebUrl] = useState('');
  const [token, setToken] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, setNotice, run } = useAction(explain);

  const load = useCallback(async () => {
    try {
      const result = await apiGet<{ connection: Connection | null }>(base);
      setConnection(result.connection);
      setApiUrl(result.connection?.apiUrl ?? '');
      setWebUrl(result.connection?.webUrl ?? '');
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const result = await apiSend<{ connection: Connection }>('PUT', base, {
        apiUrl: apiUrl.trim(),
        webUrl: webUrl.trim() === '' ? null : webUrl.trim(),
        ...(token.trim() ? { token: token.trim() } : {}),
      });
      setToken('');
      setConnection(result.connection);
    }, text.saved);
  }

  function test() {
    void run(async () => {
      const result = await apiSend<{ connection: Connection }>('POST', `${base}/test`, {});
      setConnection(result.connection);
    }, text.tested);
  }

  function remove() {
    void run(async () => {
      await apiSend('DELETE', base);
      setConfirmRemove(false);
      setConnection(null);
      setApiUrl('');
      setWebUrl('');
    }, text.removed);
  }

  if (!loaded) return <p role="status">…</p>;
  if (loadFailed) {
    return (
      <div className="stack">
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
        <div className="toolbar">
          <button className="secondary-button" type="button" onClick={() => void load()}>
            {text.retry}
          </button>
        </div>
      </div>
    );
  }

  const configured = connection?.secret.configured === true;
  return (
    <div className="stack">
      <section className="card stack" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{text.contenter}</h2>
        <p dir="auto">{text.intro}</p>
        <h3>{text.stepsTitle}</h3>
        <ol>
          {text.steps.map((step) => (
            <li key={step} dir="auto">
              {step}
            </li>
          ))}
        </ol>
        <h3>{text.privacyTitle}</h3>
        <p className="muted" dir="auto">
          {text.privacy}
        </p>
      </section>

      <section className="card stack" aria-labelledby={`${id}-status`}>
        <h2 id={`${id}-status`}>{text.status}</h2>
        {connection === null ? (
          <p className="muted">{text.notConfigured}</p>
        ) : (
          <dl className="facts" data-testid="contenter-status">
            <div>
              <dt>{text.status}</dt>
              <dd>
                <span className={`badge state-${connection.status}`}>
                  {text.statuses[connection.status] ?? connection.status}
                </span>
              </dd>
            </div>
            <div>
              <dt>{text.apiUrl}</dt>
              <dd dir="ltr">{connection.apiUrl}</dd>
            </div>
            {connection.webUrl && (
              <div>
                <dt>{text.webUrl}</dt>
                <dd dir="ltr">{connection.webUrl}</dd>
              </div>
            )}
            <div>
              <dt>{text.fingerprint}</dt>
              <dd dir="ltr">
                <code>{connection.secret.fingerprint ?? '—'}</code>
              </dd>
            </div>
            <div>
              <dt>{text.lastChecked}</dt>
              <dd>
                {connection.lastCheckedAt ? formatDateTime(locale, connection.lastCheckedAt) : '—'}
              </dd>
            </div>
            {connection.lastLatencyMs !== null && (
              <div>
                <dt>{text.latency}</dt>
                <dd>
                  {formatNumber(locale, connection.lastLatencyMs)} {text.ms}
                </dd>
              </div>
            )}
          </dl>
        )}
        {connection?.lastError && (
          <p className="notice error" role="status">
            {text.lastErrors[connection.lastError] ?? connection.lastError}
          </p>
        )}
        <Notice notice={notice} />
        {configured && (
          <div className="toolbar">
            <button className="secondary-button" type="button" disabled={busy} onClick={test}>
              {busy ? text.working : text.test}
            </button>
            <button
              className="secondary-button danger"
              type="button"
              disabled={busy}
              aria-expanded={confirmRemove}
              onClick={() => {
                setNotice(null);
                setConfirmRemove(true);
              }}
            >
              {text.remove}
            </button>
          </div>
        )}
        {confirmRemove && (
          <div className="card confirm-panel stack" role="group" aria-labelledby={`${id}-remove`}>
            <h3 id={`${id}-remove`}>{text.removeTitle}</h3>
            <p>{text.removeHelp}</p>
            <div className="toolbar">
              <button className="primary-button" type="button" disabled={busy} onClick={remove}>
                {busy ? text.working : text.removeConfirm}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setConfirmRemove(false)}
              >
                {text.cancel}
              </button>
            </div>
          </div>
        )}
      </section>

      <form className="card filter-form" onSubmit={save} aria-busy={busy}>
        <h2>{configured ? text.save : text.contenter}</h2>
        <div className="filter-grid">
          <label htmlFor={`${id}-api`}>{text.apiUrl}</label>
          <input
            id={`${id}-api`}
            type="url"
            dir="ltr"
            value={apiUrl}
            onChange={(event) => setApiUrl(event.target.value)}
            maxLength={500}
            required
            autoComplete="off"
            aria-describedby={`${id}-api-help`}
          />
          <span />
          <p id={`${id}-api-help`} className="muted" dir="auto">
            {text.apiUrlHelp}
          </p>
          <label htmlFor={`${id}-web`}>{text.webUrl}</label>
          <input
            id={`${id}-web`}
            type="url"
            dir="ltr"
            value={webUrl}
            onChange={(event) => setWebUrl(event.target.value)}
            maxLength={500}
            autoComplete="off"
            aria-describedby={`${id}-web-help`}
          />
          <span />
          <p id={`${id}-web-help`} className="muted" dir="auto">
            {text.webUrlHelp}
          </p>
          <label htmlFor={`${id}-token`}>{text.token}</label>
          <input
            id={`${id}-token`}
            type="password"
            dir="ltr"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            minLength={32}
            maxLength={512}
            required={!configured}
            autoComplete="off"
            aria-describedby={`${id}-token-help`}
          />
          <span />
          <p id={`${id}-token-help`} className="muted" dir="auto">
            {text.tokenHelp} {configured && text.tokenKeep}
          </p>
        </div>
        <div className="toolbar">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? text.saving : text.save}
          </button>
        </div>
      </form>
    </div>
  );
}
