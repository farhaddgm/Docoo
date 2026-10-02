'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { errorMessage, messagesFor, problemCode, type Locale } from '../../i18n';
import { AppShell } from '../app-shell';

export function ForgotPasswordForm({ locale }: { locale: Locale }) {
  const content = messagesFor(locale);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (accepted || error) feedbackRef.current?.focus();
  }, [accepted, error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth/password/reset-request', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: email }),
      });
      if (response.ok) setAccepted(true);
      else {
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
      title={content.resetRequestTitle}
      subtitle={content.resetRequestSubtitle}
      showNavigation={false}
    >
      <section className="auth-card">
        {accepted ? (
          <p className="notice ok" role="status" tabIndex={-1} ref={feedbackRef}>
            {content.resetRequestAccepted}
          </p>
        ) : (
          <form className="auth-form" onSubmit={(event) => void submit(event)} aria-busy={busy}>
            <label htmlFor="reset-email">{content.email}</label>
            <input
              id="reset-email"
              type="email"
              dir="ltr"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'reset-request-error' : undefined}
              required
            />
            {error && (
              <p
                id="reset-request-error"
                className="notice error"
                role="alert"
                tabIndex={-1}
                ref={feedbackRef}
              >
                {error}
              </p>
            )}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? content.sending : content.sendResetLink}
            </button>
          </form>
        )}
        <p className="form-footer">
          <Link href={`/${locale}`}>{content.backToSignIn}</Link>
        </p>
      </section>
    </AppShell>
  );
}
