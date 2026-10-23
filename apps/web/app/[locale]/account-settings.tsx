'use client';

import Link from 'next/link';
import type { Route } from 'next';

import { messagesFor, type Locale } from '../i18n';
import { ThemePicker } from '../theme-toggle';
import { AccountSecurity } from './account-security';
import { SignedIn } from './signed-in';

const text = {
  fa: {
    title: 'تنظیمات حساب کاربری',
    subtitle: 'گذرواژه و دسترسی‌های حساب شما',
    users: 'کاربران و ورود',
    usersHint: 'مدیریت حساب‌ها، نقش‌ها و روش‌های ورود (فقط مدیران).',
    appearance: 'ظاهر',
  },
  en: {
    title: 'Account settings',
    subtitle: 'Your password and account access',
    users: 'Users & sign-in',
    usersHint: 'Manage accounts, roles and sign-in methods (administrators only).',
    appearance: 'Appearance',
  },
} as const;

/** Settings of the signed-in account; "Users & sign-in" lives here for administrators. */
export function AccountSettings({ locale }: { readonly locale: Locale }) {
  const t = text[locale];
  const shell = messagesFor(locale);
  return (
    <SignedIn locale={locale} title={t.title} subtitle={t.subtitle}>
      {(identity) => (
        <div className="stack">
          <section className="card stack" aria-labelledby="appearance-title">
            <h2 id="appearance-title">{t.appearance}</h2>
            <ThemePicker locale={locale} inline />
            <p className="muted">{shell.theme.pickerHint}</p>
          </section>
          <AccountSecurity locale={locale} user={identity.user} />
          {identity.user.role === 'super_admin' && (
            <section className="card">
              <h2>{t.users}</h2>
              <p>{t.usersHint}</p>
              <Link className="button" href={`/${locale}/admin/users` as Route}>
                {t.users}
              </Link>
            </section>
          )}
        </div>
      )}
    </SignedIn>
  );
}
