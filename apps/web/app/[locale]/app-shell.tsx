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

/** Pages that exist; the others stay visible but disabled until their slice ships. */
const implemented: Partial<Record<NavigationKey, string>> = {
  dashboard: '',
  brain: '/brain',
  providers: '/providers',
  costs: '/costs',
  audit: '/audit',
};

interface AppShellProps {
  readonly locale: Locale;
  readonly title: string;
  readonly subtitle?: string;
  /** Navigation is only shown to signed-in administrators. */
  readonly showNavigation: boolean;
  readonly children: ReactNode;
}

/**
 * Shared RTL/LTR layout: skip link, landmarks, primary navigation and a language switch
 * that keeps the current page and session (FR-LOC-001..002, NFR-UX-003..004).
 */
export function AppShell({ locale, title, subtitle, showNavigation, children }: AppShellProps) {
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
      <div className="shell">
        <aside className="sidebar">
          <p className="brand">Docoo</p>
          {showNavigation && (
            <nav aria-label={content.navigation}>
              <ul className="nav-list">
                {navigation.map((key) => {
                  const route = implemented[key];
                  if (route === undefined) {
                    return (
                      <li key={key}>
                        <span className="nav-item" aria-disabled="true">
                          {content.nav[key]} <small>{content.comingSoon}</small>
                        </span>
                      </li>
                    );
                  }
                  const href = `/${locale}${route}` as Route;
                  return (
                    <li key={key}>
                      <Link
                        className="nav-item"
                        href={href}
                        aria-current={pathname === href ? 'page' : undefined}
                      >
                        {content.nav[key]}
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
            <a
              className="locale-link"
              href={localizedPath(pathname, alternate)}
              hrefLang={alternate}
              lang={alternate}
              aria-label={content.switchLanguageLabel}
            >
              {content.switchLanguage}
            </a>
          </header>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
