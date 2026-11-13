import type { MonitorKind } from '@docoo/contracts';

import type { Locale } from '../i18n';

/**
 * Where a monitor window lives and what it is called (ADR-0056 §5-1). The window name is fixed per
 * kind, so opening a monitor again brings the same window forward instead of making a second one:
 * only one window of each kind is on show at any time.
 */
export const monitorWindowName = (kind: MonitorKind): string => `docoo-monitor-${kind}`;

export const monitorWindowPath = (locale: Locale, kind: MonitorKind): string =>
  `/${locale}/monitor/${kind}`;

/** A small separate window: the owner drags it to the room screen and goes full screen. */
export const monitorWindowFeatures = 'popup=yes,width=1280,height=720';

const WINDOW_PATH = /^\/(?:fa|en)\/monitor\/(?:(?:voice|viewer)|share\/[A-Za-z0-9_-]{43})\/?$/u;

/**
 * Whether a path is a monitor window. Such a window shows nothing of the back office: no menu, no
 * assistant button, no "AI is working" notice, and search engines and referrers are kept out.
 * A share link page is one too; its address is a secret, so no referrer matters most there.
 */
export const isMonitorWindowPath = (pathname: string | null | undefined): boolean =>
  typeof pathname === 'string' && WINDOW_PATH.test(pathname);
