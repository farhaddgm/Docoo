import type { Locale } from '../../i18n';

const messages = {
  fa: {
    title: 'ارائه‌دهندگان AI',
    subtitle: 'کلید API را یک بار وارد کنید؛ کلید رمز می‌شود و دیگر نمایش داده نمی‌شود.',
    connections: 'اتصال‌ها',
    none: 'هنوز اتصالی ثبت نشده است. از فرم زیر یکی بسازید.',
    add: 'افزودن اتصال',
    provider: 'ارائه‌دهنده',
    name: 'نام دلخواه',
    apiKey: 'کلید API',
    keyHelp: {
      openai: 'از platform.openai.com ← API keys ← Create new secret key',
      gemini: 'از aistudio.google.com ← Get API key',
      anthropic: 'از console.anthropic.com ← API Keys ← Create Key',
      elevenlabs: 'از elevenlabs.io ← Developers ← API Keys',
    },
    voiceOnly:
      'ElevenLabs فقط برای گفتگوی صوتی است؛ برای اجرای مرحله‌ها یا مدل پیش‌فرض انتخاب نمی‌شود. انتخابش در تنظیمات سامانه ← گفتگوی صوتی است.',
    save: 'ذخیره و بررسی اتصال',
    saving: 'در حال ذخیره و بررسی…',
    check: 'بررسی سلامت',
    refresh: 'به‌روزرسانی فهرست مدل‌ها',
    remove: 'حذف',
    removeLabel: 'حذف اتصال «{name}»',
    removeHeading: 'تأیید حذف اتصال',
    removeHelp:
      'اتصال برای همیشه غیرفعال می‌شود و از این فهرست کنار می‌رود. تاریخچهٔ مصرف و هزینه‌اش می‌ماند. برای استفادهٔ دوباره باید اتصال تازه بسازید.',
    removeIsDefault:
      'این اتصال مدل پیش‌فرض پروژه‌هاست. اول در بخش «مدل پیش‌فرض» اتصال دیگری را انتخاب و ذخیره کنید، بعد حذف کنید.',
    removeConfirm: 'بله، حذف شود',
    removeReason: 'حذف از صفحهٔ ارائه‌دهندگان AI',
    cancel: 'انصراف',
    status: 'وضعیت',
    lastChecked: 'آخرین بررسی',
    keyFingerprint: 'اثر انگشت کلید',
    maxConcurrent: 'سقف درخواست‌های هم‌زمان',
    saveCapacity: 'ذخیرهٔ سقف',
    capacityHelp:
      'برای هر اتصال، ۱ تا ۱۰۰ درخواست مدل می‌تواند هم‌زمان اجرا شود؛ این سقف در همهٔ workerها مشترک است. کاهش سقف، درخواست‌های در حال اجرا را قطع نمی‌کند.',
    defaults: 'مدل پیش‌فرض پروژه‌ها',
    defaultsHelp:
      'همهٔ مراحل پروژه از این اتصال و مدل استفاده می‌کنند، مگر برای پروژه‌ای جداگانه تغییر دهید.',
    connection: 'اتصال',
    model: 'مدل',
    chooseModel: 'ابتدا فهرست مدل‌ها را به‌روزرسانی کنید',
    saveDefaults: 'ذخیرهٔ مدل پیش‌فرض',
    current: 'تنظیم فعلی',
    notSet: 'تنظیم نشده',
    saved: 'ذخیره شد.',
    failed: 'انجام نشد. کلید یا اتصال اینترنت سرور را بررسی کنید.',
    errors: {
      PROVIDER_SECRET_REQUIRED: 'کلید API لازم است.',
      PROVIDER_INVALID_REQUEST: 'اطلاعات واردشده معتبر نیست.',
      PROVIDER_VERSION_CONFLICT: 'این اتصال تغییر کرده است. صفحه را تازه کنید و دوباره ذخیره کنید.',
      PROVIDER_SECRET_STORE_UNAVAILABLE: 'کلید رمزنگاری سرور تنظیم نشده است (SECRET_MASTER_KEY).',
    } as Record<string, string>,
  },
  en: {
    title: 'AI providers',
    subtitle: 'Enter an API key once; it is encrypted and never shown again.',
    connections: 'Connections',
    none: 'No connection yet. Add one with the form below.',
    add: 'Add a connection',
    provider: 'Provider',
    name: 'Name',
    apiKey: 'API key',
    keyHelp: {
      openai: 'platform.openai.com → API keys → Create new secret key',
      gemini: 'aistudio.google.com → Get API key',
      anthropic: 'console.anthropic.com → API Keys → Create Key',
      elevenlabs: 'elevenlabs.io → Developers → API Keys',
    },
    voiceOnly:
      'ElevenLabs is for voice conversation only; it is not used to run stages or as the default model. Choose it under System settings → Voice conversation.',
    save: 'Save and check',
    saving: 'Saving and checking…',
    check: 'Check health',
    refresh: 'Refresh models',
    remove: 'Delete',
    removeLabel: 'Delete connection "{name}"',
    removeHeading: 'Confirm deleting the connection',
    removeHelp:
      'The connection is disabled for good and leaves this list. Its usage and cost history stays. To use it again, create a new connection.',
    removeIsDefault:
      'This connection is the default for projects. First choose and save another connection under “Default model”, then delete it.',
    removeConfirm: 'Yes, delete it',
    removeReason: 'Deleted from the AI providers page',
    cancel: 'Cancel',
    status: 'Status',
    lastChecked: 'Last checked',
    keyFingerprint: 'Key fingerprint',
    maxConcurrent: 'Concurrent request limit',
    saveCapacity: 'Save limit',
    capacityHelp:
      'Allow 1–100 concurrent model requests per connection, shared by all workers. Lowering the limit lets requests already running finish.',
    defaults: 'Default model for projects',
    defaultsHelp:
      'Every project stage uses this connection and model unless a project overrides it.',
    connection: 'Connection',
    model: 'Model',
    chooseModel: 'Refresh the model list first',
    saveDefaults: 'Save default model',
    current: 'Current setting',
    notSet: 'not set',
    saved: 'Saved.',
    failed: 'That did not work. Check the key and the server’s internet access.',
    errors: {
      PROVIDER_SECRET_REQUIRED: 'An API key is required.',
      PROVIDER_INVALID_REQUEST: 'The details are not valid.',
      PROVIDER_VERSION_CONFLICT: 'This connection changed. Reload the page before saving again.',
      PROVIDER_SECRET_STORE_UNAVAILABLE:
        'The server encryption key is not set (SECRET_MASTER_KEY).',
    } as Record<string, string>,
  },
} as const;

export function providerMessages(locale: Locale) {
  return messages[locale];
}
