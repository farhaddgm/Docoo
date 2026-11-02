import { problemPatternDefinitionSchema } from './problem-pattern.js';

/** Draft examples for preview/testing; importing these never publishes a pattern. */
export const meetingProblemPattern = problemPatternDefinitionSchema.parse({
  schemaVersion: 1,
  key: 'meeting',
  title: 'جلسه',
  purpose: 'تبدیل نگرانی و ابهام به آمادگی برای یک تعامل واقعی',
  applicability: ['جلسه، مذاکره یا ملاقات پیش رو که کاربر می‌خواهد برای آن آماده شود'],
  inputs: [
    {
      key: 'context',
      question: 'با چه کسی، با چه رابطه‌ای و درباره چه چیزی ملاقات داری؟',
      required: true,
    },
    { key: 'goal', question: 'اگر ملاقات خوب پیش برود چه چیزی فرق کرده است؟', required: true },
    { key: 'concerns', question: 'کدام سؤال یا واکنش نگران‌کننده است؟', required: false },
    { key: 'boundaries', question: 'مرزها و موارد قابل انعطاف تو چیست؟', required: false },
  ],
  stages: [
    {
      key: 'context',
      title: 'شناخت موقعیت',
      activity: 'clarify',
      inputKeys: ['context'],
      guidance: ['اطلاعات گفته‌شده را استخراج کن و فقط ابهام ضروری را بپرس.'],
    },
    {
      key: 'goal',
      title: 'روشن کردن خواسته',
      activity: 'clarify',
      inputKeys: ['goal', 'boundaries'],
      guidance: ['هدف و مرزها را با کاربر تأیید کن.'],
    },
    {
      key: 'perspective',
      title: 'دیدگاه طرف مقابل',
      activity: 'analyze',
      inputKeys: ['context', 'concerns'],
      guidance: ['دیدگاه طرف مقابل را به‌صورت احتمال بیان کن و از واقعیت جدا نگه دار.'],
    },
    {
      key: 'practice',
      title: 'تمرین بخش سخت',
      activity: 'rehearse',
      inputKeys: ['goal', 'concerns'],
      guidance: ['نقش‌آفرینی را با انتخاب کاربر شروع کن؛ بازخورد مشخص و امکان تلاش دوباره بده.'],
    },
    {
      key: 'brief',
      title: 'برگه آمادگی',
      activity: 'produce',
      inputKeys: ['goal', 'boundaries'],
      guidance: ['برگه کوتاه و قابل ویرایش بساز؛ اطلاعات نامعلوم را جعل نکن.'],
    },
    {
      key: 'reflection',
      title: 'مرور پس از ملاقات',
      activity: 'reflect',
      inputKeys: [],
      guidance: [
        'پس از اعلام برگزاری ملاقات بپرس چه شد، چه چیزی غافلگیرکننده بود و دفعه بعد چه تغییری لازم است.',
      ],
    },
  ],
  research: {
    mode: 'when-needed',
    triggers: ['کاربر به اطلاعات قابل بررسی درباره موضوع مذاکره نیاز دارد'],
  },
  outputs: [
    {
      key: 'preparation-brief',
      title: 'برگه آمادگی',
      sections: [
        'هدف اصلی من',
        'جمله پیشنهادی شروع',
        'سه نکته یا سؤال مهم',
        'بخش سخت و نحوه مواجهه',
        'مرز یا نکته‌ای که نمی‌خواهم فراموش کنم',
      ],
    },
  ],
  qualityCriteria: [
    'هدف قابل بیان است',
    'شروع گفتگو قابل استفاده است',
    'بخش سخت تمرین شده یا کاربر از تمرین صرف‌نظر کرده است',
  ],
  boundaries: [
    'ذهن طرف مقابل را نمی‌خوانیم',
    'موفقیت جلسه تضمین نمی‌شود',
    'تمرین و مرور بعد از ملاقات اختیاری‌اند',
  ],
});

export const marketingExperimentProblemPattern = problemPatternDefinitionSchema.parse({
  schemaVersion: 1,
  key: 'marketing-experiment',
  title: 'طراحی آزمایش مارکتینگ',
  purpose: 'تبدیل ایده رشد به آزمایشی قابل سنجش',
  applicability: ['آزمایش یک فرضیه درباره مخاطب، پیام یا کانال'],
  inputs: [
    { key: 'hypothesis', question: 'کدام فرضیه را برای کدام مخاطب می‌آزماییم؟', required: true },
    { key: 'constraints', question: 'بودجه، زمان و داده پایه چیست؟', required: true },
  ],
  stages: [
    {
      key: 'frame',
      title: 'تعریف فرضیه',
      activity: 'clarify',
      inputKeys: ['hypothesis', 'constraints'],
      guidance: ['واقعیت، فرضیه و اطلاعات نامعلوم را جدا کن.'],
    },
    {
      key: 'evidence',
      title: 'بررسی شواهد',
      activity: 'research',
      inputKeys: ['hypothesis'],
      guidance: ['فقط برای شکاف مؤثر بر تصمیم تحقیق کن و منابع را ثبت کن.'],
    },
    {
      key: 'design',
      title: 'طراحی آزمایش',
      activity: 'produce',
      inputKeys: ['hypothesis', 'constraints'],
      guidance: ['اقدام، معیار، بازه زمانی و شرط توقف را مشخص کن.'],
    },
  ],
  research: { mode: 'when-needed', triggers: ['نبود شواهد درباره مخاطب یا کانال منتخب'] },
  outputs: [
    {
      key: 'experiment-plan',
      title: 'طرح آزمایش',
      sections: [
        'فرضیه',
        'مخاطب',
        'اقدام',
        'خط پایه و معیار موفقیت',
        'بودجه و زمان',
        'شرط توقف و تصمیم بعدی',
      ],
    },
  ],
  qualityCriteria: ['فرضیه قابل رد کردن است', 'معیار و شرط توقف پیش از اجرا تعیین شده‌اند'],
  boundaries: ['نرخ تبدیل یا شواهد ناموجود جعل نمی‌شود', 'اجرای کمپین به مجوز جداگانه نیاز دارد'],
});
