/** The texts of the semantic search card of the knowledge page (ADR-0061). */
const messages = {
  fa: {
    title: 'جست‌وجوی معنایی',
    help: 'با روشن‌بودن، متن اسناد «داخلی» با مدل embedding ارائه‌دهنده به بردار معنایی تبدیل می‌شود تا بازنویسی و فارسی/انگلیسی هم پیدا شود. اسناد «محرمانه» و «بسیار محرمانه» هرگز فرستاده نمی‌شوند. پرسش‌هایی که ایمیل، شماره یا کلید دارند هم فرستاده نمی‌شوند.',
    off: {
      not_enabled:
        'خاموش است. برای روشن‌کردن، مالک سامانه باید KNOWLEDGE_EMBEDDING_ENABLED را در تنظیمات محیطی سرور بگذارد.',
      internal_not_allowed:
        'خاموش است: ارسال متن اسناد داخلی هنوز مجاز نشده (KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL).',
      not_configured: 'خاموش است: کلید یا مدل embedding در تنظیمات محیطی سرور نیست.',
    } as Record<string, string>,
    on: 'روشن است. مدل: {model}',
    progress: '{embedded} از {eligible} بخش از اسناد داخلی بردار معنایی دارد.',
    local: '{n} بخش از اسناد غیرداخلی فقط محلی می‌ماند و فرستاده نمی‌شود.',
    held: '{n} بخش از اسناد داخلی ایمیل، شماره تلفن، کد ملی، کارت یا شبا دارد و فقط محلی می‌ماند؛ با واژه همچنان پیدا می‌شود.',
    error: 'انجام نشد. دوباره تلاش کنید.',
    run: 'ساخت بردار برای اسناد تازه',
    running: 'در حال ساخت…',
    done: '{embedded} بخش بردار گرفت{failed}.',
    failed: '؛ {n} دسته ناموفق بود و دفعهٔ بعد دوباره تلاش می‌شود',
  },
  en: {
    title: 'Semantic search',
    help: 'When on, the text of “internal” documents is turned into semantic vectors by the provider’s embedding model, so paraphrases and Persian/English questions are found. “Confidential” and “restricted” documents are never sent. Questions that contain an e-mail, a number or a key are not sent either.',
    off: {
      not_enabled:
        'Off. To turn it on, the system owner must set KNOWLEDGE_EMBEDDING_ENABLED in the server environment.',
      internal_not_allowed:
        'Off: sending the text of internal documents is not allowed yet (KNOWLEDGE_EMBEDDING_ALLOW_INTERNAL).',
      not_configured: 'Off: the embedding key or model is not set in the server environment.',
    } as Record<string, string>,
    on: 'On. Model: {model}',
    progress: '{embedded} of {eligible} chunks of internal documents have a semantic vector.',
    local: '{n} chunk(s) of non-internal documents stay local and are never sent.',
    held: '{n} chunk(s) of internal documents hold an e-mail, phone, national id, card or IBAN number and stay local; they are still found by their words.',
    error: 'It did not work. Try again.',
    run: 'Embed new documents',
    running: 'Embedding…',
    done: '{embedded} chunk(s) embedded{failed}.',
    failed: '; {n} batch(es) failed and will be tried again next time',
  },
};

export const semanticMessages = (locale: 'fa' | 'en') => messages[locale];
