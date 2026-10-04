'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '../api-client';
import { formatDateTime, type Locale } from '../i18n';
import { smartApi, type Issue, type IssueStatus } from './api';
import { developerReport } from './format';
import { smartErrorMessage, smartMessagesFor } from './messages';
import { refreshSummary } from './summary';
import { SmartSubnav } from './subnav';

const STATUSES: readonly IssueStatus[] = ['open', 'in_progress', 'fixed', 'wont_fix'];

/** The walker issue ledger: saved Smart answers with status, fix note and developer copy (SMT-002). */
export function IssuesExplorer({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = smartMessagesFor(locale);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState({ status: '', search: '' });
  const [items, setItems] = useState<Issue[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (after: string | null) =>
      smartApi.issues(workspaceId, {
        ...(applied.status ? { status: applied.status } : {}),
        ...(applied.search.trim() ? { search: applied.search.trim() } : {}),
        ...(after ? { cursor: after } : {}),
      }),
    [workspaceId, applied],
  );

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    load(null)
      .then((body) => {
        if (cancelled) return;
        setItems(body.items);
        setCursor(body.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('issue');
    if (requested) setSelected(requested);
  }, []);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied({ status, search });
  }

  function changed(issue: Issue) {
    setItems(
      (current) =>
        current?.map((item) =>
          item.id === issue.id
            ? { ...item, title: issue.title, status: issue.status, note: issue.note }
            : item,
        ) ?? null,
    );
    refreshSummary();
  }

  function removed(id: string) {
    setItems((current) => current?.filter((item) => item.id !== id) ?? null);
    setSelected(null);
    refreshSummary();
  }

  return (
    <div className="stack">
      <SmartSubnav locale={locale} />
      <form className="card filter-grid" onSubmit={apply}>
        <label className="smart-field">
          <span>{text.errors.filterStatus}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{text.errors.all}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {text.issues.status[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="smart-field">
          <span>{text.issues.search}</span>
          <input
            type="search"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button type="submit" className="primary-button">
          {text.errors.apply}
        </button>
      </form>
      {failed && <p className="notice error">{text.issues.loadFailed}</p>}
      <div className="smart-split">
        <div className="card smart-list-card">
          {items && items.length === 0 && <p className="muted">{text.issues.empty}</p>}
          <ul className="smart-list">
            {items?.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="smart-row"
                  aria-current={item.id === selected ? 'true' : undefined}
                  onClick={() => setSelected(item.id)}
                >
                  <span className="smart-chips">
                    <span className={`badge smart-issue-${item.status}`}>
                      {text.issues.status[item.status]}
                    </span>
                  </span>
                  <span className="smart-row-title">{item.title}</span>
                  <span className="muted">{formatDateTime(locale, item.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                void load(cursor)
                  .then((body) => {
                    setItems((current) => [...(current ?? []), ...body.items]);
                    setCursor(body.nextCursor);
                  })
                  .catch(() => setFailed(true))
              }
            >
              {text.errors.loadMore}
            </button>
          )}
        </div>
        <div className="card">
          {selected ? (
            <IssueDetail
              key={selected}
              locale={locale}
              workspaceId={workspaceId}
              issueId={selected}
              onChanged={changed}
              onRemoved={removed}
            />
          ) : (
            <p className="muted">{text.issues.select}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function IssueDetail({
  locale,
  workspaceId,
  issueId,
  onChanged,
  onRemoved,
}: {
  locale: Locale;
  workspaceId: string;
  issueId: string;
  onChanged: (issue: Issue) => void;
  onRemoved: (id: string) => void;
}) {
  const text = smartMessagesFor(locale);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<IssueStatus>('open');
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    smartApi
      .issue(workspaceId, issueId, controller.signal)
      .then(({ issue: loaded }) => {
        setIssue(loaded);
        setTitle(loaded.title);
        setNote(loaded.note);
        setState(loaded.status);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setFailure(
            smartErrorMessage(locale, caught instanceof ApiError ? caught.code : undefined),
          );
        }
      });
    return () => controller.abort();
  }, [workspaceId, issueId, locale]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!issue || busy) return;
    setBusy(true);
    setFailure('');
    setMessage('');
    try {
      const { issue: updated } = await smartApi.updateIssue(workspaceId, issue.id, {
        status: state,
        title: title.trim() || issue.title,
        note,
      });
      setIssue({ ...issue, ...updated });
      onChanged(updated);
      setMessage(text.issues.saved);
    } catch (caught) {
      setFailure(smartErrorMessage(locale, caught instanceof ApiError ? caught.code : undefined));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!issue) return;
    setFailure('');
    try {
      await navigator.clipboard.writeText(
        developerReport({
          header: text.issues.developerHeader,
          id: issue.id,
          title: issue.title,
          status: issue.status,
          createdAt: issue.createdAt,
          body: issue.body ?? '',
          context: issue.context,
          note: issue.note,
        }),
      );
      setMessage(text.issues.copied);
    } catch {
      setFailure(smartErrorMessage(locale, undefined));
    }
  }

  async function remove() {
    if (!issue) return;
    if (!confirm) {
      setConfirm(true);
      return;
    }
    try {
      await smartApi.deleteIssue(workspaceId, issue.id);
      onRemoved(issue.id);
    } catch (caught) {
      setFailure(smartErrorMessage(locale, caught instanceof ApiError ? caught.code : undefined));
    }
  }

  if (failure && !issue) return <p className="notice error">{failure}</p>;
  if (!issue) return <p role="status">…</p>;

  return (
    <div className="stack">
      <form className="stack" onSubmit={(event) => void save(event)}>
        <label className="smart-field">
          <span>{text.issues.title}</span>
          <input value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="smart-field">
          <span>{text.errors.filterStatus}</span>
          <select value={state} onChange={(event) => setState(event.target.value as IssueStatus)}>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {text.issues.status[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="smart-field">
          <span>{text.issues.note}</span>
          <textarea
            rows={3}
            maxLength={5000}
            value={note}
            placeholder={text.issues.notePlaceholder}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <div className="toolbar">
          <button type="submit" className="primary-button" disabled={busy}>
            {text.issues.save}
          </button>
          <button type="button" className="secondary-button" onClick={() => void copy()}>
            {text.issues.copy}
          </button>
          <button type="button" className="secondary-button" onClick={() => void remove()}>
            {confirm ? text.issues.removeConfirm : text.issues.remove}
          </button>
        </div>
      </form>
      {message && (
        <p className="notice ok" role="status">
          {message}
        </p>
      )}
      {failure && <p className="notice error">{failure}</p>}
      <p className="muted">
        {text.issues.createdAt}: {formatDateTime(locale, issue.createdAt)}
      </p>
      <h3>{text.issues.body}</h3>
      <p className="smart-text-block">{issue.body}</p>
      <details>
        <summary>{text.issues.contextTitle}</summary>
        <pre className="smart-pre" dir="ltr">
          {JSON.stringify(issue.context ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}
