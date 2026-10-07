'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { apiGet, apiSend } from '../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { SignedIn } from '../signed-in';
import { explainError, Notice, useAction } from '../use-action';
import { NOTIFICATIONS_CHANGED } from '../notification-bell';
import { notificationMessages, notificationTab } from './notification-messages';

interface Item {
  id: string;
  kind: string;
  projectId: string | null;
  project: { code: string; title: string } | null;
  createdAt: string;
  readAt: string | null;
  stillWaiting: boolean | null;
}

interface Page {
  items: Item[];
  nextCursor: string | null;
}

export function NotificationsPage({ locale }: { locale: Locale }) {
  const text = notificationMessages(locale);
  return (
    <SignedIn locale={locale} title={text.title} subtitle={text.subtitle}>
      {(identity) =>
        identity.workspaces[0] ? (
          <List locale={locale} workspaceId={identity.workspaces[0].id} />
        ) : null
      }
    </SignedIn>
  );
}

/** ADR-0025: what waits for the administrator and what has finished, newest first. */
function List({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = notificationMessages(locale);
  const base = `/workspaces/${workspaceId}/notifications`;
  const [status, setStatus] = useState<'unread' | 'all'>('unread');
  const [items, setItems] = useState<Item[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);

  const load = useCallback(
    async (cursor?: string) => {
      const query = `?status=${status}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await apiGet<Page>(`${base}${query}`);
      setItems((current) => (cursor && current ? [...current, ...page.items] : page.items));
      setNext(page.nextCursor);
      setFailed(false);
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
    },
    [base, status],
  );

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  function markRead(id: string) {
    void run(async () => {
      await apiSend('POST', `${base}/${id}/read`, {});
      await load();
    }, '');
  }

  function markAll() {
    void run(async () => {
      await apiSend('POST', `${base}/read-all`, {});
      await load();
    }, text.allDone);
  }

  return (
    <div className="stack">
      <Notice notice={notice} />
      <section className="card stack" aria-labelledby="notifications-heading">
        <div className="toolbar spread">
          <h2 id="notifications-heading">{text.title}</h2>
          <div className="toolbar">
            <label htmlFor="notification-filter">{text.filter}</label>
            <select
              id="notification-filter"
              value={status}
              onChange={(event) => setStatus(event.target.value as 'unread' | 'all')}
            >
              <option value="unread">{text.unread}</option>
              <option value="all">{text.all}</option>
            </select>
            <button className="secondary-button" type="button" disabled={busy} onClick={markAll}>
              {text.markAllRead}
            </button>
          </div>
        </div>
        {failed && (
          <p className="notice error" role="alert">
            {text.loadFailed}
          </p>
        )}
        {items && items.length === 0 && (
          <p className="muted">{status === 'unread' ? text.empty : text.emptyAll}</p>
        )}
        {items && items.length > 0 && (
          <ul className="plain-list" aria-label={text.title}>
            {items.map((item) => (
              <li key={item.id}>
                <strong>{text.kinds[item.kind] ?? item.kind}</strong>{' '}
                {item.readAt === null ? (
                  <span className="badge">{text.unread}</span>
                ) : (
                  <small className="muted">{text.read}</small>
                )}
                <br />
                <small className="muted">
                  {formatDateTime(locale, item.createdAt)}
                  {item.project && (
                    <>
                      {' · '}
                      {text.project}: <span dir="ltr">{item.project.code}</span>
                    </>
                  )}
                  {item.stillWaiting !== null && (
                    <> · {item.stillWaiting ? text.stillWaiting : text.handled}</>
                  )}
                </small>
                <div className="toolbar">
                  {item.projectId && (
                    <Link
                      href={
                        `/${locale}/projects/${item.projectId}?tab=${notificationTab(item.kind)}` as Route
                      }
                      onClick={() => item.readAt === null && markRead(item.id)}
                    >
                      {text.open}
                    </Link>
                  )}
                  {item.readAt === null && (
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={busy}
                      onClick={() => markRead(item.id)}
                    >
                      {text.markRead}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {next && (
          <div className="toolbar">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void run(() => load(next), '')}
            >
              {text.more} ({formatNumber(locale, items?.length ?? 0)})
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
