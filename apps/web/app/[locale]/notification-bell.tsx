'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiGet } from '../api-client';
import { formatNumber, type Locale } from '../i18n';
import { notificationMessages } from './notifications/notification-messages';

const POLL_MS = 30_000;

/** The notifications page fires this after it changes something, so the bell need not wait for its poll. */
export const NOTIFICATIONS_CHANGED = 'docoo:notifications-changed';

/** Header link to the notifications page with the number of unread ones (ADR-0025). */
export function NotificationBell({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = notificationMessages(locale);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (document.hidden) return;
      apiGet<{ unread: number }>(`/workspaces/${workspaceId}/notifications/summary`)
        .then((summary) => active && setUnread(summary.unread))
        // A failed poll leaves the last number; the page itself says when it cannot load.
        .catch(() => undefined);
    };
    load();
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
      className="secondary-button smart-toggle"
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
