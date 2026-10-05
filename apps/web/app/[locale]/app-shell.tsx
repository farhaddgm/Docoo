'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import {
  direction,
  localizedPath,
  messagesFor,
  navigation,
  type Locale,
  type NavigationKey,
} from '../i18n';
import { SmartRoot, SmartToggle } from '../smart/smart-root';

/** Pages that exist; the others stay visible but disabled until their slice ships. */
const implemented: Partial<Record<NavigationKey, string>> = {
  dashboard: '',
  projects: '/projects',
  topics: '/topics',
  knowledge: '/knowledge',
  agents: '/agents',
  brain: '/brain',
  providers: '/providers',
  costs: '/costs',
  audit: '/audit',
  smart: '/smart/errors',
  templates: '/templates',
  settings: '/settings',
};

/** Stroke icon paths (24x24 grid), decorative only: the text label carries the meaning. */
const icons: Record<NavigationKey, string> = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  topics: 'M4 5h16M4 12h16M4 19h10',
  knowledge: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 0 2 2h13',
  agents:
    'M12 3v3M5 8h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM9 13v1M15 13v1',
  templates: 'M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z',
  brain:
    'M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5 4 4 0 0 0 8 0 3 3 0 0 0 2-5 3 3 0 0 0-2-5V7a4 4 0 0 0-4-4zM12 3v18',
  providers: 'M12 2l9 5v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12L3 7',
  costs:
    'M12 2v20M17 6.5C16 5 14.2 4.5 12 4.5c-2.8 0-4.5 1.3-4.5 3.2 0 4.6 9 2.2 9 7 0 2-1.8 3.3-4.5 3.3-2.3 0-4.2-.7-5.2-2.3',
  audit: 'M9 4h6l1 2h3v15H5V6h3zM9 13l2 2 4-4',
  smart:
    'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
};

function NavIcon({ name }: { name: NavigationKey }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={icons[name]} />
    </svg>
  );
}

interface AppShellProps {
  readonly locale: Locale;
  readonly title: string;
  readonly subtitle?: string;
  /** Navigation is only shown to signed-in administrators. */
  readonly showNavigation: boolean;
  /** Workspace of the signed-in administrator; enables Smart (docs/10-smart.md). */
  readonly workspaceId?: string | undefined;
  readonly children: ReactNode;
}

/**
 * Shared RTL/LTR layout: skip link, landmarks, primary navigation and a language switch
 * that keeps the current page and session (FR-LOC-001..002, NFR-UX-003..004).
 */
export function AppShell({
  locale,
  title,
  subtitle,
  showNavigation,
  workspaceId,
  children,
}: AppShellProps) {
  const content = messagesFor(locale);
  const alternate: Locale = locale === 'fa' ? 'en' : 'fa';
  const pathname = usePathname() || `/${locale}`;

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction(locale);
  }, [locale]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        {content.skipToContent}
      </a>
      <div className={showNavigation ? 'shell' : 'shell shell-guest'}>
        <aside className="sidebar">
          <p className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6" />
              </svg>
            </span>
            Docoo
          </p>
          {showNavigation && (
            <nav aria-label={content.navigation}>
              <ul className="nav-list">
                {navigation.map((key) => {
                  const route = implemented[key];
                  if (route === undefined) {
                    return (
                      <li key={key}>
                        <span className="nav-item" aria-disabled="true">
                          <NavIcon name={key} />
                          <span className="nav-label">
                            {content.nav[key]} <small>{content.comingSoon}</small>
                          </span>
                        </span>
                      </li>
                    );
                  }
                  const href = `/${locale}${route}` as Route;
                  // A page below a section (a project of /projects) keeps its section marked.
                  const current =
                    pathname === href ||
                    (route !== '' && pathname.startsWith(`${href}/`)) ||
                    // The two Smart pages share one navigation entry.
                    (key === 'smart' && pathname.startsWith(`/${locale}/smart`));
                  return (
                    <li key={key}>
                      <Link
                        className="nav-item"
                        href={href}
                        aria-current={current ? 'page' : undefined}
                      >
                        <NavIcon name={key} />
                        <span className="nav-label">{content.nav[key]}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          )}
        </aside>
        <div className="content">
          <header className="topbar">
            <div>
              <h1 id="page-title" tabIndex={-1}>
                {title}
              </h1>
              {subtitle && <p>{subtitle}</p>}
            </div>
            <div className="topbar-actions">
              {showNavigation && workspaceId && (
                <SmartToggle locale={locale} workspaceId={workspaceId} />
              )}
              <a
                className="locale-link"
                href={localizedPath(pathname, alternate)}
                // Keep the section the page is showing (`?tab=…`); the hash may hold a secret.
                onClick={(event) => {
                  event.currentTarget.href = `${localizedPath(location.pathname, alternate)}${location.search}`;
                }}
                hrefLang={alternate}
                lang={alternate}
                aria-label={content.switchLanguageLabel}
              >
                {content.switchLanguage}
              </a>
            </div>
          </header>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
      {showNavigation && workspaceId && <SmartRoot locale={locale} workspaceId={workspaceId} />}
    </>
  );
}
