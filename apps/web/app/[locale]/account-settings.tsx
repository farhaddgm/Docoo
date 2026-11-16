'use client';

import type { Locale } from '../i18n';
import { ThemePicker } from '../theme-toggle';
import { AccountsScreen } from './accounts-screen';
import { AccountSecurity } from './account-security';
import { releases } from './release-notes';
import { SignedIn } from './signed-in';

const text = {
  fa: {
    title: 'تنظیمات حساب کاربری',
    subtitle: 'گذرواژه و دسترسی‌های حساب شما',
    users: 'کاربران و ورود',
    usersHint: 'مدیریت حساب‌ها، نقش‌ها و روش‌های ورود (فقط مدیران).',
    appearance: 'ظاهر',
    versions: 'نسخه‌های برنامه',
    latest: 'آخرین نسخه',
    version: 'نسخه',
    date: 'زمان انتشار',
    changes: 'تغییرات',
  },
  en: {
    title: 'Account settings',
    subtitle: 'Your password and account access',
    users: 'Users & sign-in',
    usersHint: 'Manage accounts, roles and sign-in methods (administrators only).',
    appearance: 'Appearance',
    versions: 'App versions',
    latest: 'Latest version',
    version: 'Version',
    date: 'Released',
    changes: 'Changes',
  },
} as const;

/** Settings of the signed-in account; "Users & sign-in" lives here for administrators. */
export function AccountSettings({ locale }: { readonly locale: Locale }) {
  const t = text[locale];
  return (
    <SignedIn locale={locale} title={t.title} subtitle={t.subtitle}>
      {(identity) => (
        <div className="stack">
          <section className="card stack" aria-labelledby="appearance-title">
            <h2 id="appearance-title">{t.appearance}</h2>
            <ThemePicker locale={locale} inline />
          </section>
          <AccountSecurity locale={locale} user={identity.user} />
          {identity.user.role === 'super_admin' && (
            <section className="card stack" aria-labelledby="users-title">
              <h2 id="users-title">{t.users}</h2>
              <p className="muted">{t.usersHint}</p>
              <AccountsScreen locale={locale} embedded />
            </section>
          )}
          <section className="card stack" aria-labelledby="versions-title">
            <h2 id="versions-title">{t.versions}</h2>
            <p className="muted">
              {t.latest}: <strong dir="ltr">{releases[0]!.v}</strong>
            </p>
            <div className="table-scroll" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t.version}</th>
                    <th scope="col">{t.date}</th>
                    <th scope="col">{t.changes}</th>
                  </tr>
                </thead>
                <tbody>
                  {releases.map((r) => (
                    <tr key={r.v}>
                      <td dir="ltr">{r.v}</td>
                      <td dir="ltr">{r.date}</td>
                      <td>{r[locale]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </SignedIn>
  );
}
