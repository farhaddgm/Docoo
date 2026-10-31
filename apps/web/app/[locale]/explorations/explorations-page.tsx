'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { apiGet, apiSend, query } from '../../api-client';
import { FieldLabel } from '../../info-tip';
import { formatDateTime, formatNumber, textDir, type Locale } from '../../i18n';
import { useSessionIdentity } from '../signed-in';
import { explainError, Notice, useAction } from '../use-action';
import { WorkspacePage } from '../workspace-page';
import type { ExplorationSummary } from './exploration-model';
import { explorationMessages } from './messages';

type View = 'open' | 'archived' | 'all';
const views: View[] = ['open', 'archived', 'all'];

export function ExplorationsPage({ locale }: { locale: Locale }) {
  const text = explorationMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <Explorations locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

/** The explorations of the workspace and the form that starts one (ADR-0044). */
function Explorations({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = explorationMessages(locale);
  const identity = useSessionIdentity();
  const readOnly = identity?.user.role === 'viewer';
  const base = `/workspaces/${workspaceId}/explorations`;
  const [view, setView] = useState<View>('open');
  const [items, setItems] = useState<ExplorationSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [form, setForm] = useState({ title: '', eventText: '' });
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);

  const load = useCallback(
    async (status: View) => {
      const page = await apiGet<{ items: ExplorationSummary[] }>(
        `${base}${query({ status, limit: '100' })}`,
      );
      setItems(page.items);
    },
    [base],
  );

  useEffect(() => {
    setItems(null);
    setLoadFailed(false);
    load(view).catch(() => setLoadFailed(true));
  }, [view, load]);

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await apiSend('POST', base, {
        title: form.title.trim(),
        eventText: form.eventText.trim(),
        outputLanguage: locale,
      });
      setForm({ title: '', eventText: '' });
      if (view === 'archived') setView('open');
      else await load(view);
    }, text.created);
  }

  return (
    <div className="stack">
      <Notice notice={notice} />
      {readOnly ? (
        <p className="notice" role="status">
          {text.readOnly}
        </p>
      ) : (
        <section className="card" aria-labelledby="exploration-new-title">
          <h2 id="exploration-new-title">{text.newTitle}</h2>
          <form className="filter-form" onSubmit={create} aria-busy={busy}>
            <div className="filter-grid">
              <label htmlFor="exploration-title">{text.titleLabel}</label>
              <input
                id="exploration-title"
                dir={textDir(locale)}
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                minLength={2}
                maxLength={200}
                autoComplete="off"
                required
              />
              <FieldLabel
                htmlFor="exploration-event"
                help={text.eventHelp}
                helpId="exploration-event-help"
              >
                {text.eventLabel}
              </FieldLabel>
              <textarea
                id="exploration-event"
                dir={textDir(locale)}
                rows={6}
                value={form.eventText}
                onChange={(event) => setForm({ ...form, eventText: event.target.value })}
                maxLength={5000}
                aria-describedby="exploration-event-help"
                required
              />
            </div>
            <div className="toolbar">
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? text.creating : text.createSubmit}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card" aria-labelledby="exploration-list-title">
        <div className="toolbar spread">
          <h2 id="exploration-list-title">{text.list}</h2>
          <div className="toolbar compact" role="group" aria-label={text.view}>
            {views.map((item) => (
              <button
                key={item}
                type="button"
                className={item === view ? 'primary-button' : 'secondary-button'}
                aria-pressed={item === view}
                onClick={() => setView(item)}
              >
                {text.views[item]}
              </button>
            ))}
          </div>
        </div>
        {loadFailed ? (
          <p className="notice error" role="alert">
            {text.loadFailed}
          </p>
        ) : items === null ? (
          <p role="status">…</p>
        ) : items.length === 0 ? (
          <div>
            <p className="muted">{text.empty}</p>
            {view === 'open' && !readOnly && <p className="muted">{text.emptyHint}</p>}
          </div>
        ) : (
          <ul className="plain-list">
            {items.map((item) => (
              <li key={item.id}>
                <p>
                  <Link href={`/${locale}/explorations/${item.id}` as Route}>
                    <strong dir={textDir(locale)}>{item.title}</strong>
                  </Link>
                  <span className="badge">{text.status[item.status]}</span>
                </p>
                <p className="muted">
                  {text.candidates}:{' '}
                  {item.candidateCount === 0
                    ? text.noCandidates
                    : (['proposed', 'parked', 'dropped', 'promoted'] as const)
                        .filter((state) => item.byState[state] > 0)
                        .map(
                          (state) =>
                            `${text.states[state]} ${formatNumber(locale, item.byState[state])}`,
                        )
                        .join(' · ')}
                  {' · '}
                  {text.updated}: {formatDateTime(locale, item.updatedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
