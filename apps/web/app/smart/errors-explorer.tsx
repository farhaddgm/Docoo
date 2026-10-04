'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { formatDateTime, formatNumber, type Locale } from '../i18n';
import { smartApi, ERROR_CATEGORIES, type SmartError } from './api';
import { ErrorDetail } from './error-detail';
import { smartMessagesFor } from './messages';
import { SmartSubnav } from './subnav';

interface Filters {
  status: string;
  source: string;
  category: string;
  search: string;
}

const emptyFilters: Filters = { status: '', source: '', category: '', search: '' };

/** Full, filterable error list with the same detail view as the Smart window (SMT-001). */
export function ErrorsExplorer({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = smartMessagesFor(locale);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [items, setItems] = useState<SmartError[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(
    async (filters: Filters, after: string | null) => {
      const body = await smartApi.errors(workspaceId, {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
        ...(after ? { cursor: after } : {}),
        limit: '25',
      });
      return body;
    },
    [workspaceId],
  );

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setFailed(false);
    fetchPage(applied, null)
      .then((body) => {
        if (cancelled) return;
        setItems(body.items);
        setCursor(body.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applied, fetchPage]);

  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('error');
    if (requested) setSelected(requested);
  }, []);

  async function more() {
    if (!cursor) return;
    setBusy(true);
    try {
      const body = await fetchPage(applied, cursor);
      setItems((current) => [...(current ?? []), ...body.items]);
      setCursor(body.nextCursor);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setApplied(draft);
  }

  function replace(updated: SmartError) {
    setItems(
      (current) =>
        current?.map((item) =>
          item.id === updated.id ? { ...item, status: updated.status } : item,
        ) ?? null,
    );
  }

  return (
    <div className="stack">
      <SmartSubnav locale={locale} />
      <form className="card filter-grid" onSubmit={apply}>
        <label className="smart-field">
          <span>{text.errors.filterStatus}</span>
          <select
            value={draft.status}
            onChange={(event) => setDraft({ ...draft, status: event.target.value })}
          >
            <option value="">{text.errors.all}</option>
            {(['new', 'seen', 'fixed', 'ignored'] as const).map((value) => (
              <option key={value} value={value}>
                {text.errors.status[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="smart-field">
          <span>{text.errors.filterSource}</span>
          <select
            value={draft.source}
            onChange={(event) => setDraft({ ...draft, source: event.target.value })}
          >
            <option value="">{text.errors.all}</option>
            {(['server', 'client'] as const).map((value) => (
              <option key={value} value={value}>
                {text.errors.source[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="smart-field">
          <span>{text.errors.filterCategory}</span>
          <select
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
          >
            <option value="">{text.errors.all}</option>
            {ERROR_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {text.errors.category[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="smart-field">
          <span>{text.errors.search}</span>
          <input
            type="search"
            value={draft.search}
            maxLength={100}
            onChange={(event) => setDraft({ ...draft, search: event.target.value })}
          />
        </label>
        <button type="submit" className="primary-button">
          {text.errors.apply}
        </button>
      </form>

      {failed && <p className="notice error">{text.errors.loadFailed}</p>}

      <div className="smart-split">
        <div className="card smart-list-card">
          {items && items.length === 0 && <p className="muted">{text.errors.empty}</p>}
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
                    <span className={`badge smart-status-${item.status}`}>
                      {text.errors.status[item.status]}
                    </span>
                    <span className="badge">{text.errors.category[item.category]}</span>
                    <span className="badge">{text.errors.source[item.source]}</span>
                  </span>
                  <span className="smart-row-title">{item.message}</span>
                  <span className="muted">
                    ×{formatNumber(locale, item.occurrences)} ·{' '}
                    {formatDateTime(locale, item.lastSeenAt)}
                    {item.route ? ` · ${item.route}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {cursor && (
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void more()}
            >
              {text.errors.loadMore}
            </button>
          )}
        </div>
        <div className="card">
          {selected ? (
            <ErrorDetail
              locale={locale}
              workspaceId={workspaceId}
              errorId={selected}
              onChanged={replace}
            />
          ) : (
            <p className="muted">{text.errors.select}</p>
          )}
        </div>
      </div>
    </div>
  );
}
