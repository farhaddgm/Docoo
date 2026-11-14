import type { Locale } from '../i18n';

/** The words of the assistant settings page. `en` must have exactly the shape of `fa`. */
const fa = {
  title: 'دستیار صوتی',
  subtitle: 'مشخص کنید دستیار صوتی چه کارهایی را و تا کجا انجام دهد.',
  status: {
    ready: 'نوشتن با دستیار آماده است.',
    readyOwn: 'پاسخ‌ها با مدل نوشتاری که خودتان انتخاب کرده‌اید ساخته می‌شود.',
    readyWorkspace: 'پاسخ‌ها با اتصال و مدل هوش مصنوعی فضای کار ساخته می‌شود.',
    voiceLater:
      'گفتگو با صدا هنوز به ارائه‌دهندهٔ صوتی وصل نشده است؛ این مرحلهٔ بعد است و به نوشتن ربطی ندارد.',
    unsaved: 'این وضعیت بر پایهٔ تنظیمات ذخیره‌شده است؛ تغییرهای ذخیره‌نشدهٔ شما هنوز در آن نیست.',
    textNeeds: {
      disabled:
        'نوشتن آماده نیست: دستیار روشن نیست. «دستیار صوتی روشن باشد» را بزنید و ذخیره کنید.',
      disclosure:
        'نوشتن آماده نیست: هشدار حریم خصوصی هنوز پذیرفته نشده است. آن را بپذیرید و ذخیره کنید.',
      executor_not_configured:
        'نوشتن آماده نیست: مدل نوشتاری مشخص نیست. در بخش «مدل نوشتاری» یکی را انتخاب کنید، یا اتصال هوش مصنوعی فضای کار را در صفحهٔ «ارائه‌دهندگان AI» تنظیم کنید.',
    },
    voiceCheck: {
      title: 'اتصال صدا از سرور',
      badgeOk: 'برقرار',
      badgeFailed: 'ناموفق',
      again: 'بررسی دوباره',
      details: 'جزئیات فنی (برای پشتیبانی)',
      model: 'مدل',
      latency: 'زمان پاسخ',
      ms: 'میلی‌ثانیه',
      events: 'رویدادهای ارائه‌دهنده',
      button: 'بررسی اتصال صدا از سرور',
      running: 'در حال بررسی…',
      note: 'این بررسی فقط در را باز می‌کند و چیزی نمی‌گوید؛ هزینه‌ای ندارد. اول تنظیمات را ذخیره کنید.',
      ok: 'اتصال صدا از سرور کار می‌کند.',
      failed: 'اتصال صدا برقرار نشد:',
      failures: {
        not_configured: 'اتصال و مدل صدا را انتخاب و ذخیره کنید.',
        connection_unavailable:
          'اتصال انتخاب‌شده در دسترس نیست؛ در صفحهٔ ارائه‌دهندگان آن را بررسی کنید.',
        not_openai: 'این اتصال صدای زنده ندارد؛ اتصال OpenAI یا ElevenLabs را انتخاب کنید.',
        auth: 'کلید این اتصال پذیرفته نشد.',
        region: 'ارائه‌دهنده کشورِ محل سرور را نمی‌پذیرد.',
        model: 'این مدل برای این کلید یافت نشد یا اجازه ندارد.',
        network: 'سرور نتوانست به ارائه‌دهنده برسد.',
        timeout: 'ارائه‌دهنده در مهلت جواب نداد.',
        quota: 'سقف مصرف یا نرخ درخواست ارائه‌دهنده پر شده است.',
        terms: 'شرایط استفادهٔ ارائه‌دهنده در داشبورد خودش هنوز پذیرفته نشده است.',
        unexpected: 'پاسخ غیرمنتظره‌ای آمد.',
      },
    },
  },
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
    model_needed: 'اتصال و مدل صوتی را با هم انتخاب کنید، یا هر دو را خالی بگذارید.',
    executor_model_needed: 'اتصال و مدل نوشتاری را با هم انتخاب کنید، یا هر دو را خالی بگذارید.',
    projects_needed: 'دست‌کم یک پروژه انتخاب کنید یا «پروژه‌ای که باز است» را روشن کنید.',
  },
  general: {
    title: 'روشن‌کردن و نام',
    enabled: 'دستیار صوتی روشن باشد',
    enabledHint:
      'خاموش یعنی دکمهٔ «گفتگوی زنده» غیرفعال است و هیچ صدایی ضبط یا فرستاده نمی‌شود. با دکمهٔ خاموش هیچ‌چیز در پس‌زمینه کار نمی‌کند.',
    disclosure:
      'می‌پذیرم که صدای من و محتوای پروژه‌های داخل دامنهٔ دسترسی، برای پردازش به سرویس‌دهندهٔ صوتی انتخاب‌شده فرستاده می‌شود.',
    disclosureNamed:
      'می‌پذیرم که صدای من، متن گفتگو و محتوای پروژه‌های داخل دامنهٔ دسترسی، برای پردازش به {provider} فرستاده می‌شود.',
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
      'دو مدل جدا دارید. «مدل نوشتاری» به درخواست‌های تایپ‌شده شما پاسخ می‌دهد و پیشنهاد تغییر می‌سازد؛ برای نوشتن با دستیار فقط همین لازم است. «مدل صوتی» فقط برای گفتگوی با صدا لازم است و هنوز به آن وصل نشده‌ایم.',
    mode: 'روش گفتگو',
    modes: {
      realtime: 'بلادرنگ (مدل صوتی زنده)',
      pipeline: 'مرحله‌ای (گفتار به متن، مدل، متن به گفتار)',
    },
    connection: 'اتصال مدل صوتی',
    noConnection: '— انتخاب کنید —',
    noConnections: 'هنوز اتصالی در «ارائه‌دهندگان AI» ساخته نشده است.',
    noElevenLabs:
      'اتصال ElevenLabs در این فهرست نیست، چون هنوز ساخته نشده (یا غیرفعال است). در «ارائه‌دهندگان AI» نوع «ElevenLabs (Voice)» را اضافه کنید تا اینجا بیاید.',
    noRealtimeModels:
      'مدل realtime پیدا نشد. حساب این اتصال به مدل realtime دسترسی ندارد یا فهرست از ارائه‌دهنده خوانده نشد؛ می‌توانید نام مدل را با «مورد دیگر» وارد کنید.',
    pick: 'یکی را انتخاب کنید',
    other: 'مورد دیگر (وارد کردن دستی)',
    modelId: 'مدل صوتی بلادرنگ',
    modelHint:
      'عبارت realtime را بنویسید تا مدل‌های صوتی زنده پیشنهاد شود، یا نام مدل را کامل بنویسید. اگر صدا را هنوز راه نمی‌اندازید، خالی بگذارید.',
    voice: 'نام صدا',
    voiceHint: 'خالی بماند، صدای پیش‌فرض سرویس‌دهنده به کار می‌رود.',
    elevenlabs: {
      note: 'ElevenLabs به‌صورت خط لوله کار می‌کند: شنیدن با Scribe v3 Live (ثابت)، پاسخ با مجری خود Docoo، گفتن با مدل ElevenLabs. صدا و متن گفتگو به ElevenLabs هم می‌رود.',
      modelId: 'مدل گفتن',
      modelHint:
        'مدل پیشنهادی eleven_v4_turbo است؛ فارسی فقط برای خانوادهٔ Eleven v3 و v4 در مستندات آمده است.',
      voiceHint:
        'صدا را از فهرست پیشنهادی انتخاب کنید یا شناسهٔ صدا را بنویسید. خالی بماند، صدای پیش‌فرض.',
    },
    unknownConnection: 'اتصال ذخیره‌شده دیگر در دسترس نیست — دوباره انتخاب کنید',
    language: 'زبان گفتگو',
    languages: { fa: 'فارسی', en: 'انگلیسی', auto: 'خودکار' },
    executor: 'مدل نوشتاری (پاسخ به درخواست‌های تایپ‌شده)',
    executorInherit: 'همان اتصال و مدل هوش مصنوعی فضای کار',
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
  status: {
    ready: 'Writing to the assistant is ready.',
    readyOwn: 'Answers come from the text model you chose.',
    readyWorkspace: 'Answers come from the workspace AI connection and model.',
    voiceLater:
      'Talking by voice is not connected to a voice provider yet; that is a later step and has nothing to do with writing.',
    unsaved: 'This status reflects the saved settings; your unsaved changes are not in it yet.',
    textNeeds: {
      disabled: 'Writing is not ready: the assistant is off. Tick "Voice assistant on" and save.',
      disclosure:
        'Writing is not ready: the privacy notice is not accepted yet. Accept it and save.',
      executor_not_configured:
        'Writing is not ready: no text model is set. Choose one under "Text model", or set up the workspace AI connection on the "AI providers" page.',
    },
    voiceCheck: {
      title: 'Voice link from the server',
      badgeOk: 'Connected',
      badgeFailed: 'Failed',
      again: 'Check again',
      details: 'Technical details (for support)',
      model: 'Model',
      latency: 'Response time',
      ms: 'ms',
      events: 'Provider events',
      button: 'Check the voice link from the server',
      running: 'Checking…',
      note: 'This only opens the door and says nothing; it costs nothing. Save the settings first.',
      ok: 'The voice link from the server works.',
      failed: 'The voice link did not work:',
      failures: {
        not_configured: 'Choose and save the voice connection and model.',
        connection_unavailable:
          'The chosen connection is unavailable; check it on the providers page.',
        not_openai: 'This connection has no live voice; choose an OpenAI or ElevenLabs connection.',
        auth: 'The key of this connection was not accepted.',
        region: 'The provider does not accept the country the server runs in.',
        model: 'This model was not found for this key, or it has no access.',
        network: 'The server could not reach the provider.',
        timeout: 'The provider did not answer in time.',
        quota: 'The provider usage quota or rate limit is reached.',
        terms: 'The terms of the provider are not accepted in its own dashboard yet.',
        unexpected: 'An unexpected answer came back.',
      },
    },
  },
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
    model_needed: 'Choose the voice connection and its model together, or leave both empty.',
    executor_model_needed:
      'Choose the text connection and its model together, or leave both empty.',
    projects_needed: 'Choose at least one project, or switch on "the project that is open".',
  },
  general: {
    title: 'Switch on and name',
    enabled: 'The voice assistant is on',
    enabledHint:
      'Off means the "live conversation" button is disabled and no audio is recorded or sent. With the button off nothing runs in the background.',
    disclosure:
      'I accept that my voice and the content of the projects within the access scope are sent to the chosen voice provider to be processed.',
    disclosureNamed:
      'I accept that my voice, the text of the conversation and the content of the projects within the access scope are sent to {provider} to be processed.',
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
      'There are two separate models. The "text model" answers what you type and drafts changes; it is all you need to write to the assistant. The "voice model" is only needed for talking by voice, and it is not connected yet.',
    mode: 'Conversation mode',
    modes: {
      realtime: 'Realtime (a live voice model)',
      pipeline: 'Pipeline (speech to text, model, text to speech)',
    },
    connection: 'Voice model connection',
    noConnection: '— choose —',
    noConnections: 'No connection exists yet; add one under AI providers.',
    noElevenLabs:
      'There is no ElevenLabs connection in this list because none exists yet (or it is disabled). Add one of type "ElevenLabs (Voice)" under AI providers and it will appear here.',
    noRealtimeModels:
      'No realtime model was found. This connection\'s account has no access to one, or the list could not be read from the provider; you can type a model name with "Other".',
    pick: 'Choose one',
    other: 'Other (type it in)',
    modelId: 'Realtime voice model',
    modelHint:
      'Type realtime to get the live voice models suggested, or write the full model name. Leave it empty if you are not setting up voice yet.',
    voice: 'Voice name',
    voiceHint: 'Left empty, the provider default voice is used.',
    elevenlabs: {
      note: "ElevenLabs works as a pipeline: hearing with Scribe v3 Live (fixed), the answer from Docoo's own executor, speaking with an ElevenLabs model. The voice and the text of the conversation go to ElevenLabs as well.",
      modelId: 'Speaking model',
      modelHint:
        'The suggested model is eleven_v4_turbo; the documentation lists Persian only for the Eleven v3 and v4 families.',
      voiceHint:
        'Pick a voice from the list or type its id. Left empty, the default voice is used.',
    },
    unknownConnection: 'The saved connection is no longer available — choose again',
    language: 'Conversation language',
    languages: { fa: 'Persian', en: 'English', auto: 'Automatic' },
    executor: 'Text model (answers what you type)',
    executorInherit: 'The workspace AI connection and model',
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
