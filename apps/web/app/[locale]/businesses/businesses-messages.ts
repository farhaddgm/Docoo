import type { Locale } from '../../i18n';

const messages = {
  fa: {
    title: 'کسب‌وکارها',
    subtitle: 'پروفایل کسب‌وکارهایی که در Contenter تعریف شده‌اند',
    search: 'جستجوی نام یا حوزه',
    searchButton: 'جستجو',
    loading: 'در حال بارگذاری کسب‌وکارها…',
    empty: 'کسب‌وکاری پیدا نشد.',
    failed: 'فهرست کسب‌وکارها بارگذاری نشد؛ دوباره امتحان کنید.',
    notConfigured: 'اتصال Contenter هنوز تنظیم نشده است.',
    openIntegrations: 'تنظیم اتصال',
    industry: 'حوزه',
    location: 'مکان',
    language: 'زبان',
    website: 'وبسایت',
    sections: 'بخش‌های تکمیل‌شده',
    topics: 'حوزهٔ موضوعی',
    updated: 'آخرین به‌روزرسانی',
    previous: 'قبلی',
    next: 'بعدی',
    pageOf: 'صفحهٔ {page} از {total}',
    total: '{n} کسب‌وکار',
    unnamed: 'بدون نام',
  },
  en: {
    title: 'Businesses',
    subtitle: 'Business profiles defined in Contenter',
    search: 'Search by name or industry',
    searchButton: 'Search',
    loading: 'Loading businesses…',
    empty: 'No business found.',
    failed: 'The list of businesses could not be loaded; try again.',
    notConfigured: 'The Contenter connection is not set up yet.',
    openIntegrations: 'Set up the connection',
    industry: 'Industry',
    location: 'Location',
    language: 'Language',
    website: 'Website',
    sections: 'Sections filled',
    topics: 'Topics',
    updated: 'Last updated',
    previous: 'Previous',
    next: 'Next',
    pageOf: 'Page {page} of {total}',
    total: '{n} businesses',
    unnamed: 'Unnamed',
  },
} as const;

export function businessesMessages(locale: Locale) {
  return messages[locale];
}
