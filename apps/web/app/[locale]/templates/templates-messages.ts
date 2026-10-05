import type { Locale } from '../../i18n';

const messages = {
  fa: {
    title: 'قالب‌ها و سطوح سند',
    subtitle:
      'قالب بخش‌های پیش‌نویس هر سند را تعیین می‌کند و سطح، بازهٔ طول رسمی آن را. هر تغییر با دلیل ثبت می‌شود و فقط روی اسنادی اثر دارد که بعد از آن ساخته شوند.',
    loading: 'در حال بارگذاری…',
    failed: 'بارگذاری نشد. اتصال را بررسی کنید و صفحه را تازه کنید.',
    levelsTitle: 'سطوح طول',
    levelsHelp:
      'هر سند در یکی از پنج سطح است و تعداد نویسه‌اش باید در بازهٔ آن سطح بیفتد. فقط حروف و ارقام شمرده می‌شوند (فاصله و علائم نگارشی نه). سطح هر سند بعداً هم در صفحهٔ خودش قابل‌تغییر است.',
    level: 'سطح {n}',
    min: 'حداقل نویسه',
    max: 'حداکثر نویسه',
    levelColumn: 'سطح',
    defaultLevel: 'سطح پیش‌فرض اسناد',
    defaultLevelHelp: 'اسنادی که از راه‌حل‌های انتخاب‌شده ساخته می‌شوند با این سطح شروع می‌کنند.',
    systemColumn: 'پیش‌فرض سامانه',
    systemBounds: 'از {min} تا {max}',
    restoreDefaults: 'بازگشت بازه‌ها به پیش‌فرض سامانه',
    boundsProblems: {
      not_whole: 'سطح {level}: عدد صحیح و نامنفی وارد کنید.',
      min_not_below_max: 'سطح {level}: حداقل باید کمتر از حداکثر باشد.',
      overlap: 'سطح {level} باید بالاتر از پایان سطح قبل شروع شود.',
    } as Record<string, string>,
    reasonLabel: 'دلیل تغییر',
    reasonHelp: 'در تاریخچه و Audit Log ثبت می‌شود.',
    saveLevels: 'ذخیرهٔ سطح‌ها',
    saving: 'در حال ذخیره…',
    savedLevels: 'سطح‌ها ذخیره شد؛ از اسناد بعدی اعمال می‌شود.',
    templatesTitle: 'قالب‌ها',
    templatesHelp:
      'قالب فقط چینش بخش‌ها را می‌دهد؛ متن هر بخش از راه‌حل و مسئلهٔ پروژه می‌آید، نه از قالب. قالب پیش‌فرض را هر پروژه یا حوزه می‌تواند برای خودش عوض کند.',
    defaultTemplate: 'قالب پیش‌فرض',
    isDefault: 'پیش‌فرض',
    sections: 'بخش‌ها',
    version: 'نسخهٔ قالب',
    saveTemplate: 'ذخیرهٔ قالب پیش‌فرض',
    savedTemplate: 'قالب پیش‌فرض ذخیره شد؛ از اسناد بعدی اعمال می‌شود.',
    names: {
      brief: 'کوتاه',
      standard: 'استاندارد',
      detailed: 'تفصیلی',
    } as Record<string, string>,
    purposes: {
      brief: 'تصمیم در یک صفحه: چه، چگونه و چه چیزی ممکن است اشتباه شود.',
      standard: 'پنج بخش الزامی هر راه‌حل: خلاصه، فرض‌ها، شواهد، برنامهٔ اجرا و ریسک‌ها.',
      detailed:
        'علاوه بر استاندارد، مسئله‌ای که به آن پاسخ می‌دهد و امتیاز راه‌حل روی معیارهای پروژه.',
    } as Record<string, string>,
    errors: {
      CONFIG_VALUE_INVALID: 'مقدار پذیرفته نشد؛ بازه‌ها را بررسی کنید.',
      CONFIG_VERSION_CONFLICT: 'این تنظیم در همین فاصله تغییر کرده است؛ صفحه را تازه کنید.',
    } as Record<string, string>,
    genericError: 'انجام نشد. اتصال را بررسی کنید و دوباره تلاش کنید.',
    moreSettings: 'تنظیم‌های دیگر سند (مثلاً تعداد راه‌حل) در صفحهٔ تنظیمات سامانه است.',
    openSettings: 'باز کردن تنظیمات سامانه',
  },
  en: {
    title: 'Templates and document levels',
    subtitle:
      'A template decides the sections of the first draft of each document and a level its official length range. Every change is recorded with a reason and only affects documents created after it.',
    loading: 'Loading…',
    failed: 'Could not load. Check the connection and reload the page.',
    levelsTitle: 'Length levels',
    levelsHelp:
      'Every document is at one of five levels and its character count must fall inside the range of that level. Only letters and digits are counted (not spaces or punctuation). The level of a single document can also be changed on its own page.',
    level: 'Level {n}',
    min: 'Minimum characters',
    max: 'Maximum characters',
    levelColumn: 'Level',
    defaultLevel: 'Default level of documents',
    defaultLevelHelp: 'Documents made from the selected solutions start at this level.',
    systemColumn: 'System default',
    systemBounds: 'From {min} to {max}',
    restoreDefaults: 'Put the ranges back to the system default',
    boundsProblems: {
      not_whole: 'Level {level}: enter a whole number of at least 0.',
      min_not_below_max: 'Level {level}: the minimum must be below the maximum.',
      overlap: 'Level {level} must start above the end of the previous level.',
    } as Record<string, string>,
    reasonLabel: 'Reason for the change',
    reasonHelp: 'Recorded in the history and the audit log.',
    saveLevels: 'Save the levels',
    saving: 'Saving…',
    savedLevels: 'Levels saved; they apply to the next documents.',
    templatesTitle: 'Templates',
    templatesHelp:
      'A template only gives the layout of the sections; the text of each section comes from the solution and the project’s problem, not from the template. Each project or topic can change the default for itself.',
    defaultTemplate: 'Default template',
    isDefault: 'default',
    sections: 'Sections',
    version: 'Template version',
    saveTemplate: 'Save the default template',
    savedTemplate: 'Default template saved; it applies to the next documents.',
    names: {
      brief: 'Brief',
      standard: 'Standard',
      detailed: 'Detailed',
    } as Record<string, string>,
    purposes: {
      brief: 'The decision on one page: what, how and what could go wrong.',
      standard:
        'The five required parts of every solution: summary, assumptions, evidence, plan and risks.',
      detailed:
        'Standard plus the problem it answers and how the solution scored on the project’s criteria.',
    } as Record<string, string>,
    errors: {
      CONFIG_VALUE_INVALID: 'The value was not accepted; check the ranges.',
      CONFIG_VERSION_CONFLICT: 'This setting changed in the meantime; reload the page.',
    } as Record<string, string>,
    genericError: 'That did not work. Check the connection and try again.',
    moreSettings:
      'Other document settings (such as the number of solutions) are on the System settings page.',
    openSettings: 'Open system settings',
  },
};

export type TemplatesText = (typeof messages)['fa'];

export function templatesMessages(locale: Locale): TemplatesText {
  return messages[locale];
}
