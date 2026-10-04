'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { ApiError, apiGet, apiPost } from '../../api-client';
import { formatDateTime, type Locale } from '../../i18n';
import { SignedIn } from '../signed-in';
import { providerMessages } from './messages';

type Kind = 'openai' | 'gemini' | 'anthropic';

interface Connection {
  id: string;
  provider: Kind | 'fake';
  name: string;
  status: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  secret: { fingerprint: string; configured: boolean } | null;
}

interface Model {
  id: string;
  displayName: string;
  capabilities: { structuredOutput: boolean };
}

const kinds: { kind: Kind; label: string }[] = [
  { kind: 'openai', label: 'OpenAI' },
  { kind: 'gemini', label: 'Google Gemini' },
  { kind: 'anthropic', label: 'Anthropic Claude' },
];

export function ProvidersPage({ locale }: { locale: Locale }) {
  const text = providerMessages(locale);
  return (
    <SignedIn locale={locale} title={text.title} subtitle={text.subtitle}>
      {(identity) =>
        identity.workspaces[0] ? (
          <Providers locale={locale} workspaceId={identity.workspaces[0].id} />
        ) : null
      }
    </SignedIn>
  );
}

/** AI-001/003: add a provider key, check it, refresh models and pick the default model. */
function Providers({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = providerMessages(locale);
  const base = `/workspaces/${workspaceId}`;
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [models, setModels] = useState<Record<string, Model[]>>({});
  const [current, setCurrent] = useState<{ connectionId: string; model: string }>({
    connectionId: '',
    model: '',
  });
  const [kind, setKind] = useState<Kind>('openai');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [choice, setChoice] = useState<{ connectionId: string; model: string }>({
    connectionId: '',
    model: '',
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const explain = useCallback(
    (error: unknown) =>
      (error instanceof ApiError && error.code && text.errors[error.code]) || text.failed,
    [text],
  );

  const loadModels = useCallback(
    async (connectionId: string) => {
      const catalog = (
        await apiGet<{ catalog: { models: Model[] } | null }>(
          `${base}/provider-connections/${connectionId}/models`,
        )
      ).catalog;
      setModels((all) => ({ ...all, [connectionId]: catalog?.models ?? [] }));
    },
    [base],
  );

  // Only the newest load may update the page: a slow earlier one must not bring back values
  // that a save has just replaced.
  const latestLoad = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latestLoad.current;
    const items = (
      await apiGet<{ items: Connection[] }>(`${base}/provider-connections`)
    ).items.filter((item) => item.status !== 'disabled');
    if (mine !== latestLoad.current) return;
    setConnections(items);
    await Promise.all(items.map((item) => loadModels(item.id).catch(() => undefined)));
    const effective = (
      await apiGet<{ config: { values: Record<string, unknown> } }>(
        `${base}/settings/effective?scopeType=workspace&scopeId=${workspaceId}`,
      )
    ).config.values;
    if (mine !== latestLoad.current) return;
    const saved = {
      connectionId:
        typeof effective['ai.connection_id'] === 'string' ? effective['ai.connection_id'] : '',
      model: typeof effective['ai.model'] === 'string' ? effective['ai.model'] : '',
    };
    setCurrent(saved);
    setChoice((value) => (value.connectionId ? value : saved));
  }, [base, loadModels, workspaceId]);

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

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      const created = (await (
        await apiPost(`${base}/provider-connections`, {
          provider: kind,
          name: name.trim() || kinds.find((item) => item.kind === kind)!.label,
          secret,
        })
      ).json()) as { connection: Connection };
      setSecret('');
      setName('');
      await apiPost(`${base}/provider-connections/${created.connection.id}/health-check`, {});
      await apiPost(`${base}/provider-connections/${created.connection.id}/models/refresh`, {});
      setChoice((value) =>
        value.connectionId ? value : { connectionId: created.connection.id, model: '' },
      );
    });
  }

  function saveDefaults(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      for (const [key, value] of [
        ['ai.connection_id', choice.connectionId],
        ['ai.model', choice.model],
      ] as const) {
        const response = await fetch(`/api${base}/settings/assignments`, {
          method: 'PUT',
          cache: 'no-store',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            key,
            scopeType: 'workspace',
            scopeId: workspaceId,
            value,
            reason: 'Set on the AI providers page',
          }),
        });
        if (!response.ok) throw new ApiError(response.status, undefined);
      }
    });
  }

  const usable = (models[choice.connectionId] ?? []).filter(
    (model) => model.capabilities.structuredOutput,
  );
  const nameOf = (id: string) => connections?.find((item) => item.id === id)?.name ?? id;

  return (
    <div className="stack">
      {notice && (
        <p className={`notice ${notice.ok ? 'ok' : 'error'}`} role={notice.ok ? 'status' : 'alert'}>
          {notice.text}
        </p>
      )}
      <section className="card" aria-labelledby="connections-title">
        <h2 id="connections-title">{text.connections}</h2>
        {connections === null ? (
          <p role="status">…</p>
        ) : connections.length === 0 ? (
          <p className="muted">{text.none}</p>
        ) : (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-labelledby="connections-title"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">{text.name}</th>
                  <th scope="col">{text.provider}</th>
                  <th scope="col">{text.status}</th>
                  <th scope="col">{text.lastChecked}</th>
                  <th scope="col">{text.keyFingerprint}</th>
                  <th scope="col">
                    <span className="visually-hidden">actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {connections.map((item) => (
                  <tr key={item.id}>
                    <th scope="row">{item.name}</th>
                    <td dir="ltr">{item.provider}</td>
                    <td>
                      <span className={`badge state-${item.status}`}>{item.status}</span>
                      {item.lastError && <small dir="ltr"> {item.lastError}</small>}
                    </td>
                    <td>{item.lastCheckedAt ? formatDateTime(locale, item.lastCheckedAt) : '—'}</td>
                    <td dir="ltr">
                      <code>{item.secret?.fingerprint ?? '—'}</code>
                    </td>
                    <td>
                      <div className="toolbar">
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              apiPost(
                                `${base}/provider-connections/${item.id}/health-check`,
                                {},
                              ).then(() => undefined),
                            )
                          }
                        >
                          {text.check}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void run(() =>
                              apiPost(
                                `${base}/provider-connections/${item.id}/models/refresh`,
                                {},
                              ).then(() => undefined),
                            )
                          }
                        >
                          {text.refresh}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form
        className="card filter-form"
        onSubmit={add}
        aria-labelledby="add-title"
        aria-busy={busy}
      >
        <h2 id="add-title">{text.add}</h2>
        <div className="filter-grid">
          <label htmlFor="provider-kind">{text.provider}</label>
          <select
            id="provider-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as Kind)}
          >
            {kinds.map((item) => (
              <option key={item.kind} value={item.kind}>
                {item.label}
              </option>
            ))}
          </select>
          <label htmlFor="provider-name">{text.name}</label>
          <input
            id="provider-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
          <label htmlFor="provider-key">{text.apiKey}</label>
          <input
            id="provider-key"
            type="password"
            dir="ltr"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="off"
            aria-describedby="provider-key-help"
            required
            minLength={8}
          />
          <span />
          <p id="provider-key-help" className="muted" dir="auto">
            {text.keyHelp[kind]}
          </p>
        </div>
        <div className="toolbar">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? text.saving : text.save}
          </button>
        </div>
      </form>

      <form
        className="card filter-form"
        onSubmit={saveDefaults}
        aria-labelledby="defaults-title"
        aria-busy={busy}
      >
        <h2 id="defaults-title">{text.defaults}</h2>
        <p className="muted">{text.defaultsHelp}</p>
        <p>
          {text.current}:{' '}
          <strong dir="ltr">
            {current.connectionId
              ? `${nameOf(current.connectionId)} · ${current.model || '—'}`
              : text.notSet}
          </strong>
        </p>
        <div className="filter-grid">
          <label htmlFor="default-connection">{text.connection}</label>
          <select
            id="default-connection"
            value={choice.connectionId}
            onChange={(event) => setChoice({ connectionId: event.target.value, model: '' })}
            required
          >
            <option value="">—</option>
            {(connections ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <label htmlFor="default-model">{text.model}</label>
          <select
            id="default-model"
            value={choice.model}
            onChange={(event) => setChoice((value) => ({ ...value, model: event.target.value }))}
            required
            dir="ltr"
          >
            <option value="">{usable.length ? '—' : text.chooseModel}</option>
            {usable.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName || model.id}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar">
          <button
            className="primary-button"
            type="submit"
            disabled={busy || !choice.connectionId || !choice.model}
          >
            {text.saveDefaults}
          </button>
        </div>
      </form>
    </div>
  );
}
