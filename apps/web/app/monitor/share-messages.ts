import type { Locale } from '../i18n';

/** The words of the share links: the owner's list and the page a visitor opens. */
const fa = {
  admin: {
    title: 'لینک اشتراک',
    text: 'یک آدرس با رمز بسازید تا هر کسی در اینترنت، بدون حساب، نمایشگر را ببیند. همان تنظیمات نمایشگر روی آن هم اعمال می‌شود.',
    kind: 'نمایشگر',
    kinds: { viewer: 'بیننده', voice: 'دستیار صوتی' },
    password: 'رمز (حداقل ۸ نویسه)',
    expiry: 'انقضا',
    expiries: {
      hour: 'یک ساعت',
      day: 'یک روز',
      week: 'هفت روز',
      month: 'سی روز',
      never: 'بدون انقضا',
      custom: 'تاریخ دلخواه',
    },
    maxSessions: 'حداکثر بیننده هم‌زمان',
    label: 'برچسب (اختیاری)',
    create: 'ساخت لینک',
    created: 'لینک ساخته شد. آدرس فقط همین یک بار نشان داده می‌شود؛ آن را اکنون کپی کنید.',
    copy: 'کپی',
    copied: 'کپی شد',
    empty: 'هنوز لینکی نساخته‌اید.',
    status: { active: 'فعال', expired: 'منقضی', revoked: 'لغوشده' },
    never: 'بدون انقضا',
    watching: 'در حال تماشا',
    revoke: 'لغو',
    revoked: 'لینک لغو شد.',
    failed: 'انجام نشد. ورودی‌ها را بررسی کنید.',
    loadFailed: 'فهرست لینک‌ها خوانده نشد.',
    badExpiry: 'تاریخ انقضا باید در آینده باشد.',
  },
  page: {
    title: 'نمایشگر',
    loading: 'در حال آماده‌شدن…',
    password: 'رمز',
    open: 'نمایش',
    wrong: 'رمز درست نیست.',
    tooMany: 'تلاش بیش از حد. کمی بعد دوباره امتحان کنید.',
    full: 'ظرفیت بینندگان این لینک پر است. به‌محض خالی‌شدن جا، خودکار نمایش داده می‌شود.',
    ended: 'این لینک دیگر معتبر نیست.',
    missing: 'این لینک وجود ندارد.',
    off: 'این نمایشگر خاموش است.',
    lost: 'ارتباط قطع شد؛ دوباره تلاش می‌شود…',
    live: 'پخش زنده',
  },
};

const en: typeof fa = {
  admin: {
    title: 'Share link',
    text: 'Make an address with a password so anyone on the internet, with no account, can watch the monitor. The monitor settings apply to it too.',
    kind: 'Monitor',
    kinds: { viewer: 'Viewer', voice: 'Voice assistant' },
    password: 'Password (at least 8 characters)',
    expiry: 'Expires',
    expiries: {
      hour: 'In one hour',
      day: 'In one day',
      week: 'In seven days',
      month: 'In thirty days',
      never: 'Never',
      custom: 'Pick a date',
    },
    maxSessions: 'Most watching at once',
    label: 'Label (optional)',
    create: 'Make link',
    created: 'The link is ready. The address is shown only this once; copy it now.',
    copy: 'Copy',
    copied: 'Copied',
    empty: 'No links yet.',
    status: { active: 'Active', expired: 'Expired', revoked: 'Revoked' },
    never: 'Never expires',
    watching: 'watching',
    revoke: 'Revoke',
    revoked: 'The link was revoked.',
    failed: 'It did not work. Check the fields.',
    loadFailed: 'The links could not be loaded.',
    badExpiry: 'The expiry must be in the future.',
  },
  page: {
    title: 'Monitor',
    loading: 'Getting ready…',
    password: 'Password',
    open: 'Show',
    wrong: 'The password is not correct.',
    tooMany: 'Too many attempts. Try again in a little while.',
    full: 'This link already has the most watchers it allows. The screen appears as soon as a place is free.',
    ended: 'This link is no longer valid.',
    missing: 'This link does not exist.',
    off: 'This monitor is switched off.',
    lost: 'The connection was lost; trying again…',
    live: 'Live',
  },
};

export const shareMessages = (locale: Locale) => (locale === 'en' ? en : fa);

/** The time a preset stands for, counted from `now`; null for "never" or a custom date. */
export function expiryFromPreset(preset: string, now: number): string | null {
  const hours: Record<string, number> = { hour: 1, day: 24, week: 24 * 7, month: 24 * 30 };
  const h = hours[preset];
  return h === undefined ? null : new Date(now + h * 3_600_000).toISOString();
}
