import type { Locale } from '../../i18n';

/**
 * The words behind the "i" buttons of "Knowledge and audit". Every section, filter, column,
 * field and action has one, so nobody has to guess what a control does. They are plain text:
 * the tooltip shows them as they are.
 */
const fa = {
  tabs: {
    queue:
      'همه دانش‌ها و وضعیت ممیزی‌شان: در انتظار، تأییدشده، نیازمند اصلاح، رد‌شده یا منقضی. از اینجا می‌فهمید چه چیزی آماده استفاده ایجنت‌هاست.',
    sources:
      'مواد خام دانش: فایل، متن یا نشانی وب. منبع را بارگذاری می‌کنید، سامانه آن را اسکن و استخراج می‌کند و بعد از آن «دانش» می‌سازید.',
    manual:
      'دانشی که خودتان تایپ می‌کنید، با ادعاها و ارجاع‌های دقیق. برای وقتی که فایل یا سندی ندارید.',
    conflicts:
      'جایی که دو ادعا در دو دانشِ در حال استفاده با هم نمی‌خوانند. تا حل نشوند، هنگام بازیابی هشدار تعارض همراه نتیجه می‌آید.',
    retrieval:
      'آزمایش کنید ایجنت‌ها برای یک پرسش دقیقا چه دانشی را می‌بینند. نتیجه همان بازیابی واقعی ایجنت‌هاست، نه یک شبیه‌سازی.',
  },
  view: {
    documents: 'هر ردیف یک دانش است: وضعیت، امتیاز ممیزی، تعداد ادعا و تعارض باز آن.',
    claims:
      'هر ردیف یک ادعای منفرد از نسخه جاری دانش‌هاست، با نتیجه ممیزی روی همان ادعا. برای پیدا کردن ادعاهای بدون پشتوانه مناسب است.',
  },
  filters: {
    status:
      'فقط دانش‌هایی را نشان می‌دهد که در این وضعیت‌اند. «منقضی» یعنی تأیید شده بوده ولی مدت اعتبارش تمام شده است.',
    sourceType: 'فیلتر بر پایه پیدایش دانش: ارائه‌شده توسط ادمین، با سرنخ ادمین یا تحقیق خودکار.',
    search: 'جست‌وجو در عنوان دانش‌ها. با کمی مکث پس از تایپ اعمال می‌شود.',
    support:
      'آیا Brain برای ادعا پشتوانه پیدا کرد؟ «بدون پشتوانه» یعنی ادعا با ارجاع یا متن منبع تأیید نشد. «ممیزی‌نشده» یعنی هنوز بررسی نشده.',
    kind: 'نوع ادعا: عددی، علّی، مقایسه‌ای، توصیه یا گزاره.',
    conflicted: 'فقط ادعاهایی که دست‌کم یک تعارض باز با ادعای دیگر دارند.',
  },
  columns: {
    title: 'عنوان دانش. با کلیک، صفحه کامل آن باز می‌شود.',
    scope:
      'دامنه‌ای که این دانش در آن در دسترس است: کل فضای کار، یک حوزه یا یک پروژه، و در صورت وجود محدود به یک نقش.',
    status: 'مرحله دانش در چرخه ممیزی. فقط «تأییدشده» و هنوز معتبر به ایجنت‌ها می‌رسد.',
    score: 'امتیاز کل ممیزی Brain از ۱۰۰. نبودن امتیاز یعنی هنوز ممیزی نشده است.',
    claims: 'تعداد ادعاهای نسخه جاری. عدد قرمز، تعداد تعارض‌های باز است.',
    validUntil:
      'پس از این تاریخ دانش «منقضی» می‌شود و از بازیابی کنار می‌رود. «بدون انقضا» یعنی تا تغییر محتوا معتبر است.',
    claim: 'متن ادعا همان‌طور که از دانش استخراج یا وارد شده است.',
    kind: 'نوع ادعا (عددی، علّی، مقایسه‌ای، توصیه یا گزاره).',
    document: 'دانشی که این ادعا به آن تعلق دارد، همراه شماره نسخه و جایگاه ادعا.',
    support: 'نتیجه Brain: آیا ارجاع‌ها و متن منبع این ادعا را پشتیبانی می‌کنند؟',
    citations:
      'ارجاع‌های کامل از کل ارجاع‌های ادعا. ارجاع کامل پنج چیز دارد: نشانی، عنوان، ناشر، تاریخ انتشار و تاریخ دسترسی.',
    conflicts: 'تعداد تعارض‌های باز این ادعا با ادعاهای دیگر.',
    decision: 'تصمیم مؤثر: تصمیم Brain، یا تصمیم دستی ادمین اگر override ثبت شده باشد.',
  },
  sources: {
    addSource:
      'یک فایل، متن یا نشانی وب را به‌عنوان منبع ثبت می‌کند. هنوز دانش نیست؛ بعد از پردازش می‌توانید از آن دانش بسازید.',
    search: 'جست‌وجو در عنوان منبع‌ها؛ با کمی مکث پس از تایپ اعمال می‌شود.',
    status:
      'مرحله پردازش منبع: بارگذاری، اسکن امنیتی، استخراج متن، ایندکس. «ناقص» یعنی بخشی از متن خوانده نشد؛ «ردشده» یا «ناموفق» دلیل فارسی دارد.',
    derived:
      'دانش‌هایی که از این منبع ساخته شده‌اند، با وضعیت هرکدام. «قدیمی» یعنی فایل منبع تغییر کرده و دانش باید تازه‌سازی شود.',
    makeKnowledge:
      'از متن استخراج‌شده این منبع یک پیش‌نویس دانش می‌سازد. در چند گام کوتاه عنوان، محرمانگی، دامنه و اعلامیه منبع را می‌پرسد.',
    retry: 'پردازش منبعی را که قرنطینه یا ناموفق شده دوباره اجرا می‌کند.',
    delete: 'منبع را حذف می‌کند. دانش ساخته‌شده از آن فقط اگر خودتان تیک بزنید حذف می‌شود.',
    newVersion:
      'نسخه تازه‌ای از همین فایل بارگذاری می‌کند. دانش‌های ساخته‌شده از نسخه قبلی «قدیمی» می‌شوند تا از منبع تازه‌سازی شوند.',
  },
  add: {
    mode: 'فایل: آپلود مستقیم و اسکن امنیتی. متن: چسباندن مستقیم. نشانی وب: خواندن صفحه از اینترنت.',
    title: 'نام قابل‌تشخیص برای منبع. اگر خالی بگذارید برای فایل، نام فایل استفاده می‌شود.',
    language: 'زبان متن؛ برای استخراج و جست‌وجوی درست لازم است.',
  },
  create: {
    steps: {
      basics: 'عنوان دانش را می‌نویسید و سطح محرمانگی آن را برمی‌گزینید.',
      scope: 'تعیین اینکه دانش برای کدام پروژه‌ها و نقش‌ها در دسترس باشد.',
      provenance: 'اینکه منبع از کجا آمده و چرا قابل‌اعتماد است؛ Brain آن را می‌سنجد.',
      review: 'مرور همه انتخاب‌ها پیش از ساختن پیش‌نویس.',
    },
    title: 'نامی که در فهرست دانش و ایجنت‌ها دیده می‌شود. به‌طور پیش‌فرض عنوان منبع است.',
    confidentiality:
      'سطح محرمانگی تعیین می‌کند محتوا به مدل‌های بیرونی داده شود یا نه. دانش «محدود» به‌طور پیش‌فرض به مدل نمی‌رسد.',
    role: 'اگر نقشی انتخاب کنید فقط همان ایجنت این دانش را می‌بیند؛ «همه نقش‌ها» یعنی بدون محدودیت.',
    addScope: 'یک دامنه دیگر اضافه می‌کند. دانش در اجتماع همه دامنه‌ها در دسترس است.',
    acceptPartial:
      'استخراج این منبع ناقص بوده است. فقط اگر مطمئنید متن خوانده‌شده برای ساخت دانش کافی است تیک بزنید.',
  },
  manual: {
    title: 'نامی کوتاه و روشن برای دانش که در فهرست‌ها دیده می‌شود.',
    language: 'زبان متن دانش (فارسی یا انگلیسی)؛ برای خواندن و جست‌وجوی درست آن لازم است.',
    confidentiality: 'سطح محرمانگی؛ تعیین می‌کند آیا محتوا به مدل بیرونی داده شود.',
    sourceType:
      'اینکه این دانش چگونه پدید آمده: ارائه‌شده توسط ادمین، با سرنخ ادمین یا تحقیق خودکار.',
    validFrom: 'آغاز اعتبار. خالی یعنی از همین حالا.',
    validUntil: 'پایان اعتبار. پس از آن دانش «منقضی» می‌شود. خالی یعنی تا تغییر محتوا.',
    claimText: 'یک گزاره مستقل و قابل بررسی، مثلا «نرخ بازگشت ۱۸ درصد بود».',
    claimKind: 'نوع گزاره؛ Brain بر اساس آن ادعا را می‌سنجد.',
    addClaim: 'یک ادعا اضافه می‌کند. می‌توانید تا ۵۰۰ ادعا وارد کنید.',
    sourceRef: 'نشانی اینترنتی یا شناسه‌ای که خواننده را به منبع می‌رساند (مثل DOI).',
    citationTitle: 'عنوان سند یا مقاله‌ای که به آن ارجاع می‌دهید.',
    publisher: 'نهاد یا نشری که منبع را منتشر کرده است.',
    author: 'نام نویسنده یا نویسندگان منبع؛ پر کردن آن اختیاری است.',
    publishedAt: 'تاریخی که منبع منتشر شده است؛ برای سنجیدن تازگی ارجاع لازم است.',
    accessedAt: 'تاریخی که خودتان منبع را دیده‌اید؛ برای ارجاع کامل لازم است.',
    locator: 'محل دقیق در منبع، مثلا شماره صفحه یا بخش؛ اختیاری.',
    quote: 'نقل‌قول کوتاه از خود منبع که ادعا را پشتیبانی می‌کند؛ اختیاری.',
    addCitation: 'یک ارجاع به این ادعا اضافه می‌کند. تا ۲۰ ارجاع برای هر ادعا.',
  },
  conflicts: {
    open: 'تعارض‌هایی که هنوز تصمیمی برایشان ثبت نشده است.',
    resolved: 'تعارض‌هایی که بسته شده‌اند، با توضیح حل‌شدن.',
  },
  retrieval: {
    query: 'پرسشی که یک ایجنت از دانش می‌پرسد. همان‌طور بنویسید که ایجنت می‌پرسد.',
    scope:
      'بازیابی در کدام دامنه انجام شود: کل فضای کار، یک حوزه یا یک پروژه. دانشِ بیرون از این دامنه دیده نمی‌شود.',
    role: 'بازیابی از دید کدام نقش ایجنت. دانشی که به نقش دیگری محدود شده باشد نمایش داده نمی‌شود.',
    results:
      'هر نتیجه یک قطعه از دانش تأییدشده است، با امتیاز ترکیبی، امتیاز ممیزی، رتبه واژگانی و رتبه معنایی.',
  },
  detail: {
    actions:
      'اقدام‌های اصلی این دانش: ارسال به ممیزی Brain، یا تازه‌سازی از منبع اگر قدیمی شده باشد.',
    audit:
      'Brain متن و ادعاهای این نسخه را با شش معیار می‌سنجد و تصمیم می‌دهد: تأیید، نیازمند اصلاح یا رد.',
    edit: 'ثبت نسخه تازه متن و حذف دانش. هر تغییر محتوا یک نسخه جدید است و دوباره باید ممیزی شود.',
    content: 'متن کامل دانش. هر تغییر یک نسخه جدید می‌سازد؛ نسخه قبلی دست‌نخورده می‌ماند.',
    validFrom: 'آغاز اعتبار این نسخه. خالی یعنی بلافاصله.',
    deleteSection: 'حذف دانش با تأیید و دلیل. رد حذف در ثبت رویدادها می‌ماند.',
    deleteReason: 'اختیاری؛ در ثبت رویدادها نگه داشته می‌شود.',
    renewReason: 'چرا از نسخه تازه منبع تازه‌سازی می‌کنید؟ در تاریخچه می‌ماند.',
    renewAcceptPartial:
      'نسخه تازه منبع ناقص خوانده شده؛ فقط اگر مطمئنید برای دانش کافی است تیک بزنید.',
    overrideBrain:
      'تصمیم و امتیاز خودِ Brain. override این را پاک نمی‌کند، فقط کنارش تصمیم دستی می‌گذارد.',
    overrideCurrent: 'تصمیمی که اکنون بازیابی ایجنت‌ها بر پایه آن عمل می‌کند.',
    overrideEvidence: 'نمره هر معیار و نقص‌های بحرانی؛ شواهدی که باید پیش از تصمیم دستی ببینید.',
    overrideDecision:
      'تأیید: دانش وارد بازیابی می‌شود. رد: از بازیابی خارج می‌شود. هر دو بلافاصله اثر می‌کنند.',
    overrideValidity:
      '«تا تغییر محتوا» یعنی تا نسخه بعدی؛ «تا تاریخ مشخص» یعنی بعد از آن دوباره تصمیم Brain معتبر است.',
    overrideEffect: 'خلاصه آنچه پس از ثبت رخ می‌دهد؛ پیش از تأیید نهایی آن را بخوانید.',
    overrideHistory: 'همه تصمیم‌های دستی پیشین این نسخه با دلیل و تاریخ.',
    reviewHistory: 'همه ممیزی‌های Brain روی نسخه‌های این دانش.',
    conflictsOfThis: 'تعارض‌های باز میان ادعاهای این دانش و دانش‌های دیگر.',
    overall: 'امتیاز کل: میانگین وزنی شش معیار، از ۱۰۰. آستانه‌ها زیر نوار نشان داده می‌شوند.',
    critical: 'نقص بحرانی یعنی مشکلی که به‌تنهایی دانش را رد می‌کند، هرچند امتیاز کل بالا باشد.',
    reasons: 'دلیل هر نمره و نقص؛ به زبان رابط نمایش داده می‌شود.',
    facts: {
      source:
        'اینکه دانش را ادمین ارائه کرده، با سرنخ ادمین ساخته شده یا تحقیق خودکار آن را آورده است.',
      confidentiality: 'سطح محرمانگی؛ تعیین می‌کند محتوا به مدل بیرونی داده شود یا نه.',
      language: 'زبان متن دانش (فارسی یا انگلیسی)؛ برای خواندن و جست‌وجوی درست آن لازم است.',
      version: 'شماره نسخه جاری. هر تغییر محتوا نسخه تازه‌ای است.',
      validFrom: 'تاریخ آغاز اعتبار نسخه جاری؛ پیش از آن دانش به ایجنت‌ها داده نمی‌شود.',
      validUntil: 'پایان اعتبار؛ پس از آن دانش منقضی می‌شود.',
      created: 'زمانی که این دانش برای نخستین بار ساخته شد.',
      updated: 'آخرین زمانی که دانش (نسخه، وضعیت یا دامنه) تغییر کرده است.',
      scopes: 'جاهایی که این دانش در آن‌ها و برای هر نقش در دسترس است.',
    },
    citation: {
      source: 'نشانی اینترنتی یا شناسه منبعی که به آن ارجاع شده است.',
      publisher: 'نهاد یا نشری که منبع ارجاع را منتشر کرده است.',
      author: 'نام نویسنده یا نویسندگان منبع ارجاع.',
      published: 'تاریخی که منبع منتشر شده است؛ برای سنجیدن تازگی ارجاع لازم است.',
      accessed: 'تاریخی که منبع ارجاع بررسی و دیده شده است.',
      locator: 'محل دقیق ادعا در منبع (صفحه، بخش یا بازه متن).',
      digest: 'اثر انگشت محتوای منبع؛ نشان می‌دهد ارجاع به همین نسخه از منبع است.',
    },
    citationsHeading: 'ارجاع‌های همین ادعا. برای تأییدشدن، ارجاع باید کامل باشد.',
    uses: {
      project: 'پروژه‌ای که ایجنت در آن این دانش را بازیابی کرده است.',
      stage: 'مرحله گردش‌کار که بازیابی در آن انجام شد.',
      query: 'متن پرسشی که ایجنت هنگام بازیابی از دانش‌ها پرسید.',
      version: 'شماره نسخه‌ای از این دانش که به ایجنت داده شد.',
      when: 'زمانی که بازیابی انجام شد.',
      result: '«ارجاع تأییدشده» یعنی ارجاع‌یاب تأیید کرد که ایجنت از این دانش نقل کرده است.',
    },
  },
};

type Table = typeof fa;

const en: Table = {
  tabs: {
    queue:
      'Every knowledge item and where it stands in the audit: pending, approved, needs revision, rejected or expired. This shows what agents may use.',
    sources:
      'The raw material of knowledge: a file, text or web address. You upload a source, the system scans and extracts it, then you build knowledge from it.',
    manual:
      'Knowledge you type yourself, with exact claims and citations. For when you have no file or document.',
    conflicts:
      'Where two claims in two knowledge items in use disagree. Until resolved, retrieval returns a conflict warning with the result.',
    retrieval:
      'Try what agents would get for a question. The result is the real agent retrieval, not a simulation.',
  },
  view: {
    documents:
      'Each row is one knowledge item: status, audit score, claim count and open conflicts.',
    claims:
      'Each row is one claim of the current version of a knowledge item, with the audit result on that claim. Good for finding unsupported claims.',
  },
  filters: {
    status:
      'Shows only knowledge in this status. "Expired" means it was approved but its validity has ended.',
    sourceType:
      "Filter by how the knowledge came about: provided by an administrator, guided by an administrator's clue, or autonomous research.",
    search: 'Searches knowledge titles. It applies a moment after you stop typing.',
    support:
      'Did the Brain find support for the claim? "Unsupported" means neither citations nor the source text confirmed it. "Not audited" means it was not checked yet.',
    kind: 'The kind of claim: numeric, causal, comparative, recommendation or statement.',
    conflicted: 'Only claims that have at least one open conflict with another claim.',
  },
  columns: {
    title: 'The knowledge title. Click to open its full page.',
    scope:
      'Where this knowledge is available: the whole workspace, a topic or a project, and a role if it is limited to one.',
    status:
      'Where the knowledge is in the audit cycle. Only "approved" and still valid reaches agents.',
    score: 'The Brain audit score out of 100. No score means it has not been audited yet.',
    claims: 'Claims in the current version. The red number is open conflicts.',
    validUntil:
      'After this date the knowledge becomes "expired" and leaves retrieval. "No expiry" means valid until the content changes.',
    claim: 'The claim text as extracted or entered.',
    kind: 'The kind of claim (numeric, causal, comparative, recommendation or statement).',
    document:
      'The knowledge item this claim belongs to, with its version number and the claim position.',
    support: 'The Brain result: do the citations and the source text support this claim?',
    citations:
      'Complete citations out of all citations of the claim. A complete citation has five things: address, title, publisher, publication date and access date.',
    conflicts: 'Open conflicts of this claim with other claims.',
    decision:
      "The effective decision: the Brain decision, or the administrator's manual one if an override exists.",
  },
  sources: {
    addSource:
      'Records a file, text or web address as a source. It is not knowledge yet; once processed you can build knowledge from it.',
    search: 'Searches source titles; it applies a moment after you stop typing.',
    status:
      'Where the source is in processing: upload, security scan, text extraction, indexing. "Partial" means some text could not be read; "rejected" and "failed" give a reason.',
    derived:
      'Knowledge built from this source, with each one\'s status. "Stale" means the source file changed and the knowledge must be renewed.',
    makeKnowledge:
      "Builds a knowledge draft from this source's extracted text. A few short steps ask for the title, confidentiality, scope and source declaration.",
    retry: 'Runs the processing again for a source that was quarantined or failed.',
    delete: 'Deletes the source. Knowledge built from it goes only if you tick that.',
    newVersion:
      'Uploads a new version of this same file. Knowledge built from the old version becomes "stale" until renewed from the source.',
  },
  add: {
    mode: 'File: direct upload and security scan. Text: paste it in. Web address: the page is read from the internet.',
    title:
      'A recognisable name for the source. For a file, the file name is used if you leave it empty.',
    language: 'The language of the text; needed for correct extraction and search.',
  },
  create: {
    steps: {
      basics: 'The knowledge title and its confidentiality.',
      scope: 'Where the knowledge is available: which projects and roles.',
      provenance: 'Where the source came from and why it can be trusted; the Brain weighs it.',
      review: 'A last look at every choice before the draft is made.',
    },
    title: 'The name shown in the knowledge list and to agents. It starts as the source title.',
    confidentiality:
      'Confidentiality decides whether the content may be given to external models. "Restricted" knowledge does not reach a model by default.',
    role: 'If you choose a role only that agent sees this knowledge; "All roles" means no limit.',
    addScope: 'Adds another scope. The knowledge is available in the union of all scopes.',
    acceptPartial:
      'This source was only partly extracted. Tick it only if you are sure the text that was read is enough to build knowledge.',
  },
  manual: {
    title: 'A short, clear name for the knowledge.',
    language: 'The language of the knowledge text.',
    confidentiality:
      'Confidentiality level; decides whether the content may go to an external model.',
    sourceType:
      "How this knowledge came about: provided by an administrator, guided by an administrator's clue, or autonomous research.",
    validFrom: 'When validity starts. Empty means now.',
    validUntil:
      'When validity ends. After that the knowledge is "expired". Empty means until the content changes.',
    claimText: 'One standalone, checkable statement, for example "The return rate was 18 percent".',
    claimKind: 'The kind of statement; the Brain weighs the claim by it.',
    addClaim: 'Adds a claim. You can enter up to 500.',
    sourceRef: 'A web address or identifier (such as a DOI) that takes the reader to the source.',
    citationTitle: 'The title of the document or article you cite.',
    publisher: 'The body or press that published the source.',
    author: 'The author or authors; optional.',
    publishedAt: 'When the source was published; needed to judge how recent the citation is.',
    accessedAt: 'The day you looked at the source.',
    locator: 'The exact place in the source, such as a page or section; optional.',
    quote: 'A short quote from the source itself that backs the claim; optional.',
    addCitation: 'Adds a citation to this claim. Up to 20 per claim.',
  },
  conflicts: {
    open: 'Conflicts for which no decision has been recorded yet.',
    resolved: 'Conflicts that were closed, with the explanation of how they were resolved.',
  },
  retrieval: {
    query: 'The question an agent asks the knowledge. Write it the way an agent would.',
    scope:
      'Which scope the retrieval runs in: the whole workspace, a topic or a project. Knowledge outside it is not seen.',
    role: 'Which agent role retrieves. Knowledge limited to another role is not shown.',
    results:
      'Each result is a piece of approved knowledge, with a combined score, the audit score, the lexical rank and the semantic rank.',
  },
  detail: {
    actions:
      'The main actions for this knowledge: send it to the Brain audit, or renew it from its source if it went stale.',
    audit:
      "The Brain checks this version's text and claims against six criteria and decides: approve, needs revision or reject.",
    edit: 'Save a new version of the text, or delete the knowledge. Every content change is a new version and must be audited again.',
    content:
      'The full knowledge text. Any change makes a new version; the previous one stays untouched.',
    validFrom: 'When this version becomes valid. Empty means immediately.',
    deleteSection:
      'Deletes the knowledge with a confirmation and a reason. The deletion stays in the audit log.',
    deleteReason: 'Optional; kept in the audit log.',
    renewReason: 'Why are you renewing from the new source version? It stays in the history.',
    renewAcceptPartial:
      'The new source version was only partly read; tick only if you are sure it is enough.',
    overrideBrain:
      "The Brain's own decision and score. An override does not erase it; it puts a manual decision next to it.",
    overrideCurrent: 'The decision agent retrieval currently acts on.',
    overrideEvidence:
      'The score of each criterion and the critical flaws: the evidence to see before a manual decision.',
    overrideDecision:
      'Approve: the knowledge enters retrieval. Reject: it leaves retrieval. Both take effect immediately.',
    overrideValidity:
      '"Until content changes" means until the next version; "until a date" means the Brain decision applies again after it.',
    overrideEffect:
      'A summary of what happens once recorded; read it before the final confirmation.',
    overrideHistory: 'Every earlier manual decision on this version, with reason and date.',
    reviewHistory: 'Every Brain audit across the versions of this knowledge.',
    conflictsOfThis: 'Open conflicts between claims of this knowledge and other knowledge.',
    overall: 'The weighted average of the six criteria, out of 100.',
    critical:
      'A critical flaw is one that rejects the knowledge by itself, however high the overall score.',
    reasons: 'The reason behind each score and flaw, shown in the interface language.',
    facts: {
      source:
        "Whether an administrator provided the knowledge, it was built from an administrator's clue, or autonomous research brought it.",
      confidentiality:
        'Confidentiality level; decides whether the content may go to an external model.',
      language: 'The language of the knowledge text.',
      version: 'The current version number. Every content change is a new version.',
      validFrom: 'When the current version became valid.',
      validUntil: 'When validity ends; after that the knowledge expires.',
      created: 'When this knowledge was first created.',
      updated: 'The last change to the knowledge.',
      scopes: 'Where this knowledge is available, and for which roles.',
    },
    citation: {
      source: 'The address or identifier of the cited source.',
      publisher: 'The body or press that published the cited source.',
      author: 'The name of the author or authors of the cited source.',
      published: 'When the source was published; needed to judge how recent the citation is.',
      accessed: 'The day the source was looked at.',
      locator: 'The exact place of the claim in the source (page, section or text range).',
      digest:
        'A fingerprint of the source content; shows the citation is to this exact version of the source.',
    },
    citationsHeading: 'The citations of this claim. To be accepted a citation must be complete.',
    uses: {
      project: 'The project in which an agent retrieved this knowledge.',
      stage: 'The workflow stage in which the retrieval happened.',
      query: 'The question the agent asked the knowledge.',
      version: 'The version of the knowledge the agent saw.',
      when: 'The time at which the retrieval was made.',
      result:
        '"Verified citation" means the citation verifier confirmed the agent quoted this knowledge.',
    },
  },
};

const tables: Record<Locale, Table> = { fa, en };

export const knowledgeHelp = (locale: Locale): Table => tables[locale];
export type KnowledgeHelp = Table;
