import type { Locale } from '../../i18n';
import { rateLimitErrors } from '../../rate-limit-messages';

const messages = {
  fa: {
    title: 'اعلان‌ها',
    subtitle: 'کارهایی که منتظر شما هستند و نتیجهٔ کارهایی که تمام شده‌اند',
    bell: 'اعلان‌ها',
    bellUnread: 'اعلان‌ها، {n} خوانده‌نشده',
    unread: 'خوانده‌نشده',
    all: 'همه',
    filter: 'نمایش',
    markRead: 'علامت خوانده',
    markAllRead: 'همه را خوانده کن',
    read: 'خوانده‌شده',
    empty: 'اعلان خوانده‌نشده‌ای نیست.',
    emptyAll: 'هنوز اعلانی نیست.',
    more: 'بیشتر',
    open: 'باز کردن',
    stillWaiting: 'هنوز منتظر شماست',
    handled: 'رسیدگی شده',
    project: 'پروژه',
    allDone: 'همه خوانده شد.',
    loadFailed: 'اعلان‌ها بارگذاری نشد؛ صفحه را تازه کنید.',
    failed: 'انجام نشد؛ دوباره امتحان کنید.',
    kinds: {
      gate_review: 'خروجی یک مرحله منتظر بازبینی شماست',
      analysis_answers: 'پرسش‌های تحلیلگر منتظر پاسخ شماست',
      agent_question: 'یک ایجنت از شما سؤال پرسیده است',
      attempt_limit: 'سقف تلاش یک مرحله پر شده است',
      provider_failure: 'ارائه‌دهندهٔ AI پاسخ نداد و پروژه متوقف شد',
      configuration: 'اتصال یا مدل AI تنظیم نشده و پروژه متوقف شد',
      cost_limit: 'سقف هزینهٔ پروژه رسید و پروژه متوقف شد',
      run_completed: 'اجرای پروژه کامل شد',
      writing_succeeded: 'نگارش سند تمام شد',
      writing_failed: 'نگارش سند ناموفق بود',
    } as Record<string, string>,
    errors: { ...rateLimitErrors.fa } as Record<string, string>,
  },
  en: {
    title: 'Notifications',
    subtitle: 'What waits for you and what has finished',
    bell: 'Notifications',
    bellUnread: 'Notifications, {n} unread',
    unread: 'Unread',
    all: 'All',
    filter: 'Show',
    markRead: 'Mark read',
    markAllRead: 'Mark all read',
    read: 'Read',
    empty: 'No unread notification.',
    emptyAll: 'No notification yet.',
    more: 'More',
    open: 'Open',
    stillWaiting: 'Still waiting for you',
    handled: 'Handled',
    project: 'Project',
    allDone: 'Everything is marked read.',
    loadFailed: 'Notifications could not be loaded; reload the page.',
    failed: 'That did not work; try again.',
    kinds: {
      gate_review: 'A stage output waits for your review',
      analysis_answers: 'Analyst questions wait for your answers',
      agent_question: 'An agent asked you a question',
      attempt_limit: 'A stage reached its attempt limit',
      provider_failure: 'The AI provider failed and the project paused',
      configuration: 'No AI connection or model is set and the project paused',
      cost_limit: 'The project reached its cost limit and paused',
      run_completed: 'A project run completed',
      writing_succeeded: 'A document was written',
      writing_failed: 'Writing a document failed',
    } as Record<string, string>,
    errors: { ...rateLimitErrors.en } as Record<string, string>,
  },
} as const;

export function notificationMessages(locale: Locale) {
  return messages[locale];
}

/** The section of the project page that deals with a kind of notification. */
export function notificationTab(kind: string): string {
  if (kind === 'analysis_answers') return 'problem';
  if (kind.startsWith('writing_')) return 'documents';
  return 'workflow';
}
