'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { errorMessage, messagesFor, problemCode, type Locale } from '../../i18n';
import { AppShell } from '../app-shell';

const minimumLength = 8;

/** Reads the single-use token from the URL fragment, which never reaches server logs. */
function tokenFromFragment(): string {
  const match = /(?:^#|&)token=([^&]+)/.exec(window.location.hash);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function ResetPasswordForm({ locale }: { locale: Locale }) {
  const content = messagesFor(locale);
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const value = tokenFromFragment();
    setToken(value);
    // Remove the token from the address bar and history once it is read.
    if (value) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (done || error) feedbackRef.current?.focus();
  }, [done, error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !token) return;
    if (password !== confirmation) {
      setError(content.passwordsDiffer);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/password/reset', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (response.ok) {
        setPassword('');
        setConfirmation('');
        setDone(true);
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

  return (
    <AppShell
      locale={locale}
      title={content.resetTitle}
      subtitle={content.resetSubtitle}
      showNavigation={false}
    >
      <section className="auth-card">
        {done && (
          <p className="notice ok" role="status" tabIndex={-1} ref={feedbackRef}>
            {content.resetDone}
          </p>
        )}
        {token === '' && !done && <p className="notice error">{content.resetLinkMissing}</p>}
        {token && !done && (
          <form className="auth-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
            <label htmlFor="new-password">{content.newPassword}</label>
            <input
              id="new-password"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              minLength={minimumLength}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={error ? 'reset-error' : undefined}
              required
            />
            <label htmlFor="confirm-password">{content.confirmPassword}</label>
            <input
              id="confirm-password"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              minLength={minimumLength}
              maxLength={128}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-describedby={error ? 'reset-error' : undefined}
              required
            />
            {error && (
              <p
                id="reset-error"
                className="notice error"
                role="alert"
                tabIndex={-1}
                ref={feedbackRef}
              >
                {error}
              </p>
            )}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? content.saving : content.savePassword}
            </button>
          </form>
        )}
        <p className="form-footer">
          {token === '' && !done ? (
            <Link href={`/${locale}/forgot-password`}>{content.resetRequestTitle}</Link>
          ) : (
            <Link href={`/${locale}`}>{content.backToSignIn}</Link>
          )}
        </p>
      </section>
    </AppShell>
  );
}
