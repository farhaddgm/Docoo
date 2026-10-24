'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import {
  direction,
  localizedPath,
  messagesFor,
  navigationGroups,
  type Locale,
  type NavigationKey,
} from '../i18n';
import { apiGet } from '../api-client';
import { SectionTitle } from '../info-tip';
import { SmartRoot, SmartToggle } from '../smart/smart-root';
import { NotificationBell } from './notification-bell';
import type { SessionIdentity } from './signed-in';
import { sidebarStorageKey } from '../theme';
import { ThemePicker } from '../theme-toggle';

/** Pages that exist; the others stay visible but disabled until their slice ships. */
const implemented: Partial<Record<NavigationKey, string>> = {
  dashboard: '',
  projects: '/projects',
  topics: '/topics',
  knowledge: '/knowledge',
  businesses: '/businesses',
  agents: '/agents',
  brain: '/brain',
  providers: '/providers',
  costs: '/costs',
  smart: '/smart/errors',
  settings: '/settings',
};

/** What an editor or viewer may open; the rest of the navigation is for administrators. */
const memberNavigation: readonly NavigationKey[] = [
  'dashboard',
  'projects',
  'topics',
  'knowledge',
  'businesses',
];

/** Pages only the owner may open: they hold the platform's keys, settings and agents. */
const ownerNavigation: readonly NavigationKey[] = [
  'providers',
  'settings',
  'agents',
];

type IconName =
  NavigationKey | 'users' | 'mail' | 'logout' | 'menu' | 'close' | 'workspace' | 'owner';

/** Stroke icon paths (24x24 grid), decorative only: the text label carries the meaning. */
const icons: Record<IconName, string> = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  topics: 'M4 5h16M4 12h16M4 19h10',
  knowledge: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 0 2 2h13',
  agents:
    'M12 3v3M5 8h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM9 13v1M15 13v1',
  businesses: 'M3 21h18M6 21V8h7v13M13 21V4h5v17M9 12h1M9 16h1M15 9h1M15 13h1',
  brain:
    'M12 3a4 4 0 0 0-4 4v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5 4 4 0 0 0 8 0 3 3 0 0 0 2-5 3 3 0 0 0-2-5V7a4 4 0 0 0-4-4zM12 3v18',
  providers: 'M12 2l9 5v10l-9 5-9-5V7zM12 12l9-5M12 12v10M12 12L3 7',
  costs:
    'M12 2v20M17 6.5C16 5 14.2 4.5 12 4.5c-2.8 0-4.5 1.3-4.5 3.2 0 4.6 9 2.2 9 7 0 2-1.8 3.3-4.5 3.3-2.3 0-4.2-.7-5.2-2.3',
  smart:
    'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  users:
    'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  workspace: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  // A crown: the owner's own mark.
  owner: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5zM5 21h14',
};

function Icon({ name, className = 'nav-icon' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
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

function Brand() {
  return (
    <p className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" />
        </svg>
      </span>
      Docoo
    </p>
  );
}

const projectNames = new Map<string, string>();

/** The project the page is about (`/projects/<id>/…`), so the top bar can say what is being worked on. */
function useCurrentProject(pathname: string, workspaceId: string | undefined): string | null {
  const id = /^\/[a-z]{2}\/projects\/([^/]+)/u.exec(pathname)?.[1];
  const projectId = id && id !== 'new' ? id : undefined;
  const [loaded, setLoaded] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (!projectId || !workspaceId || projectNames.has(projectId)) return;
    const controller = new AbortController();
    apiGet<{ project: { code: string; title: string } }>(
      `/workspaces/${workspaceId}/projects/${projectId}`,
      controller.signal,
    )
      .then(({ project }) => {
        projectNames.set(projectId, project.title);
        setLoaded({ id: projectId, name: project.title });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [projectId, workspaceId]);

  if (!projectId) return null;
  return projectNames.get(projectId) ?? (loaded?.id === projectId ? loaded.name : null);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[1]] : [...(parts[0] ?? '?')].slice(0, 2);
  return letters.map((part) => [...(part ?? '')][0] ?? '').join('');
}

interface AppShellProps {
  readonly identity?: SessionIdentity | undefined;
  readonly locale: Locale;
  readonly title: string;
  readonly subtitle?: string;
  /** Navigation is only shown to signed-in administrators. */
  readonly showNavigation: boolean;
  /** Workspace of the signed-in administrator; enables Smart (docs/10-smart.md). */
  readonly workspaceId?: string | undefined;
  /** Signs out in place (the sign-in page then shows its notice); otherwise the shell reloads. */
  readonly onSignOut?: () => void;
  readonly signOutBusy?: boolean;
  readonly children: ReactNode;
}

/**
 * Shared RTL/LTR layout: skip link, landmarks, primary navigation and a language switch
 * that keeps the current page and session (FR-LOC-001..002, NFR-UX-003..004).
 */
export function AppShell({
  identity,
  locale,
  title,
  subtitle,
  showNavigation,
  workspaceId,
  onSignOut,
  signOutBusy = false,
  children,
}: AppShellProps) {
  const content = messagesFor(locale);
  const alternate: Locale = locale === 'fa' ? 'en' : 'fa';
  const pathname = usePathname() || `/${locale}`;
  // Narrow screens fold the navigation into a drawer; it closes again on every page change.
  const [menu, setMenu] = useState({ open: false, path: pathname });
  const menuOpen = menu.open && menu.path === pathname;
  const [leaving, setLeaving] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountButtonRef = useRef<HTMLButtonElement>(null);
  const accountPopupRef = useRef<HTMLDivElement>(null);
  // The popup is drawn outside the sidebar (which clips and scrolls) and placed beside the button.
  const [accountPlace, setAccountPlace] = useState<{
    bottom: number;
    inline: number;
  } | null>(null);
  // The desktop sidebar folds to an icon rail; the inline script in <head> has already applied it.
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = !identity || identity.user.role === 'super_admin';
  const projectName = useCurrentProject(pathname, workspaceId);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction(locale);
  }, [locale]);

  useEffect(() => {
    setCollapsed(document.documentElement.dataset['sidebar'] === 'collapsed');
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    if (next) document.documentElement.dataset['sidebar'] = 'collapsed';
    else delete document.documentElement.dataset['sidebar'];
    try {
      if (next) localStorage.setItem(sidebarStorageKey, 'collapsed');
      else localStorage.removeItem(sidebarStorageKey);
    } catch {
      // Blocked storage: the sidebar just stays as chosen until the page is closed.
    }
  }

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu({ open: false, path: pathname });
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [menuOpen, pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const place = () => {
      const button = accountButtonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const rtl = document.documentElement.dir === 'rtl';
      setAccountPlace({
        bottom: window.innerHeight - rect.top + 8,
        inline: rtl ? window.innerWidth - rect.right : rect.left,
      });
    };
    place();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setAccountOpen(false);
      accountButtonRef.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (accountButtonRef.current?.contains(target) || accountPopupRef.current?.contains(target))
        return;
      setAccountOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', place);
    };
  }, [accountOpen]);

  async function signOutHere() {
    if (leaving) return;
    setLeaving(true);
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Logout failed');
      location.assign(`/${locale}`);
    } catch {
      setLeaving(false);
    }
  }

  const topbarActions = (
    <div className="topbar-actions">
      {showNavigation && workspaceId && (
        <NotificationBell locale={locale} workspaceId={workspaceId} />
      )}
      {showNavigation && workspaceId && isAdmin && (
        <SmartToggle locale={locale} workspaceId={workspaceId} />
      )}
      {!showNavigation && <ThemePicker locale={locale} />}
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
  );

  const pageHead = (
    <div className="page-head">
      <SectionTitle as="h1" id="page-title" focusable help={subtitle}>
        {title}
      </SectionTitle>
    </div>
  );

  const skipLink = (
    <a className="skip-link" href="#main-content">
      {content.skipToContent}
    </a>
  );

  if (!showNavigation) {
    return (
      <>
        {skipLink}
        <div className="shell shell-guest">
          <header className="guest-bar">
            <Brand />
            {topbarActions}
          </header>
          <div className="content">
            {pageHead}
            <main id="main-content" tabIndex={-1}>
              {children}
            </main>
          </div>
        </div>
      </>
    );
  }

  const isOwner = !identity || identity.user.isOwner === true;
  const visible = (key: NavigationKey) =>
    (isAdmin || memberNavigation.includes(key)) && (isOwner || !ownerNavigation.includes(key));
  // A page of an owner-only section (agents/analyst below agents, but not the users page).
  const ownerSection = ownerNavigation.some((key) => {
    const route = implemented[key];
    return (
      !pathname.startsWith(`/${locale}/settings/google-access`) &&
      !pathname.startsWith(`/${locale}/account`) &&
      route !== undefined &&
      route !== '' &&
      (pathname === `/${locale}${route}` || pathname.startsWith(`/${locale}${route}/`))
    );
  });
  const roleLabel = identity
    ? identity.user.isOwner
      ? content.roles.owner
      : content.roles[identity.user.role]
    : '';
  const closeMenu = () => setMenu({ open: false, path: pathname });

  return (
    <>
      {skipLink}
      <div className="shell">
        <aside id="app-sidebar" className={menuOpen ? 'sidebar sidebar-open' : 'sidebar'}>
          <div className="sidebar-head">
            <Brand />
          </div>
          <nav className="sidebar-nav" aria-label={content.navigation}>
            {navigationGroups.map((group) => {
              const keys = group.items.filter(visible);
              if (keys.length === 0) return null;
              return (
                <div className="nav-group" key={group.key}>
                  <p className="nav-group-label">{content.navGroups[group.key]}</p>
                  <ul className="nav-list">
                    {keys.map((key) => {
                      const route = implemented[key];
                      if (route === undefined) {
                        return (
                          <li key={key}>
                            <span
                              className="nav-item"
                              aria-disabled="true"
                              title={content.nav[key]}
                            >
                              <Icon name={key} />
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
                            title={content.nav[key]}
                          >
                            <Icon name={key} />
                            <span className="nav-label">{content.nav[key]}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>
          {identity && (
            <div className="sidebar-foot">
              <button
                ref={accountButtonRef}
                type="button"
                className="user-chip user-chip-button"
                title={identity.user.displayName}
                aria-haspopup="menu"
                aria-expanded={accountOpen}
                aria-controls="account-menu"
                aria-label={`${content.accountMenu.open}: ${identity.user.displayName}`}
                onClick={() => setAccountOpen((value) => !value)}
              >
                <span className="avatar" aria-hidden="true">
                  {initials(identity.user.displayName)}
                </span>
                <span className="user-chip-text">
                  <span className="user-chip-name">{identity.user.displayName}</span>
                  <span className="user-chip-meta">{roleLabel}</span>
                </span>
              </button>
              {accountOpen &&
                accountPlace &&
                createPortal(
                  <div
                    id="account-menu"
                    ref={accountPopupRef}
                    className="account-menu"
                    role="menu"
                    dir={direction(locale)}
                    style={{ bottom: accountPlace.bottom, insetInlineStart: accountPlace.inline }}
                  >
                    <Link
                      className="account-menu-item"
                      role="menuitem"
                      href={`/${locale}/account` as Route}
                      onClick={() => setAccountOpen(false)}
                    >
                      <Icon name="settings" />
                      <span>{content.accountMenu.settings}</span>
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      className="account-menu-item account-menu-danger"
                      disabled={onSignOut ? signOutBusy : leaving}
                      onClick={onSignOut ? () => onSignOut() : () => void signOutHere()}
                    >
                      <Icon name="logout" />
                      <span>{onSignOut && signOutBusy ? content.signingOut : content.signOut}</span>
                    </button>
                  </div>,
                  document.body,
                )}
            </div>
          )}
        </aside>
        <div
          className={menuOpen ? 'sidebar-overlay open' : 'sidebar-overlay'}
          aria-hidden="true"
          onClick={closeMenu}
        />
        <div className="main-column">
          <header className="topbar">
            <button
              type="button"
              className="menu-button menu-drawer"
              aria-controls="app-sidebar"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? content.closeMenu : content.menu}
              onClick={() => setMenu({ open: !menuOpen, path: pathname })}
            >
              <Icon name={menuOpen ? 'close' : 'menu'} className="" />
            </button>
            <button
              type="button"
              className="menu-button menu-collapse"
              aria-controls="app-sidebar"
              aria-expanded={!collapsed}
              aria-label={collapsed ? content.expandSidebar : content.collapseSidebar}
              title={collapsed ? content.expandSidebar : content.collapseSidebar}
              onClick={toggleCollapsed}
            >
              <Icon name="menu" className="" />
            </button>
            <div className="topbar-title">
              <SectionTitle as="h1" id="page-title" focusable help={subtitle}>
                {title}
              </SectionTitle>
              {ownerSection && isOwner && (
                <span className="owner-crown" role="img" aria-label={content.ownerOnlyBadge}>
                  <Icon name="owner" className="" />
                </span>
              )}
            </div>
            {projectName && (
              <div className="topbar-context">
                <span className="workspace-chip" title={projectName}>
                  <Icon name="projects" className="" />
                  {projectName}
                </span>
              </div>
            )}
            {topbarActions}
          </header>
          <div className="content">
            <main id="main-content" tabIndex={-1}>
              {ownerSection && !isOwner ? (
                <p className="notice error" role="alert">
                  {content.ownerOnlyDenied}
                </p>
              ) : (
                children
              )}
            </main>
          </div>
        </div>
      </div>
      {workspaceId && isAdmin && <SmartRoot locale={locale} workspaceId={workspaceId} />}
    </>
  );
}
