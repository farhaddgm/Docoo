'use client';

import { useState, type FormEvent } from 'react';
import { errorMessage, problemCode, type Locale } from '../i18n';
import type { SessionIdentity } from './signed-in';

export function AccountSecurity({
  locale,
  user,
}: {
  locale: Locale;
  user: SessionIdentity['user'];
}) {
  const fa = locale === 'fa';
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const role = user.isOwner
    ? fa
      ? 'مالک'
      : 'Owner'
    : {
        super_admin: fa ? 'مدیر' : 'Administrator',
        editor: fa ? 'ویرایشگر' : 'Editor',
        viewer: fa ? 'مشاهده‌گر' : 'Viewer',
      }[user.role];
  const methods: Record<string, string> = {
    PASSWORD: fa ? 'رمز عبور' : 'Password',
    GOOGLE: fa ? 'جیمیل' : 'Gmail',
    BOTH: fa ? 'جیمیل و رمز عبور' : 'Gmail and password',
  };
  const method = methods[user.loginMethod ?? 'PASSWORD'];
  async function change(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setFeedback('');
    if (password !== confirmation) {
      setError(fa ? 'تکرار رمز عبور مطابقت ندارد.' : 'The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: password }),
      });
      if (!response.ok) {
        setError(errorMessage(locale, await problemCode(response)));
        return;
      }
      setCurrent('');
      setPassword('');
      setConfirmation('');
      setFeedback(
        fa
          ? 'رمز عبور تغییر کرد و نشست‌های دیگر بسته شدند.'
          : 'Password changed; other sessions were signed out.',
      );
    } catch {
      setError(errorMessage(locale, undefined));
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/me/sessions', { method: 'DELETE' });
      if (!response.ok) throw new Error();
      location.assign(`/${locale}/auth/login`);
    } catch {
      setError(errorMessage(locale, undefined));
      setBusy(false);
    }
  }
  return (
    <section className="card security-card">
      <h2>{fa ? 'حساب و امنیت' : 'Account and security'}</h2>
      <dl className="account-profile">
        <dt>{fa ? 'ایمیل' : 'Email'}</dt>
        <dd dir="ltr">{user.email}</dd>
        <dt>{fa ? 'نقش' : 'Role'}</dt>
        <dd>{role}</dd>
        <dt>{fa ? 'روش ورود' : 'Sign-in method'}</dt>
        <dd>{method}</dd>
      </dl>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {feedback && (
        <p role="status" className="notice ok">
          {feedback}
        </p>
      )}
      {user.hasPassword !== false && user.loginMethod !== 'GOOGLE' ? (
        <form className="auth-form" onSubmit={(event) => void change(event)}>
          <label htmlFor="current-password">{fa ? 'گذرواژهٔ فعلی' : 'Current password'}</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <label htmlFor="new-password">{fa ? 'گذرواژهٔ جدید' : 'New password'}</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <label htmlFor="confirm-new-password">
            {fa ? 'تکرار گذرواژهٔ جدید' : 'Confirm new password'}
          </label>
          <input
            id="confirm-new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
          <button className="primary-button" type="submit" disabled={busy}>
            {fa ? 'تغییر رمز عبور' : 'Change password'}
          </button>
        </form>
      ) : (
        <p>
          {fa
            ? 'این حساب فقط با جیمیل وارد می‌شود و رمز عبور ندارد.'
            : 'This account uses Gmail only and has no password.'}
        </p>
      )}
      <button
        className="secondary-button"
        type="button"
        disabled={busy}
        onClick={() => void revoke()}
      >
        {fa ? 'خروج از همهٔ دستگاه‌ها' : 'Sign out all devices'}
      </button>
    </section>
  );
}
