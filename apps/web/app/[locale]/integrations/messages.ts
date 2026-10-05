import type { Locale } from '../../i18n';
import { businessMessages } from '../projects/business-messages';

/** Strings of the integrations page (ADR-0021); the error table is shared with the business tab. */
const messages = {
  fa: {
    title: 'اتصال‌ها',
    subtitle: 'اتصال Docoo به سرویس‌های دیگر؛ فعلاً Contenter برای اطلاعات کسب‌وکار.',
    contenter: 'Contenter — اطلاعات کسب‌وکار',
    intro:
      'Docoo اطلاعات کسب‌وکارها را از Contenter می‌خواند (فقط خواندن) و ایجنت‌های هر پروژه بر اساس کسب‌وکار وصل‌شده کار می‌کنند. پروفایل کسب‌وکار فقط در Contenter ویرایش می‌شود تا در دو برنامه یکسان بماند.',
    stepsTitle: 'راه‌اندازی در سه قدم',
    steps: [
      'در سرور Contenter فایل apps/api/.env را باز کنید و یک مقدار تصادفی دست‌کم ۳۲ نویسه‌ای را با نام INTEGRATION_TOKEN بنویسید (مثلاً خروجی openssl rand -hex 32)، سپس Contenter را دوباره راه بیندازید.',
      'همان مقدار را پایین به‌عنوان «توکن سرویس» وارد کنید و نشانی API را بنویسید (مثلاً https://contenter.beeproject.ir/api).',
      'در ساخت پروژه (یا در تب «کسب‌وکار» هر پروژه) کسب‌وکار را انتخاب کنید.',
    ],
    status: 'وضعیت اتصال',
    notConfigured: 'هنوز اتصالی ثبت نشده است. فرم زیر را پر کنید.',
    statuses: {
      unconfigured: 'تنظیم نشده',
      healthy: 'سالم',
      invalid: 'توکن نامعتبر یا پاسخ نادرست',
      unreachable: 'در دسترس نیست',
    } as Record<string, string>,
    lastErrors: {
      unauthorized: 'Contenter توکن را نپذیرفت.',
      unreachable: 'به Contenter نرسید.',
      not_available: 'این نشانی سرویس Docoo را ندارد.',
      server_error: 'Contenter خطای داخلی داد.',
      bad_response: 'پاسخ Contenter درست نبود.',
      business_not_found: 'کسب‌وکار پیدا نشد.',
    } as Record<string, string>,
    apiUrl: 'نشانی API Contenter',
    apiUrlHelp: 'نشانی کامل تا /api، مثلاً https://contenter.beeproject.ir/api',
    webUrl: 'نشانی سایت Contenter (اختیاری)',
    webUrlHelp: 'برای دکمهٔ «باز کردن در Contenter»؛ مثلاً https://contenter.beeproject.ir',
    token: 'توکن سرویس',
    tokenHelp:
      'همان INTEGRATION_TOKEN در Contenter. یک بار وارد می‌شود، رمز ذخیره می‌شود و دیگر نمایش داده نمی‌شود.',
    tokenKeep: 'برای نگه‌داشتن توکن فعلی خالی بگذارید.',
    fingerprint: 'اثر انگشت توکن',
    lastChecked: 'آخرین بررسی',
    latency: 'تأخیر',
    ms: 'میلی‌ثانیه',
    save: 'ذخیره و بررسی اتصال',
    saving: 'در حال ذخیره و بررسی…',
    saved: 'ذخیره شد.',
    test: 'بررسی اتصال',
    tested: 'اتصال بررسی شد.',
    remove: 'حذف اتصال',
    removeTitle: 'حذف اتصال به Contenter؟',
    removeHelp:
      'پروژه‌ها به کسب‌وکارشان وصل می‌مانند و آخرین نسخهٔ ذخیره‌شده را نگه می‌دارند، اما تا اتصال دوباره تنظیم نشود همگام‌سازی و انتخاب کسب‌وکار کار نمی‌کند.',
    removeConfirm: 'حذف اتصال',
    removed: 'اتصال حذف شد.',
    cancel: 'انصراف',
    working: 'در حال انجام…',
    privacyTitle: 'یک نکتهٔ امنیتی',
    privacy:
      'اطلاعات کسب‌وکار هنگام کار ایجنت‌ها به ارائه‌دهندهٔ مدل هوش مصنوعی ارسال می‌شود (فقط بخش‌های لازم برای هر نقش). چیزی را که نباید به آنجا برسد در Contenter ننویسید.',
    loadFailed: 'بارگذاری اتصال انجام نشد. دوباره تلاش کنید.',
  },
  en: {
    title: 'Integrations',
    subtitle: 'Connect Docoo to other services; for now Contenter, for business information.',
    contenter: 'Contenter — business information',
    intro:
      'Docoo reads businesses from Contenter (read-only), and the agents of each project work from the linked business. A business profile is edited only in Contenter so it stays the same in both apps.',
    stepsTitle: 'Set up in three steps',
    steps: [
      'On the Contenter server open apps/api/.env and set INTEGRATION_TOKEN to a random value of at least 32 characters (for example the output of openssl rand -hex 32), then restart Contenter.',
      'Enter the same value below as the “Service token”, and the API address (for example https://contenter.beeproject.ir/api).',
      'When you create a project (or on the “Business” tab of one), choose the business.',
    ],
    status: 'Connection status',
    notConfigured: 'No connection yet. Fill in the form below.',
    statuses: {
      unconfigured: 'Not configured',
      healthy: 'Healthy',
      invalid: 'Invalid token or wrong answer',
      unreachable: 'Unreachable',
    } as Record<string, string>,
    lastErrors: {
      unauthorized: 'Contenter refused the token.',
      unreachable: 'Contenter could not be reached.',
      not_available: 'This address does not serve the Docoo API.',
      server_error: 'Contenter reported an internal error.',
      bad_response: "Contenter's answer was not valid.",
      business_not_found: 'The business was not found.',
    } as Record<string, string>,
    apiUrl: 'Contenter API address',
    apiUrlHelp: 'The full address up to /api, for example https://contenter.beeproject.ir/api',
    webUrl: 'Contenter site address (optional)',
    webUrlHelp: 'For the “Open in Contenter” button, for example https://contenter.beeproject.ir',
    token: 'Service token',
    tokenHelp:
      'The INTEGRATION_TOKEN of Contenter. It is entered once, stored encrypted and never shown again.',
    tokenKeep: 'Leave empty to keep the current token.',
    fingerprint: 'Token fingerprint',
    lastChecked: 'Last checked',
    latency: 'Latency',
    ms: 'ms',
    save: 'Save and check',
    saving: 'Saving and checking…',
    saved: 'Saved.',
    test: 'Check connection',
    tested: 'The connection was checked.',
    remove: 'Remove connection',
    removeTitle: 'Remove the connection to Contenter?',
    removeHelp:
      'Projects stay linked to their business and keep the last saved version, but syncing and choosing a business stop working until the connection is set up again.',
    removeConfirm: 'Remove connection',
    removed: 'The connection was removed.',
    cancel: 'Cancel',
    working: 'Working…',
    privacyTitle: 'A note on privacy',
    privacy:
      'While the agents work, business information is sent to the AI model provider (only the sections each role needs). Do not write in Contenter what must not reach it.',
    loadFailed: 'Could not load the connection. Try again.',
  },
} as const;

export function integrationMessages(locale: Locale) {
  const shared = businessMessages(locale);
  return { ...messages[locale], errors: shared.errors, failed: shared.failed, retry: shared.retry };
}
