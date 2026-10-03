'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { ApiError, apiGet, apiPost, dayBoundary, query } from '../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { reportMessagesFor } from '../../report-messages';
import { SignedIn } from '../signed-in';

interface AuditEvent {
  id: string;
  action: string;
  actorId: string | null;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  severity: 'info' | 'warning' | 'critical';
  securityRelevant: boolean;
  occurredAt: string;
}

interface Filters {
  action: string;
  targetType: string;
  severity: string;
  from: string;
  to: string;
  securityRelevant: boolean;
}

const emptyFilters: Filters = {
  action: '',
  targetType: '',
  severity: '',
  from: '',
  to: '',
  securityRelevant: false,
};

export function AuditExplorer({ locale }: { locale: Locale }) {
  const text = reportMessagesFor(locale).audit;
  return (
    <SignedIn locale={locale} title={text.title} subtitle={text.subtitle}>
      {(identity) =>
        identity.workspaces[0] ? (
          <Explorer locale={locale} workspaceId={identity.workspaces[0].id} />
        ) : null
      }
    </SignedIn>
  );
}

function apiFilters(filters: Filters) {
  return {
    action: filters.action.trim() || undefined,
    targetType: filters.targetType.trim() || undefined,
    severity: filters.severity || undefined,
    from: dayBoundary(filters.from),
    to: dayBoundary(filters.to, true),
    ...(filters.securityRelevant ? { securityRelevant: true } : {}),
  };
}

/** Filters and export of the audit API (REP-003, FR-AUD-001..005), RTL/LTR and keyboard usable. */
function Explorer({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const content = reportMessagesFor(locale);
  const text = content.audit;
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [applied, setApplied] = useState<Filters>(emptyFilters);
  const [items, setItems] = useState<AuditEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const base = `/workspaces/${workspaceId}/audit-events`;

  const fetchPage = useCallback(
    async (filters: Filters, after: string | null) => {
      const params = apiFilters(filters);
      const search = query({
        ...params,
        securityRelevant: params.securityRelevant ? 'true' : undefined,
        limit: '25',
        cursor: after ?? undefined,
      });
      return apiGet<{ items: AuditEvent[]; nextCursor: string | null }>(`${base}${search}`);
    },
    [base],
  );

  const run = useCallback(
    async (filters: Filters, focus: boolean) => {
      setBusy(true);
      setError('');
      setNotice('');
      try {
        const page = await fetchPage(filters, null);
        setItems(page.items);
        setCursor(page.nextCursor);
        setApplied(filters);
        if (focus) setFocusRequest((value) => value + 1);
      } catch (failure) {
        setError(
          failure instanceof ApiError && failure.status === 400 ? text.invalid : content.loadFailed,
        );
      } finally {
        setBusy(false);
      }
    },
    [content.loadFailed, fetchPage, text.invalid],
  );

  useEffect(() => {
    void run(emptyFilters, false);
  }, [run]);

  // Move focus to the results once the new page has rendered.
  useEffect(() => {
    if (focusRequest > 0) resultsRef.current?.focus();
  }, [focusRequest]);

  async function more() {
    if (!cursor || busy) return;
    setBusy(true);
    try {
      const page = await fetchPage(applied, cursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      setError(content.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  async function exportAs(format: 'json' | 'csv') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiPost(`${base}/export`, { format, filters: apiFilters(applied) });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `docoo-audit.${format}`;
      link.click();
      URL.revokeObjectURL(url);
      const count = Number(response.headers.get('x-export-count') ?? 0);
      setNotice(
        `${text.exported} (${formatNumber(locale, count)})${response.headers.get('x-export-truncated') === 'true' ? ` — ${text.truncated}` : ''}`,
      );
    } catch {
      setError(content.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(draft, true);
  }

  const field = (key: keyof Filters) => ({
    id: `audit-${key}`,
    name: key,
    value: String(draft[key]),
    onChange: (event: { target: { value: string } }) =>
      setDraft((current) => ({ ...current, [key]: event.target.value })),
  });

  return (
    <div className="stack">
      <form
        className="card filter-form"
        onSubmit={submit}
        aria-labelledby="filters-title"
        aria-busy={busy}
      >
        <h2 id="filters-title">{text.filters}</h2>
        <div className="filter-grid">
          <label htmlFor="audit-action">{text.action}</label>
          <input {...field('action')} dir="ltr" autoComplete="off" />
          <label htmlFor="audit-targetType">{text.targetType}</label>
          <input {...field('targetType')} dir="ltr" autoComplete="off" />
          <label htmlFor="audit-severity">{text.severity}</label>
          <select {...field('severity')}>
            <option value="">{text.anySeverity}</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
          <label htmlFor="audit-from">{text.from}</label>
          <input {...field('from')} type="date" />
          <label htmlFor="audit-to">{text.to}</label>
          <input {...field('to')} type="date" />
          <span />
          <label className="checkbox">
            <input
              type="checkbox"
              name="securityRelevant"
              checked={draft.securityRelevant}
              onChange={(event) =>
                setDraft((current) => ({ ...current, securityRelevant: event.target.checked }))
              }
            />
            {text.securityOnly}
          </label>
        </div>
        <div className="toolbar">
          <button className="primary-button" type="submit" disabled={busy}>
            {text.apply}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => {
              setDraft(emptyFilters);
              void run(emptyFilters, true);
            }}
          >
            {text.reset}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void exportAs('json')}
          >
            {text.exportJson}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void exportAs('csv')}
          >
            {text.exportCsv}
          </button>
        </div>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice ok" role="status">
          {notice}
        </p>
      )}
      <section className="card" aria-labelledby="results-title">
        <h2 id="results-title" tabIndex={-1} ref={resultsRef}>
          {text.results}{' '}
          {items && <span className="badge">{formatNumber(locale, items.length)}</span>}
        </h2>
        {items === null ? (
          <p role="status">{content.loading}</p>
        ) : items.length === 0 ? (
          <p className="muted">{content.none}</p>
        ) : (
          <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="results-title">
            <table>
              <thead>
                <tr>
                  <th scope="col">{text.when}</th>
                  <th scope="col">action</th>
                  <th scope="col">{text.severity}</th>
                  <th scope="col">{text.target}</th>
                  <th scope="col">{text.reason}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <time dateTime={item.occurredAt}>
                        {formatDateTime(locale, item.occurredAt)}
                      </time>
                    </td>
                    <td dir="ltr">{item.action}</td>
                    <td>
                      <span className={`badge severity-${item.severity}`}>{item.severity}</span>
                      {item.securityRelevant && (
                        <span className="badge severity-high">security</span>
                      )}
                    </td>
                    <td dir="ltr">
                      {item.targetType}
                      {item.targetId && <code> {item.targetId.slice(0, 8)}</code>}
                    </td>
                    <td>{item.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && (
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => void more()}
          >
            {text.loadMore}
          </button>
        )}
      </section>
    </div>
  );
}
