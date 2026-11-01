'use client';

import type { AccountRole, EffectiveAccess } from '@docoo/contracts';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { messagesFor, type Locale } from '../i18n';
import { AppShell } from './app-shell';
import { cachedSession, rememberSession } from './session-cache';

export interface SessionIdentity {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: AccountRole;
    isOwner?: boolean;
    loginMethod?: string;
    hasPassword?: boolean;
    /** What the owner's settings leave open to this account (ADR-0042). */
    access?: EffectiveAccess;
  };
  workspaces: { id: string; code: string; name: string; role: AccountRole }[];
}

const SessionContext = createContext<SessionIdentity | null>(null);
export function useSessionIdentity() {
  return useContext(SessionContext);
}

type State =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; identity: SessionIdentity };

/** Loads the session for an inner page; guests get a link to the sign-in page. */
export function SignedIn({
  locale,
  title,
  subtitle,
  children,
}: {
  readonly locale: Locale;
  readonly title: string;
  readonly subtitle: string;
  readonly children: (identity: SessionIdentity) => ReactNode;
}) {
  const shell = messagesFor(locale);
  const [state, setState] = useState<State>(() => {
    const known = cachedSession();
    return known ? { kind: 'ready', identity: known } : { kind: 'loading' };
  });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          rememberSession(null);
          setState({ kind: 'guest' });
          // Expired or missing session: go straight to the sign-in page, no intermediate screen.
          window.location.replace(`/${locale}/auth/login`);
        } else if (response.ok) {
          const identity = (await response.json()) as SessionIdentity;
          rememberSession(identity);
          setState({ kind: 'ready', identity });
        } else setState({ kind: 'unavailable' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'unavailable' });
      });
    return () => controller.abort();
  }, [locale]);

  return (
    <AppShell
      locale={locale}
      title={title}
      subtitle={subtitle}
      identity={state.kind === 'ready' ? state.identity : undefined}
      showNavigation={state.kind === 'ready'}
      workspaceId={state.kind === 'ready' ? state.identity.workspaces[0]?.id : undefined}
    >
      {state.kind === 'loading' && <p role="status">{shell.checkingSession}</p>}
      {state.kind === 'unavailable' && <p className="notice error">{shell.unavailable}</p>}
      {state.kind === 'guest' && <p role="status">{shell.checkingSession}</p>}
      {state.kind === 'ready' && (
        <SessionContext.Provider value={state.identity}>
          {children(state.identity)}
        </SessionContext.Provider>
      )}
    </AppShell>
  );
}
