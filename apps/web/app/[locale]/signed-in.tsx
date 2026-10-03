'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import { messagesFor, type Locale } from '../i18n';
import { reportMessagesFor } from '../report-messages';
import { AppShell } from './app-shell';

export interface SessionIdentity {
  user: { id: string; email: string; displayName: string; role: 'super_admin' };
  workspaces: { id: string; code: string; name: string; role: 'super_admin' }[];
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
  const content = reportMessagesFor(locale);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) setState({ kind: 'guest' });
        else if (response.ok)
          setState({ kind: 'ready', identity: (await response.json()) as SessionIdentity });
        else setState({ kind: 'unavailable' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ kind: 'unavailable' });
      });
    return () => controller.abort();
  }, []);

  return (
    <AppShell
      locale={locale}
      title={title}
      subtitle={subtitle}
      showNavigation={state.kind === 'ready'}
    >
      {state.kind === 'loading' && <p role="status">{shell.checkingSession}</p>}
      {state.kind === 'unavailable' && <p className="notice error">{shell.unavailable}</p>}
      {state.kind === 'guest' && (
        <section className="auth-card">
          <p>{content.signInFirst}</p>
          <Link className="primary-button link-button" href={`/${locale}`}>
            {content.goToSignIn}
          </Link>
        </section>
      )}
      {state.kind === 'ready' && children(state.identity)}
    </AppShell>
  );
}
