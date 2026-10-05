import type { Locale } from '../../i18n';
import type { GroupId } from './settings-model';

const messages = {
  fa: {
    title: 'تنظیمات سامانه',
    subtitle:
      'مقدار پیش‌فرض همهٔ پروژه‌های این workspace. هر تغییر با دلیل ثبت و نسخه‌دار می‌شود و فقط روی اجراهایی اثر دارد که بعد از آن شروع شوند.',
    scopeHelp: {
      workspace:
        'این مقدارها پایهٔ همهٔ پروژه‌ها هستند. حوزه یا پروژه می‌تواند برای خودش آن را عوض کند، به‌جز تنظیم‌هایی که فقط در سطح workspace می‌مانند.',
      project:
        'مقدارهایی که فقط برای همین پروژه عوض می‌شوند. «بازگشت به مقدار ارث‌برده» یعنی مقدار از حوزه‌ها یا workspace گرفته شود.',
    },
    loading: 'در حال بارگذاری تنظیم‌ها…',
    failed: 'تنظیم‌ها بارگذاری نشد. اتصال را بررسی کنید و صفحه را تازه کنید.',
    groups: {
      workflow: {
        title: 'گردش‌کار و هزینه',
        help: 'تأیید انسانی، تعداد تلاش هر مرحله و سقف هزینهٔ هر اجرا.',
      },
      ai: {
        title: 'هوش مصنوعی',
        help: 'اتصال و مدل پیش‌فرض.',
      },
      analysis: {
        title: 'پرسش‌وپاسخ تحلیلگر',
        help: 'هشت بُعد لازم همیشه لازم می‌ماند؛ این‌جا می‌توانید ریسک و خارج از دامنه را هم لازم کنید.',
      },
      research: {
        title: 'تحقیق و دانش',
        help: 'چه مقدار دانش تأییدشده به مرحلهٔ تحقیق برسد.',
      },
      solutions: { title: 'راه‌حل‌ها', help: 'تعداد راه‌حل‌هایی که تولید می‌شود.' },
      documents: {
        title: 'اسناد',
        help: 'سطح طول و قالب پیش‌فرض اسناد خروجی.',
      },
      ingestion: {
        title: 'منبع‌ها و فایل‌ها',
        help: 'حداکثر حجم فایل و سیاست خواندن نشانی‌های وب.',
      },
    } satisfies Record<GroupId, { title: string; help: string }>,
    sources: {
      system: 'پیش‌فرض سامانه',
      workspace: 'workspace',
      topic: 'حوزه',
      project: 'همین پروژه',
      pending: 'انتخاب شما (با ساخت پروژه ذخیره می‌شود)',
    },
    sourceLabel: 'منبع مقدار',
    inheritedFrom: 'ارث‌برده از',
    notEnforced:
      'در این نسخه فقط ثبت می‌شود؛ هنوز مرحله‌ای از آن استفاده نمی‌کند و با آمدن قابلیتش اعمال می‌شود.',
    onProvidersPage: 'در صفحهٔ «ارائه‌دهندگان AI» تنظیم می‌شود',
    openProviders: 'باز کردن ارائه‌دهندگان AI',
    onTemplatesPage: 'در صفحهٔ «قالب‌ها و سطوح سند» ویرایش می‌شود',
    openTemplates: 'باز کردن قالب‌ها و سطوح سند',
    currentValue: 'مقدار مؤثر',
    defaultValue: 'پیش‌فرض سامانه',
    emptyValue: '(خالی)',
    yes: 'بله',
    no: 'خیر',
    onePerLine: 'هر مورد در یک خط',
    range: 'از {min} تا {max}',
    reasonLabel: 'دلیل تغییر',
    reasonHelp: 'در تاریخچه و Audit Log ثبت می‌شود.',
    save: 'ذخیره',
    saving: 'در حال ذخیره…',
    resetWorkspace: 'بازگشت به پیش‌فرض سامانه',
    resetProject: 'بازگشت به مقدار ارث‌برده',
    history: 'تاریخچه',
    hideHistory: 'بستن تاریخچه',
    historyEmpty: 'هنوز نسخه‌ای ثبت نشده است.',
    historyVersion: 'نسخهٔ {n}',
    historyCleared: 'پاک شد (به مقدار ارث‌برده برگشت)',
    historyRestored: 'بازگردانی نسخهٔ {n}',
    restore: 'بازگرداندن این نسخه',
    saved: 'ذخیره شد؛ «{key}» از اجراهای بعدی اعمال می‌شود.',
    reset: 'بازگشت انجام شد؛ «{key}» دوباره مقدار ارث‌برده را می‌گیرد.',
    restored: 'نسخه بازگردانده شد؛ «{key}» تغییر کرد.',
    enumLabels: {
      'ingestion.url_policy': {
        deny: 'هیچ نشانی خوانده نشود',
        allowlist: 'فقط نشانی‌های فهرست مجاز',
        public: 'هر نشانی عمومی',
      },
      'document.default_template': {
        brief: 'کوتاه',
        standard: 'استاندارد',
        detailed: 'تفصیلی',
      },
      'document.default_export_format': {
        docx: 'DOCX',
        pdf: 'PDF',
        pptx: 'PPTX',
      },
    } as Record<string, Record<string, string>>,
    problems: {
      required: 'مقدار لازم است.',
      not_a_number: 'یک عدد وارد کنید.',
      not_whole: 'عدد صحیح وارد کنید.',
      too_small: 'کمتر از {min} مجاز نیست.',
      too_large: 'بیشتر از {max} مجاز نیست.',
      too_long: 'حداکثر {max} نویسه.',
      bad_format: 'قالب مقدار درست نیست.',
      too_many: 'حداکثر {max} مورد.',
      not_allowed: 'مقدار انتخاب‌شده مجاز نیست.',
      item: 'خط {line}: مقدار معتبر نیست.',
    } as Record<string, string>,
    errors: {
      CONFIG_VALUE_INVALID: 'مقدار پذیرفته نشد؛ حدود و قالب را بررسی کنید.',
      CONFIG_VERSION_CONFLICT: 'این تنظیم در همین فاصله تغییر کرده است؛ صفحه را تازه کنید.',
      CONFIG_SCOPE_NOT_ALLOWED: 'این تنظیم در این سطح قابل‌تغییر نیست.',
      CONFIG_INVALID_REQUEST: 'درخواست معتبر نیست؛ ورودی‌ها را بررسی کنید.',
      CONFIG_SCOPE_READ_ONLY: 'این پروژه یا حوزه فقط‌خواندنی است؛ ابتدا آن را بازیابی کنید.',
      CONFIG_SCOPE_NOT_FOUND: 'این پروژه یا حوزه پیدا نشد.',
    } as Record<string, string>,
    picker: {
      connection: 'اتصال هوش مصنوعی',
      model: 'مدل',
      inherit: 'مقدار ارث‌برده (پیش‌فرض workspace)',
      chooseModel: 'یک مدل انتخاب کنید',
      noConnections: 'هنوز اتصالی ثبت نشده است. از صفحهٔ «ارائه‌دهندگان AI» یکی بسازید.',
      noModels: 'فهرست مدل‌های این اتصال خالی است؛ در صفحهٔ «ارائه‌دهندگان AI» به‌روزرسانی کنید.',
      structuredOutputOnly:
        'فقط مدل‌های دارای خروجی ساختاریافته (لازم برای مرحله‌ها) فهرست شده‌اند.',
      saveModel: 'ذخیرهٔ مدل پروژه',
    },
    genericError: 'انجام نشد. اتصال را بررسی کنید و دوباره تلاش کنید.',
  },
  en: {
    title: 'System settings',
    subtitle:
      'The defaults of every project in this workspace. Each change is recorded with a reason and versioned, and only affects runs that start after it.',
    scopeHelp: {
      workspace:
        'These values are the base of every project. A topic or a project may change them for itself, except settings that stay at workspace level.',
      project:
        'Values changed for this project only. "Back to the inherited value" takes the value from its topics or the workspace again.',
    },
    loading: 'Loading settings…',
    failed: 'The settings could not be loaded. Check the connection and reload the page.',
    groups: {
      workflow: {
        title: 'Workflow and cost',
        help: 'Human approval, attempts per stage and the cost ceiling of a run.',
      },
      ai: { title: 'Artificial intelligence', help: 'The default connection and model.' },
      analysis: {
        title: 'Analyst questions',
        help: 'The eight required dimensions always stay required; here you can also require risks and out of scope.',
      },
      research: {
        title: 'Research and knowledge',
        help: 'How much approved knowledge reaches the research stage.',
      },
      solutions: { title: 'Solutions', help: 'How many solutions are generated.' },
      documents: {
        title: 'Documents',
        help: 'The default length level and template of output documents.',
      },
      ingestion: {
        title: 'Sources and files',
        help: 'Maximum file size and the policy for reading web addresses.',
      },
    } satisfies Record<GroupId, { title: string; help: string }>,
    sources: {
      system: 'System default',
      workspace: 'workspace',
      topic: 'topic',
      project: 'this project',
      pending: 'your choice (saved with the new project)',
    },
    sourceLabel: 'Where the value comes from',
    inheritedFrom: 'Inherited from',
    notEnforced:
      'Only recorded in this version: no stage uses it yet; it applies once its feature ships.',
    onProvidersPage: 'Set on the "AI providers" page',
    openProviders: 'Open AI providers',
    onTemplatesPage: 'Edited on the "Templates and document levels" page',
    openTemplates: 'Open templates and document levels',
    currentValue: 'Effective value',
    defaultValue: 'System default',
    emptyValue: '(empty)',
    yes: 'Yes',
    no: 'No',
    onePerLine: 'One item per line',
    range: 'From {min} to {max}',
    reasonLabel: 'Reason for the change',
    reasonHelp: 'Recorded in the history and the audit log.',
    save: 'Save',
    saving: 'Saving…',
    resetWorkspace: 'Back to the system default',
    resetProject: 'Back to the inherited value',
    history: 'History',
    hideHistory: 'Close history',
    historyEmpty: 'No version has been recorded yet.',
    historyVersion: 'Version {n}',
    historyCleared: 'Cleared (back to the inherited value)',
    historyRestored: 'Restored version {n}',
    restore: 'Restore this version',
    saved: 'Saved; "{key}" applies from the next runs.',
    reset: 'Reset; "{key}" takes the inherited value again.',
    restored: 'Version restored; "{key}" changed.',
    enumLabels: {
      'ingestion.url_policy': {
        deny: 'Read no web address',
        allowlist: 'Only allow-listed addresses',
        public: 'Any public address',
      },
      'document.default_template': {
        brief: 'Brief',
        standard: 'Standard',
        detailed: 'Detailed',
      },
      'document.default_export_format': {
        docx: 'DOCX',
        pdf: 'PDF',
        pptx: 'PPTX',
      },
    } as Record<string, Record<string, string>>,
    problems: {
      required: 'A value is required.',
      not_a_number: 'Enter a number.',
      not_whole: 'Enter a whole number.',
      too_small: 'Must be at least {min}.',
      too_large: 'Must be at most {max}.',
      too_long: 'At most {max} characters.',
      bad_format: 'The value has an invalid format.',
      too_many: 'At most {max} items.',
      not_allowed: 'That value is not allowed.',
      item: 'Line {line}: not a valid value.',
    } as Record<string, string>,
    errors: {
      CONFIG_VALUE_INVALID: 'The value was not accepted; check its range and format.',
      CONFIG_VERSION_CONFLICT: 'This setting changed in the meantime; reload the page.',
      CONFIG_SCOPE_NOT_ALLOWED: 'This setting cannot be changed at this level.',
      CONFIG_INVALID_REQUEST: 'The request is not valid; check the inputs.',
      CONFIG_SCOPE_READ_ONLY: 'This project or topic is read-only; restore it first.',
      CONFIG_SCOPE_NOT_FOUND: 'This project or topic was not found.',
    } as Record<string, string>,
    picker: {
      connection: 'AI connection',
      model: 'Model',
      inherit: 'Inherited value (workspace default)',
      chooseModel: 'Choose a model',
      noConnections: 'No connection yet. Add one on the "AI providers" page.',
      noModels: 'This connection has no models listed; refresh them on the "AI providers" page.',
      structuredOutputOnly:
        'Only models with structured output (which the stages need) are listed.',
      saveModel: 'Save the project model',
    },
    genericError: 'That did not work. Check the connection and try again.',
  },
};

export type SettingsText = (typeof messages)['fa'];

export function settingsMessages(locale: Locale): SettingsText {
  return messages[locale];
}
