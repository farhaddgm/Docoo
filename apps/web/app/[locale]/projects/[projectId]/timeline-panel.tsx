'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiGet, query } from '../../../api-client';
import { formatDateTime, type Locale } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { projectPageMessages } from './messages';

interface Entry {
  id: string;
  action: string;
  reason: string | null;
  severity: string;
  occurredAt: string;
}

/** PRJ-001 timeline: every audited event of the project, newest first. */
export function TimelinePanel({
  locale,
  workspaceId,
  projectId,
  refreshKey,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  refreshKey: number;
}) {
  const text = projectPageMessages(locale);
  const common = reportMessagesFor(locale);
  const base = `/workspaces/${workspaceId}/projects/${projectId}/timeline`;
  const [items, setItems] = useState<Entry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (cursor?: string) => {
      const page = await apiGet<{ items: Entry[]; nextCursor: string | null }>(
        `${base}${query({ limit: '50', cursor })}`,
      );
      setItems((current) => (cursor && current ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    },
    [base],
  );

  useEffect(() => {
    setFailed(false);
    load().catch(() => setFailed(true));
  }, [load, refreshKey]);

  return (
    <section className="card" aria-labelledby="timeline-title">
      <h2 id="timeline-title">{text.timelineTitle}</h2>
      {failed ? (
        <p className="notice error" role="alert">
          {common.loadFailed}
        </p>
      ) : items === null ? (
        <p role="status">{common.loading}</p>
      ) : items.length === 0 ? (
        <p className="muted">{text.timelineEmpty}</p>
      ) : (
        <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="timeline-title">
          <table>
            <thead>
              <tr>
                <th scope="col">{text.when}</th>
                <th scope="col">{text.action}</th>
                <th scope="col">{text.reason}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(locale, entry.occurredAt)}</td>
                  <th scope="row" dir="ltr">
                    {entry.action}
                    {entry.severity !== 'info' && (
                      <span className={`badge severity-${entry.severity}`}>{entry.severity}</span>
                    )}
                  </th>
                  <td dir="auto">{entry.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {nextCursor && (
        <div className="toolbar">
          <button
            className="secondary-button"
            type="button"
            onClick={() => void load(nextCursor).catch(() => setFailed(true))}
          >
            {text.loadMore}
          </button>
        </div>
      )}
    </section>
  );
}
