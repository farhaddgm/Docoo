'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useState } from 'react';

import { formatDateTime, formatNumber, type Locale } from '../i18n';
import { smartApi, type SmartError } from './api';
import { ErrorDetail } from './error-detail';
import { fill, smartMessagesFor } from './messages';

const POLL_MS = 10_000;

interface ErrorsTabProps {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly active: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
  readonly onChat: (error: SmartError) => void;
}

/** Recent errors inside the Smart window; the full filterable list is its own page. */
export function ErrorsTab({
  locale,
  workspaceId,
  active,
  selectedId,
  onSelect,
  onChat,
}: ErrorsTabProps) {
  const text = smartMessagesFor(locale);
  const [items, setItems] = useState<SmartError[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setItems((await smartApi.errors(workspaceId, { limit: '25' }, signal)).items);
        setFailed(false);
      } catch {
        if (!signal?.aborted) setFailed(true);
      }
    },
    [workspaceId],
  );

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(controller.signal);
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [active, load]);

  if (selectedId) {
    return (
      <ErrorDetail
        locale={locale}
        workspaceId={workspaceId}
        errorId={selectedId}
        onBack={() => onSelect(null)}
        onChat={onChat}
        onChanged={() => void load()}
      />
    );
  }

  return (
    <div className="smart-stack">
      {failed && <p className="notice error">{text.errors.loadFailed}</p>}
      {items && items.length === 0 && <p className="muted">{text.errors.empty}</p>}
      <ul className="smart-list">
        {items?.map((item) => (
          <li key={item.id}>
            <button type="button" className="smart-row" onClick={() => onSelect(item.id)}>
              <span className="smart-chips">
                <span className={`badge smart-status-${item.status}`}>
                  {text.errors.status[item.status]}
                </span>
                <span className="badge">{text.errors.category[item.category]}</span>
              </span>
              <span className="smart-row-title">{item.message}</span>
              <span className="muted">
                {fill(text.errors.occurrences, { n: formatNumber(locale, item.occurrences) })} ·{' '}
                {formatDateTime(locale, item.lastSeenAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <Link className="link-like" href={`/${locale}/smart/errors` as Route}>
        {text.errors.openPage}
      </Link>
    </div>
  );
}
