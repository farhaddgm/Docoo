'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError, apiGet, apiPost, apiSend } from '../../api-client';
import { formatDateTime, type Locale, textDir } from '../../i18n';
import { FieldLabel, InfoTip, SectionTitle } from '../../info-tip';
import { reportMessagesFor } from '../../report-messages';
import { searchMessages } from './search-messages';

type Service = 'exa' | 'tavily';
const SERVICES: readonly { id: Service; label: string; defaultCost: string }[] = [
  { id: 'exa', label: 'Exa', defaultCost: '0.007' },
  { id: 'tavily', label: 'Tavily', defaultCost: '0.008' },
];

interface SearchConnection {
  id: string;
  provider: Service;
  name: string;
  status: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  secret: { fingerprint: string; configured: boolean } | null;
  costPerQueryUsd: number | null;
  version: number;
}

/** The connection was saved, but the service refused its key or could not be reached. */
class SavedButNotUsable extends Error {
  constructor(readonly reason: string | null) {
    super('search_saved_not_usable');
  }
}

/**
 * ADR-0059: the independent web search services. Their keys are stored like a model provider's
 * (encrypted, write-only), but they are listed here, apart from the models.
 */
export function SearchServices({ locale, base }: { locale: Locale; base: string }) {
  const text = searchMessages(locale);
  const statuses = reportMessagesFor(locale).dashboard.providerStatuses;
  const [items, setItems] = useState<SearchConnection[] | null>(null);
  const [service, setService] = useState<Service>('exa');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [cost, setCost] = useState(SERVICES[0]!.defaultCost);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await apiGet<{ items: SearchConnection[] }>(`${base}/search-connections`);
    setItems(response.items.filter((item) => item.status !== 'disabled'));
  }, [base]);

  const explain = useCallback(
    (error: unknown): string => {
      if (error instanceof SavedButNotUsable) {
        return error.reason ? `${text.savedNotChecked} (${error.reason})` : text.savedNotChecked;
      }
      if (error instanceof ApiError && error.code) return text.errors[error.code] ?? text.failed;
      return text.failed;
    },
    [text],
  );

  useEffect(() => {
    load().catch((error: unknown) => setNotice({ ok: false, text: explain(error) }));
  }, [load, explain]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ ok: true, text: text.saved });
    } catch (error) {
      setNotice({ ok: false, text: explain(error) });
    } finally {
      setBusy(false);
      await load().catch(() => undefined);
    }
  }

  const priceOf = (value: string): number | undefined => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : undefined;
  };

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const created = (await (
        await apiPost(`${base}/provider-connections`, {
          provider: service,
          name: name.trim() || SERVICES.find((item) => item.id === service)!.label,
          secret,
          ...(priceOf(cost) !== undefined ? { costPerQueryUsd: priceOf(cost) } : {}),
        })
      ).json()) as { connection: SearchConnection };
      setSecret('');
      setName('');
      const checked = (await (
        await apiPost(`${base}/provider-connections/${created.connection.id}/health-check`, {})
      ).json()) as { connection: SearchConnection };
      if (checked.connection.status !== 'healthy') {
        throw new SavedButNotUsable(checked.connection.lastError);
      }
    });
  }

  function check(item: SearchConnection) {
    void run(async () => {
      await apiPost(`${base}/provider-connections/${item.id}/health-check`, {});
    });
  }

  function rotate(item: SearchConnection, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const raw = new FormData(form).get('secret');
    const value = typeof raw === 'string' ? raw : '';
    void run(async () => {
      await apiPost(`${base}/provider-connections/${item.id}/rotate-secret`, {
        secret: value,
        reason: text.rotateReason,
      });
      setRotating(null);
    });
  }

  function remove(item: SearchConnection) {
    void run(async () => {
      await apiPost(`${base}/provider-connections/${item.id}/disable`, {
        reason: text.removeReason,
      });
      setRemoving(null);
    });
  }

  return (
    <section className="card stack" aria-labelledby="search-title">
      <SectionTitle id="search-title" help={text.help}>
        {text.title}
      </SectionTitle>
      <p className="muted">{text.privacy}</p>
      {notice && (
        <p className={`notice ${notice.ok ? 'ok' : 'error'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      {items === null ? (
        <p role="status">…</p>
      ) : items.length === 0 ? (
        <p className="muted">{text.none}</p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="search-title">
          <table>
            <thead>
              <tr>
                <th scope="col">{text.columns.name}</th>
                <th scope="col">{text.columns.service}</th>
                <th scope="col">{text.columns.status}</th>
                <th scope="col">{text.columns.checked}</th>
                <th scope="col">{text.columns.fingerprint}</th>
                <th scope="col">
                  {text.columns.cost} <InfoTip text={text.costHelp} id="search-cost-help" />
                </th>
                <th scope="col">
                  <span className="visually-hidden">actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{item.name}</th>
                  <td dir="ltr">{item.provider}</td>
                  <td>
                    <span className={`badge state-${item.status}`}>
                      {statuses[item.status] ?? item.status}
                    </span>
                    {item.lastError && <small dir="ltr"> {item.lastError}</small>}
                  </td>
                  <td>{item.lastCheckedAt ? formatDateTime(locale, item.lastCheckedAt) : '—'}</td>
                  <td dir="ltr">
                    <code>{item.secret?.fingerprint ?? '—'}</code>
                  </td>
                  <td>
                    <form
                      key={item.version}
                      className="toolbar"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const raw = new FormData(event.currentTarget).get('costPerQueryUsd');
                        const value = priceOf(typeof raw === 'string' ? raw : '');
                        if (value === undefined) return;
                        void run(async () => {
                          await apiSend(
                            'PATCH',
                            `${base}/provider-connections/${item.id}`,
                            { costPerQueryUsd: value },
                            { version: item.version },
                          );
                        });
                      }}
                    >
                      <input
                        aria-label={`${text.cost} — ${item.name}`}
                        name="costPerQueryUsd"
                        aria-describedby="search-cost-help"
                        type="number"
                        dir="ltr"
                        min={0}
                        max={1}
                        step={0.001}
                        defaultValue={item.costPerQueryUsd ?? ''}
                      />
                      <button className="secondary-button" type="submit" disabled={busy}>
                        {text.saveCost}
                      </button>
                    </form>
                  </td>
                  <td>
                    <div className="toolbar">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        title={text.checkNote}
                        onClick={() => check(item)}
                      >
                        {text.check}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        aria-expanded={rotating === item.id}
                        onClick={() => setRotating(rotating === item.id ? null : item.id)}
                      >
                        {text.rotate}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={busy}
                        aria-expanded={removing === item.id}
                        onClick={() => setRemoving(removing === item.id ? null : item.id)}
                      >
                        {text.remove}
                      </button>
                    </div>
                    {rotating === item.id && (
                      <form className="toolbar" onSubmit={(event) => rotate(item, event)}>
                        <input
                          aria-label={`${text.rotateKey} — ${item.name}`}
                          name="secret"
                          type="password"
                          dir="ltr"
                          autoComplete="off"
                          required
                          minLength={8}
                        />
                        <button className="primary-button" type="submit" disabled={busy}>
                          {text.saveRotate}
                        </button>
                      </form>
                    )}
                    {removing === item.id && (
                      <div className="stack" role="group" aria-label={text.remove}>
                        <p className="muted" dir={textDir(locale)}>
                          {text.removeHelp}
                        </p>
                        <div className="toolbar">
                          <button
                            className="secondary-button danger"
                            type="button"
                            disabled={busy}
                            onClick={() => remove(item)}
                          >
                            {text.removeConfirm}
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={busy}
                            onClick={() => setRemoving(null)}
                          >
                            {text.cancel}
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="filter-form subsection" onSubmit={add} aria-busy={busy}>
        <h3>{text.add}</h3>
        <div className="filter-grid">
          <label htmlFor="search-service">{text.service}</label>
          <select
            id="search-service"
            value={service}
            onChange={(event) => {
              const next = event.target.value as Service;
              setService(next);
              setCost(SERVICES.find((item) => item.id === next)!.defaultCost);
            }}
          >
            {SERVICES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <label htmlFor="search-name">{text.name}</label>
          <input
            id="search-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
          <FieldLabel htmlFor="search-key" help={text.keyHelp[service]} helpId="search-key-help">
            {text.apiKey}
          </FieldLabel>
          <input
            id="search-key"
            type="password"
            dir="ltr"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="off"
            aria-describedby="search-key-help"
            required
            minLength={8}
          />
          <FieldLabel htmlFor="search-cost" help={text.costHelp} helpId="search-cost-field-help">
            {text.cost}
          </FieldLabel>
          <input
            id="search-cost"
            aria-describedby="search-cost-field-help"
            type="number"
            dir="ltr"
            min={0}
            max={1}
            step={0.001}
            required
            value={cost}
            onChange={(event) => setCost(event.target.value)}
          />
        </div>
        <div className="toolbar">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? text.saving : text.save}
          </button>
        </div>
      </form>
    </section>
  );
}
