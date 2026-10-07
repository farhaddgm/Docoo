'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { errorMessage, formatNumber, messagesFor, problemCode, type Locale } from '../i18n';
import { AppShell } from './app-shell';
import type { AccountRole } from '@docoo/contracts';
import { DashboardCards } from './dashboard-cards';
import { AccountSecurity } from './account-security';

interface SessionIdentity {
  user: {
    id: string;
    email: string;
    displayName: string;
    role: AccountRole;
    isOwner?: boolean;
    loginMethod?: string;
    hasPassword?: boolean;
  };
  workspaces: { id: string; code: string; name: string; role: AccountRole }[];
}

type View =
  | { kind: 'loading' }
  | { kind: 'guest'; notice?: string }
  | { kind: 'unavailable' }
  | { kind: 'authenticated'; identity: SessionIdentity };

export function AuthShell({
  locale,
  withPassword = false,
  loginPage = false,
}: {
  locale: Locale;
  withPassword?: boolean;
  loginPage?: boolean;
}) {
  const content = messagesFor(locale);
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const previousKind = useRef<View['kind']>('loading');

  useEffect(() => {
    const controller = new AbortController();

    async function loadSession() {
      try {
        const response = await fetch('/api/auth/session', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (response.status === 401) {
          setView({ kind: 'guest' });
        } else if (response.ok) {
          setView({ kind: 'authenticated', identity: (await response.json()) as SessionIdentity });
        } else {
          setView({ kind: 'unavailable' });
        }
      } catch {
        if (!controller.signal.aborted) setView({ kind: 'unavailable' });
      }
    }

    void loadSession();
    void fetch('/api/auth/providers', { cache: 'no-store' })
      .then((r) => r.json())
      .then((r: { google: boolean }) => setGoogleEnabled(r.google))
      .catch(() => undefined);
    const code = new URLSearchParams(location.search).get('error');
    const descriptions: Record<string, string> =
      locale === 'fa'
        ? {
            not_configured: 'ورود با گوگل روی سرور تنظیم نشده است.',
            cancelled: 'ورود لغو شد.',
            expired: 'مهلت ورود تمام شد؛ دوباره تلاش کنید.',
            not_gmail: 'فقط حساب جیمیل تأییدشده پذیرفته می‌شود.',
            not_allowed: 'این جیمیل اجازهٔ ورود ندارد؛ از مالک درخواست دسترسی کنید.',
            inactive: 'حساب شما غیرفعال است.',
            failed: 'ورود انجام نشد؛ دوباره تلاش کنید.',
          }
        : {
            not_configured: 'Google sign-in is not configured.',
            cancelled: 'Sign-in cancelled.',
            expired: 'Sign-in expired. Please try again.',
            not_gmail: 'Only verified Gmail accounts are accepted.',
            not_allowed: 'This Gmail account is not approved. Ask the owner for access.',
            inactive: 'Your account is inactive.',
            failed: 'Sign-in failed. Please try again.',
          };
    if (code) setGoogleError(descriptions[code] ?? descriptions['failed'] ?? '');
    return () => controller.abort();
  }, []);

  // Move focus to the new page heading when the view changes after user action.
  useEffect(() => {
    const changed =
      previousKind.current !== view.kind &&
      (previousKind.current !== 'loading' || view.kind === 'authenticated');
    previousKind.current = view.kind;
    if (changed) document.getElementById('page-title')?.focus();
  }, [view.kind]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: email, password }),
      });
      if (response.ok) {
        const identity = (await response.json()) as SessionIdentity;
        setPassword('');
        setView({ kind: 'authenticated', identity });
      } else {
        const code = response.status === 429 ? 'AUTH_RATE_LIMITED' : await problemCode(response);
        setError(errorMessage(locale, code));
      }
    } catch {
      setError(errorMessage(locale, undefined));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Logout failed');
      setEmail('');
      setPassword('');
      setView({ kind: 'guest', notice: content.signedOut });
    } catch {
      setError(errorMessage(locale, undefined));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (loginPage && view.kind === 'authenticated') location.replace(`/${locale}`);
  }, [loginPage, locale, view.kind]);
  const authenticated = view.kind === 'authenticated';
  return (
    <AppShell
      locale={locale}
      title={authenticated ? content.dashboardTitle : content.loginTitle}
      subtitle={authenticated ? content.dashboardSubtitle : content.loginSubtitle}
      identity={view.kind === 'authenticated' ? view.identity : undefined}
      showNavigation={authenticated}
      workspaceId={view.kind === 'authenticated' ? view.identity.workspaces[0]?.id : undefined}
    >
      {view.kind === 'loading' && <p role="status">{content.checkingSession}</p>}
      {view.kind === 'unavailable' && (
        <section className="auth-card" aria-live="polite">
          <p className="notice error">{content.unavailable}</p>
          <button className="primary-button" type="button" onClick={() => location.reload()}>
            {content.retry}
          </button>
        </section>
      )}
      {view.kind === 'guest' && (
        <section className="auth-card">
          {view.notice && (
            <p className="notice ok" role="status">
              {view.notice}
            </p>
          )}
          <p>
            {locale === 'fa'
              ? 'با جیمیل مجاز وارد شوید.'
              : 'Sign in with an approved Gmail account.'}
          </p>
          {googleError && (
            <p className="notice error" role="alert">
              {googleError}
            </p>
          )}
          <a
            className="primary-button link-button"
            aria-disabled={!googleEnabled}
            href={
              googleEnabled
                ? `/api/auth/google?redirectTo=${encodeURIComponent('/' + locale)}`
                : undefined
            }
          >
            {locale === 'fa' ? 'ورود با گوگل' : 'Sign in with Google'}
          </a>
          {withPassword && (
            <>
              <form className="auth-form" onSubmit={(event) => void signIn(event)} aria-busy={busy}>
                <label htmlFor="email">{content.email}</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  dir="ltr"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
                <label htmlFor="password">{content.password}</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
                {error && (
                  <p
                    id="login-error"
                    className="notice error"
                    role="alert"
                    tabIndex={-1}
                    ref={errorRef}
                  >
                    {error}
                  </p>
                )}
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? content.signingIn : content.signIn}
                </button>
              </form>
              <p className="form-footer">
                <Link href={`/${locale}/forgot-password`}>{content.forgotPassword}</Link>
              </p>
            </>
          )}
        </section>
      )}
      {view.kind === 'authenticated' && (
        <>
          <div className="session-bar">
            <p>
              {content.signedInAs} <strong>{view.identity.user.displayName}</strong>
              <span className="session-divider" aria-hidden="true">
                ·
              </span>
              {content.workspaces} ({formatNumber(locale, view.identity.workspaces.length)}):{' '}
              {view.identity.workspaces
                .map((item) => item.name)
                .join(locale === 'fa' ? '، ' : ', ')}
            </p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void signOut()}
              disabled={busy}
            >
              {busy ? content.signingOut : content.signOut}
            </button>
          </div>
          {error && (
            <p className="notice error" role="alert" tabIndex={-1} ref={errorRef}>
              {error}
            </p>
          )}
          {view.identity.workspaces[0] && (
            <DashboardCards locale={locale} workspaceId={view.identity.workspaces[0].id} />
          )}
          <AccountSecurity locale={locale} user={view.identity.user} />
        </>
      )}
    </AppShell>
  );
}
