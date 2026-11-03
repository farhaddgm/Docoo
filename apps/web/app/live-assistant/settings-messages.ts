import type { Locale } from '../i18n';

/** The words of the assistant settings page. `en` must have exactly the shape of `fa`. */
const fa = {
  title: 'دستیار صوتی',
  subtitle: 'مشخص کنید دستیار صوتی چه کارهایی را و تا کجا انجام دهد.',
  notReady:
    'دستیار هنوز به ارائه‌دهندهٔ صوتی وصل نشده است. تنظیمات از همین حالا ذخیره می‌شود و پس از وصل‌شدن اعمال می‌شود.',
  loadFailed: 'تنظیمات خوانده نشد.',
  saveFailed: 'ذخیره انجام نشد. دوباره تلاش کنید.',
  denied: 'فقط مالک سامانه می‌تواند این تنظیمات را عوض کند.',
  saved: 'ذخیره شد.',
  nothing: 'تغییری برای ذخیره نیست.',
  save: 'ذخیره',
  revert: 'برگرداندن تغییرها',
  loading: 'در حال خواندن…',
  problems: {
    name_required: 'نام نمایشی لازم است (حداکثر ۴۰ نویسه).',
    out_of_range: 'عدد باید در بازهٔ مجاز باشد.',
    not_whole: 'عدد باید صحیح باشد.',
    consent_needed: 'برای روشن‌کردن، باید هشدار حریم خصوصی را بپذیرید.',
    model_needed: 'برای روشن‌کردن، اتصال و مدل صوتی را انتخاب کنید.',
    projects_needed: 'دست‌کم یک پروژه انتخاب کنید یا «پروژه‌ای که باز است» را روشن کنید.',
  },
  general: {
    title: 'روشن‌کردن و نام',
    enabled: 'دستیار صوتی روشن باشد',
    enabledHint:
      'خاموش یعنی دکمهٔ «گفتگوی زنده» غیرفعال است و هیچ صدایی ضبط یا فرستاده نمی‌شود. با دکمهٔ خاموش هیچ‌چیز در پس‌زمینه کار نمی‌کند.',
    disclosure:
      'می‌پذیرم که صدای من و محتوای پروژه‌های داخل دامنهٔ دسترسی، برای پردازش به سرویس‌دهندهٔ صوتی انتخاب‌شده فرستاده می‌شود.',
    displayName: 'نام نمایشی',
    spokenName: 'نام گفتاری (املای فونتیک برای تلفظ درست)',
    spokenHint: 'مثلاً «داکو». با این نام صدایش می‌کنید و همین‌طور تلفظ می‌شود.',
  },
  access: {
    title: 'دسترسی',
    intro:
      'مشخص کنید دستیار کجا کار کند و چه کاری بتواند بکند. این دو مرز در سرور اعمال می‌شود، نه فقط در دستور مدل: پروژه‌ای که بیرون از دامنه باشد برای دستیار دیده نمی‌شود.',
    scopeLegend: 'کجا کار کند؟',
    scopes: {
      all_projects: {
        label: 'بخش همهٔ پروژه‌ها',
        hint: 'همهٔ پروژه‌ها و صفحه‌های وابسته به پروژه؛ نه تنظیمات سامانه، ارائه‌دهنده‌ها و کاربران.',
      },
      selected_projects: {
        label: 'پروژه‌های مشخص',
        hint: 'فقط پروژه‌هایی که خودتان انتخاب می‌کنید.',
      },
      backoffice: { label: 'کل بک‌آفیس', hint: 'همهٔ بخش‌ها (باز هم در حد مجوزهای خودتان).' },
    },
    projects: 'پروژه‌ها',
    noProjects: 'هنوز پروژه‌ای نیست.',
    includeCurrent: 'پروژه‌ای که الان باز است هم شامل شود',
    levelLegend: 'چه کاری بتواند بکند؟',
    levels: {
      read: {
        label: 'فقط خواندن و پاسخ‌دادن',
        hint: 'صفحه‌ها و محتوا را می‌خواند، توضیح و تحلیل می‌دهد و نشانتان می‌دهد؛ هیچ تغییری پیشنهاد یا ثبت نمی‌کند.',
      },
      act: {
        label: 'هر اقدامی (با تأیید شما)',
        hint: 'علاوه بر خواندن، تغییر پیشنهاد می‌دهد و فقط پس از تأیید شما، صوتی یا با کلیک، ثبت می‌کند.',
      },
    },
    summaryTitle: 'نتیجه',
    summaryNone: '{name} هیچ‌جا نمی‌تواند کاری انجام دهد.',
    summaryRead: '{name} در {scope} فقط می‌خواند و پاسخ می‌دهد.',
    summaryAct:
      '{name} در {scope} می‌تواند تغییر هم پیشنهاد دهد؛ هر تغییر فقط با تأیید شما ثبت می‌شود.',
    scopePhrase: {
      all_projects: 'بخش همهٔ پروژه‌ها',
      backoffice: 'کل بک‌آفیس',
      selected: '{n} پروژهٔ انتخاب‌شده',
      selectedAndCurrent: '{n} پروژهٔ انتخاب‌شده و پروژه‌ای که باز است',
      currentOnly: 'پروژه‌ای که باز است',
    },
  },
  model: {
    title: 'هوش مصنوعی و مدل',
    intro:
      'مدل صوتی بلادرنگ با دستیار گفتگو می‌کند. مدل مجری، کارها را برنامه‌ریزی می‌کند و پیشنهاد تغییر می‌سازد؛ اگر خالی بماند همان مدل تنظیمات سامانه به کار می‌رود.',
    mode: 'روش گفتگو',
    modes: {
      realtime: 'بلادرنگ (مدل صوتی زنده)',
      pipeline: 'مرحله‌ای (گفتار به متن، مدل، متن به گفتار)',
    },
    connection: 'اتصال مدل صوتی',
    noConnection: '— انتخاب کنید —',
    noConnections: 'هنوز اتصالی در «ارائه‌دهندگان AI» ساخته نشده است.',
    modelId: 'مدل صوتی بلادرنگ',
    modelHint: 'نام مدل را از فهرست پیشنهادی انتخاب کنید یا بنویسید.',
    voice: 'صدا',
    language: 'زبان گفتگو',
    languages: { fa: 'فارسی', en: 'انگلیسی', auto: 'خودکار' },
    executor: 'مدل مجری',
    executorInherit: 'همان مدل تنظیمات سامانه',
  },
  listening: {
    title: 'شنیدن و بیدارسازی',
    mode: 'روش گوش‌دادن',
    modes: { always: 'همیشه (با خواب خودکار)', push_to_talk: 'نگه‌دار و حرف بزن' },
    idle: 'خواب پس از چند ثانیه سکوت',
    idleHint: 'پس از این مدت اتصال ابری قطع می‌شود و هزینه صفر می‌شود.',
    wake: 'با عبارت بیدارسازی بیدار شود',
    wakeHint:
      'فقط وقتی «گفتگوی زنده» روشن است کار می‌کند. هنوز پیاده نشده است؛ تنظیم از الان ذخیره می‌شود.',
    wakePhrase: 'عبارت بیدارسازی',
  },
  limits: {
    title: 'سقف‌ها',
    intro: 'سقف‌ها در سرور اعمال می‌شود. نزدیک ۸۰٪ سقف هشدار داده می‌شود.',
    sessionCost: 'هزینهٔ هر نشست (دلار)',
    dailyCost: 'هزینهٔ روزانه (دلار، UTC)',
    sessionMinutes: 'طول هر نشست (دقیقه؛ حداکثر ۵۵)',
    taskCost: 'هزینهٔ مدل مجری برای یک درخواست (دلار)',
    maxActions: 'حداکثر گام در یک درخواست',
    range: 'بازه: {min} تا {max}',
  },
  confirm: {
    title: 'تأیید',
    intro: 'هیچ تغییری بدون فرمان تأیید شما ثبت نمی‌شود؛ این قابل خاموش‌شدن نیست.',
    timeout: 'کارت تأییدنشده پس از چند ثانیه لغو شود',
    strictness: 'سخت‌گیری',
    strictnesses: {
      standard: 'استاندارد',
      strict: 'سخت‌گیر (هر تغییر هدف و هزینه را هم بازخوانی می‌کند)',
    },
    t3Title: 'کارهای برگشت‌ناپذیر',
    t3Intro:
      'به‌طور پیش‌فرض همه خاموش‌اند. هر دسته‌ای که روشن کنید تأیید دوگانه می‌خواهد (فرمان صوتی و تکرار نام هدف، یا کلیک). کلیدها و گذرواژه‌ها هرگز صوتی نمی‌شوند و قابل روشن‌شدن نیستند.',
    t3: {
      delete: 'حذف و پاک‌سازی',
      accounts: 'حساب‌ها و دسترسی کاربران',
      retention: 'نگهداشت و پاک‌سازی داده',
      audit_override: 'عبور از ممیزی دانش',
      security_settings: 'تنظیمات امنیتی (مثل سیاست دریافت نشانی)',
    },
  },
  privacy: {
    title: 'گفتگوها و حریم خصوصی',
    transcripts: 'متن گفتگوها ذخیره شود',
    retention: 'متن گفتگوها چند روز بماند',
    audio: 'صدای گفتگوها ذخیره شود',
    audioHint: 'پیش‌فرض خاموش است؛ متن گفتگو همیشه کافی است.',
  },
};

const en: typeof fa = {
  title: 'Voice assistant',
  subtitle: 'Decide what the voice assistant may do, and how far.',
  notReady:
    'The assistant is not connected to a voice provider yet. The settings are saved now and apply once it is connected.',
  loadFailed: 'The settings could not be read.',
  saveFailed: 'Could not save. Try again.',
  denied: 'Only the owner of the system can change these settings.',
  saved: 'Saved.',
  nothing: 'Nothing to save.',
  save: 'Save',
  revert: 'Undo changes',
  loading: 'Reading…',
  problems: {
    name_required: 'A display name is required (at most 40 characters).',
    out_of_range: 'The number must be within the allowed range.',
    not_whole: 'The number must be a whole number.',
    consent_needed: 'To switch it on you must accept the privacy notice.',
    model_needed: 'To switch it on, choose the connection and the voice model.',
    projects_needed: 'Choose at least one project, or switch on "the project that is open".',
  },
  general: {
    title: 'Switch on and name',
    enabled: 'The voice assistant is on',
    enabledHint:
      'Off means the "live conversation" button is disabled and no audio is recorded or sent. With the button off nothing runs in the background.',
    disclosure:
      'I accept that my voice and the content of the projects within the access scope are sent to the chosen voice provider to be processed.',
    displayName: 'Display name',
    spokenName: 'Spoken name (phonetic spelling for correct pronunciation)',
    spokenHint: 'For example "Docoo". You call it by this name and it is pronounced this way.',
  },
  access: {
    title: 'Access',
    intro:
      'Decide where the assistant works and what it can do. Both limits are enforced on the server, not only in the model instructions: a project outside the scope is invisible to it.',
    scopeLegend: 'Where does it work?',
    scopes: {
      all_projects: {
        label: 'The all-projects area',
        hint: 'Every project and the pages that belong to projects; not system settings, providers or users.',
      },
      selected_projects: {
        label: 'Chosen projects',
        hint: 'Only the projects you choose.',
      },
      backoffice: {
        label: 'The whole back office',
        hint: 'Every area (still within your own permissions).',
      },
    },
    projects: 'Projects',
    noProjects: 'There are no projects yet.',
    includeCurrent: 'Also cover the project that is open right now',
    levelLegend: 'What can it do?',
    levels: {
      read: {
        label: 'Read and answer only',
        hint: 'It reads pages and content, explains, analyses and shows you around; it proposes or saves no change.',
      },
      act: {
        label: 'Any action (with your confirmation)',
        hint: 'Besides reading, it proposes changes and saves one only after you confirm it, by voice or with a click.',
      },
    },
    summaryTitle: 'Result',
    summaryNone: '{name} cannot do anything anywhere.',
    summaryRead: 'In {scope}, {name} only reads and answers.',
    summaryAct:
      'In {scope}, {name} can also propose changes; every change is saved only with your confirmation.',
    scopePhrase: {
      all_projects: 'the all-projects area',
      backoffice: 'the whole back office',
      selected: '{n} chosen project(s)',
      selectedAndCurrent: '{n} chosen project(s) and the project that is open',
      currentOnly: 'the project that is open',
    },
  },
  model: {
    title: 'AI and model',
    intro:
      'The realtime voice model talks with the assistant. The executor model plans the work and drafts changes; left empty, the model of the system settings is used.',
    mode: 'Conversation mode',
    modes: {
      realtime: 'Realtime (a live voice model)',
      pipeline: 'Pipeline (speech to text, model, text to speech)',
    },
    connection: 'Voice model connection',
    noConnection: '— choose —',
    noConnections: 'No connection exists yet; add one under AI providers.',
    modelId: 'Realtime voice model',
    modelHint: 'Pick the model name from the suggestions or type it.',
    voice: 'Voice',
    language: 'Conversation language',
    languages: { fa: 'Persian', en: 'English', auto: 'Automatic' },
    executor: 'Executor model',
    executorInherit: 'The model of the system settings',
  },
  listening: {
    title: 'Listening and wake-up',
    mode: 'How it listens',
    modes: { always: 'Always (with automatic sleep)', push_to_talk: 'Push to talk' },
    idle: 'Sleep after this many seconds of silence',
    idleHint: 'After this the cloud connection is closed and the cost drops to zero.',
    wake: 'Wake on the wake phrase',
    wakeHint:
      'Works only while the live conversation is on. Not built yet; the setting is saved from now on.',
    wakePhrase: 'Wake phrase',
  },
  limits: {
    title: 'Caps',
    intro: 'The caps are enforced on the server. A warning is given near 80% of a cap.',
    sessionCost: 'Cost of one session (dollars)',
    dailyCost: 'Daily cost (dollars, UTC)',
    sessionMinutes: 'Length of one session (minutes; at most 55)',
    taskCost: 'Cost of the executor model for one request (dollars)',
    maxActions: 'Most steps in one request',
    range: 'Range: {min} to {max}',
  },
  confirm: {
    title: 'Confirmation',
    intro: 'No change is saved without your confirmation; this cannot be turned off.',
    timeout: 'Cancel an unconfirmed card after this many seconds',
    strictness: 'Strictness',
    strictnesses: {
      standard: 'Standard',
      strict: 'Strict (every change also reads back its target and cost)',
    },
    t3Title: 'Irreversible work',
    t3Intro:
      'All off by default. Every kind you switch on needs double confirmation (a spoken command plus repeating the target name, or a click). Keys and passwords are never spoken and cannot be switched on.',
    t3: {
      delete: 'Delete and purge',
      accounts: 'Accounts and user access',
      retention: 'Data retention and purging',
      audit_override: 'Overriding a knowledge audit',
      security_settings: 'Security settings (such as the URL policy)',
    },
  },
  privacy: {
    title: 'Conversations and privacy',
    transcripts: 'Store the text of the conversations',
    retention: 'Days the text is kept',
    audio: 'Store the audio of the conversations',
    audioHint: 'Off by default; the text of a conversation is always enough.',
  },
};

export type LiveSettingsMessages = typeof fa;

export const liveSettingsMessages = (locale: Locale): LiveSettingsMessages =>
  locale === 'fa' ? fa : en;

export const fillText = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/gu, (_, key: string) => values[key] ?? '');
