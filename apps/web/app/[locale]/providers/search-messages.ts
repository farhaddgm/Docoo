import type { Locale } from '../../i18n';

/** The "web search services" section of the providers page (ADR-0060). */
const messages = {
  fa: {
    title: 'سرویس‌های جست‌وجوی وب',
    help: 'Exa و Tavily سرویس‌های جست‌وجوی مستقل‌اند. وقتی در تنظیمات «تحقیق» گزینهٔ جست‌وجوی مستقل روشن شود، مرحلهٔ تحقیق علاوه بر جست‌وجوی خود مدل، از همهٔ سرویس‌های متصل و فعال هم استفاده می‌کند. هر دو را می‌توان هم‌زمان وصل کرد. فقط پرسش‌های تأییدشدهٔ طرح تحقیق، پس از بررسی حریم خصوصی، به این سرویس‌ها فرستاده می‌شود.',
    privacy:
      'پرسش‌هایی که ایمیل، شماره تلفن یا کارت، نشانی داخلی یا کلید و رمز داشته باشند هرگز ارسال نمی‌شوند. شرایط نگهداری پرسش‌ها را در سند رسمی هر سرویس بخوانید.',
    none: 'هنوز سرویس جست‌وجویی وصل نشده است.',
    add: 'افزودن سرویس جست‌وجو',
    service: 'سرویس',
    name: 'عنوان سرویس',
    apiKey: 'کلید سرویس',
    keyHelp: {
      exa: 'از dashboard.exa.ai ← API Keys',
      tavily: 'از app.tavily.com ← API Keys',
    },
    cost: 'هزینهٔ هر پرسش (دلار)',
    costHelp:
      'این سرویس‌ها به‌ازای هر درخواست حساب می‌کنند. مقدار پیش‌فرض قیمت عمومی سرویس است؛ اگر پلن شما فرق دارد، اصلاحش کنید. این عدد در سقف هزینهٔ هر اجرا و گزارش هزینه حساب می‌شود.',
    save: 'افزودن سرویس و بررسی',
    saving: 'در حال افزودن و بررسی…',
    check: 'بررسی سلامت',
    checkNote: 'بررسی سلامت یک پرسش واقعی می‌فرستد و هزینهٔ یک پرسش را دارد.',
    rotate: 'تعویض کلید',
    rotateKey: 'کلید تازه',
    rotateReason: 'تعویض از صفحهٔ ارائه‌دهندگان',
    saveRotate: 'ذخیره کلید تازه',
    saveCost: 'ذخیره هزینه',
    remove: 'حذف',
    removeConfirm: 'بله، حذف شود',
    removeReason: 'حذف از صفحهٔ ارائه‌دهندگان',
    removeHelp: 'سرویس برای همیشه غیرفعال می‌شود. برای استفادهٔ دوباره باید اتصال تازه بسازید.',
    cancel: 'انصراف',
    columns: {
      name: 'نام',
      service: 'سرویس',
      status: 'وضعیت',
      checked: 'آخرین بررسی',
      fingerprint: 'اثر انگشت کلید',
      cost: 'هزینهٔ هر پرسش',
    },
    saved: 'ذخیره شد.',
    savedNotChecked:
      'اتصال ذخیره شد، اما سرویس کلید را نپذیرفت یا در دسترس نبود. کلید را بررسی کنید.',
    failed: 'انجام نشد. دوباره تلاش کنید.',
    errors: {
      PROVIDER_SECRET_REQUIRED: 'کلید API لازم است.',
      PROVIDER_NAME_TAKEN: 'اتصالی با این نام از قبل هست.',
      PROVIDER_VERSION_CONFLICT: 'اتصال تغییر کرده است؛ صفحه را تازه کنید.',
      PROVIDER_DISABLED: 'این اتصال غیرفعال شده است.',
      PROVIDER_INVALID_REQUEST: 'مقدارها معتبر نیست.',
    } as Record<string, string>,
  },
  en: {
    title: 'Web search services',
    help: 'Exa and Tavily are independent search services. When independent search is turned on in the Research settings, the research stage also uses every connected, enabled service besides the model’s own search. Both can be connected at once. Only the confirmed research questions are sent, after a privacy check.',
    privacy:
      'Questions that contain an e-mail, a phone or card number, an internal address or a key or password are never sent. Read each service’s official terms for how long it keeps queries.',
    none: 'No search service is connected yet.',
    add: 'Add a search service',
    service: 'Service',
    name: 'Service label',
    apiKey: 'Service key',
    keyHelp: {
      exa: 'From dashboard.exa.ai → API Keys',
      tavily: 'From app.tavily.com → API Keys',
    },
    cost: 'Cost per query (USD)',
    costHelp:
      'These services bill per request. The default is the service’s public price; correct it if your plan differs. The number counts toward the cost limit of each run and the cost report.',
    save: 'Add service and check',
    saving: 'Adding and checking…',
    check: 'Check health',
    checkNote: 'The health check sends one real query and costs one query.',
    rotate: 'Replace key',
    rotateKey: 'New key',
    rotateReason: 'Rotated from the providers page',
    saveRotate: 'Save new key',
    saveCost: 'Save cost',
    remove: 'Remove',
    removeConfirm: 'Yes, remove',
    removeReason: 'Removed from the providers page',
    removeHelp:
      'The service is disabled for good. To use it again you must create a new connection.',
    cancel: 'Cancel',
    columns: {
      name: 'Name',
      service: 'Service',
      status: 'Status',
      checked: 'Last checked',
      fingerprint: 'Key fingerprint',
      cost: 'Cost per query',
    },
    saved: 'Saved.',
    savedNotChecked:
      'The connection was saved, but the service refused the key or could not be reached. Check the key.',
    failed: 'It did not work. Try again.',
    errors: {
      PROVIDER_SECRET_REQUIRED: 'An API key is required.',
      PROVIDER_NAME_TAKEN: 'A connection with this name already exists.',
      PROVIDER_VERSION_CONFLICT: 'The connection changed; reload the page.',
      PROVIDER_DISABLED: 'This connection is disabled.',
      PROVIDER_INVALID_REQUEST: 'The values are not valid.',
    } as Record<string, string>,
  },
};

export const searchMessages = (locale: Locale) => messages[locale];
