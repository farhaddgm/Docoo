'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiGet } from '../api-client';
import { formatNumber, type Locale } from '../i18n';
import { notificationMessages } from './notifications/notification-messages';

const POLL_MS = 30_000;

/**
 * Every page mounts its own shell, so the bell is rebuilt on each navigation. The last known count
 * lives here so the badge keeps its number across pages instead of dropping to zero and refilling.
 */
const lastUnread = new Map<string, { count: number; at: number }>();

/** The notifications page fires this after it changes something, so the bell need not wait for its poll. */
export const NOTIFICATIONS_CHANGED = 'docoo:notifications-changed';

/** Header link to the notifications page with the number of unread ones (ADR-0025). */
export function NotificationBell({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = notificationMessages(locale);
  const [unread, setUnread] = useState(() => lastUnread.get(workspaceId)?.count ?? 0);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (document.hidden) return;
      apiGet<{ unread: number }>(`/workspaces/${workspaceId}/notifications/summary`)
        .then((summary) => {
          lastUnread.set(workspaceId, { count: summary.unread, at: Date.now() });
          // Same number: no state change, so the badge does not re-render.
          if (active) setUnread(summary.unread);
        })
        // A failed poll leaves the last number; the page itself says when it cannot load.
        .catch(() => undefined);
    };
    // A fresh enough count from the previous page is kept; the poll below refreshes it later.
    const known = lastUnread.get(workspaceId);
    if (!known || Date.now() - known.at >= POLL_MS) load();
    const timer = setInterval(load, POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, [workspaceId]);

  return (
    <Link
      className="secondary-button smart-toggle icon-only"
      href={`/${locale}/notifications` as Route}
      aria-label={
        unread > 0 ? text.bellUnread.replace('{n}', formatNumber(locale, unread)) : text.bell
      }
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className="nav-icon"
      >
        <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0" />
      </svg>
      {unread > 0 && (
        <span className="badge" aria-hidden="true">
          {formatNumber(locale, unread)}
        </span>
      )}
    </Link>
  );
}
