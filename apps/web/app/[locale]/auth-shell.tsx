'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';

type Locale = 'fa' | 'en';

interface SessionIdentity {
  user: { id: string; email: string; displayName: string; role: 'super_admin' };
  workspaces: { id: string; code: string; name: string; role: 'super_admin' }[];
}

type View =
  | { kind: 'loading' }
  | { kind: 'guest' }
  | { kind: 'unavailable' }
  | { kind: 'authenticated'; identity: SessionIdentity };

const copy = {
  fa: {
    title: 'نمای کلی Docoo',
    subtitle: 'محیط مدیریت پروژه‌ها و جریان کار',
    navigation: 'ناوبری اصلی',
    overview: 'نمای کلی',
    upcoming: ['پروژه‌ها', 'دانش', 'ایجنت‌ها', 'اسناد', 'ممیزی'],
    comingSoon: 'در دست ساخت',
    changeLanguage: 'English',
    checkingSession: 'در حال بررسی نشست…',
    unavailable: 'ارتباط با سرویس برقرار نشد. وضعیت API را بررسی و دوباره تلاش کنید.',
    retry: 'تلاش دوباره',
    loginTitle: 'ورود ادمین',
    loginSubtitle: 'با ایمیل و گذرواژهٔ ادمین کل وارد شوید.',
    email: 'ایمیل',
    password: 'گذرواژه',
    signIn: 'ورود',
    signingIn: 'در حال ورود…',
    invalidCredentials: 'ایمیل یا گذرواژه درست نیست.',
    tooManyRequests: 'تلاش‌های ورود زیاد بوده است؛ کمی بعد دوباره امتحان کنید.',
    loginFailed: 'ورود انجام نشد. دوباره تلاش کنید.',
    signedInAs: 'وارد شده با',
    workspace: 'فضای کاری',
    signOut: 'خروج',
    signingOut: 'در حال خروج…',
    logoutFailed: 'خروج انجام نشد. دوباره تلاش کنید.',
    statusTitle: 'وضعیت سامانه',
    statusValue: 'زیرساخت آماده',
    nextTitle: 'مرحلهٔ بعد',
    nextValue: 'مدیریت حوزه و پروژه',
  },
  en: {
    title: 'Docoo overview',
    subtitle: 'Project and workflow administration',
    navigation: 'Primary navigation',
    overview: 'Overview',
    upcoming: ['Projects', 'Knowledge', 'Agents', 'Documents', 'Audit'],
    comingSoon: 'Coming soon',
    changeLanguage: 'فارسی',
    checkingSession: 'Checking your session…',
    unavailable: 'The API could not be reached. Check its status and try again.',
    retry: 'Try again',
    loginTitle: 'Administrator sign in',
    loginSubtitle: 'Enter your Super Admin email and password.',
    email: 'Email',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    invalidCredentials: 'The email or password is incorrect.',
    tooManyRequests: 'Too many sign-in attempts. Please try again later.',
    loginFailed: 'Sign-in failed. Please try again.',
    signedInAs: 'Signed in as',
    workspace: 'Workspace',
    signOut: 'Sign out',
    signingOut: 'Signing out…',
    logoutFailed: 'Sign-out failed. Please try again.',
    statusTitle: 'System status',
    statusValue: 'Foundation ready',
    nextTitle: 'Next slice',
    nextValue: 'Topic and project management',
  },
} as const;

export function AuthShell({ locale }: { locale: Locale }) {
  const content = copy[locale];
  const alternateLocale = locale === 'fa' ? 'en' : 'fa';
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
  }, [locale]);

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
    return () => controller.abort();
  }, []);

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
      } else if (response.status === 401) {
        setError(content.invalidCredentials);
      } else if (response.status === 429) {
        setError(content.tooManyRequests);
      } else {
        setError(content.loginFailed);
      }
    } catch {
      setError(content.loginFailed);
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
      setView({ kind: 'guest' });
      setEmail('');
      setPassword('');
    } catch {
      setError(content.logoutFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell" dir={locale === 'fa' ? 'rtl' : 'ltr'} lang={locale}>
      <aside className="sidebar" aria-label={content.navigation}>
        <p className="brand">Docoo</p>
        {view.kind === 'authenticated' && (
          <nav aria-label={content.navigation}>
            <ul className="nav-list">
              <li>
                <span className="nav-item" aria-current="page">
                  {content.overview}
                </span>
              </li>
              {content.upcoming.map((section) => (
                <li key={section}>
                  <span className="nav-item" aria-disabled="true">
                    {section} <small>{content.comingSoon}</small>
                  </span>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </aside>
      <main className="content">
        <header className="topbar">
          <div>
            <h1>{view.kind === 'authenticated' ? content.title : content.loginTitle}</h1>
            <p>{view.kind === 'authenticated' ? content.subtitle : content.loginSubtitle}</p>
          </div>
          <Link className="locale-link" href={`/${alternateLocale}`} hrefLang={alternateLocale}>
            {content.changeLanguage}
          </Link>
        </header>

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
            <form className="auth-form" onSubmit={(event) => void signIn(event)}>
              <label htmlFor="email">{content.email}</label>
              <input
                id="email"
                name="email"
                type="email"
                dir="ltr"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
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
                required
              />
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? content.signingIn : content.signIn}
              </button>
            </form>
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
                {content.workspace}: {view.identity.workspaces.map((item) => item.name).join(', ')}
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
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <div className="grid">
              <section className="card">
                <h2>{content.statusTitle}</h2>
                <span className="status">{content.statusValue}</span>
              </section>
              <section className="card">
                <h2>{content.nextTitle}</h2>
                <p>{content.nextValue}</p>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
