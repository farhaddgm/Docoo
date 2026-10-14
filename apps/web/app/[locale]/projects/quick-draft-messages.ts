import type { Locale } from '../../i18n';

const messages = {
  fa: {
    profile: 'مسیر تحلیل',
    full: 'تحلیل کامل (حداقل ۳۰ سؤال)',
    quick: 'پیش‌نویس سریع (۱۲ تا ۱۵ سؤال)',
    warning: 'پیش‌نویس؛ ناقص‌تر از تحلیل کامل',
    help: 'مسیر سریع سند کوتاه سطح ۱ می‌سازد. می‌توانید بعداً با حفظ سؤال‌ها، پاسخ‌ها و فایل‌ها به تحلیل کامل ادامه دهید.',
    continue: 'ادامه به تحلیل کامل',
    effect:
      'سؤال‌ها، پاسخ‌ها، فایل‌ها و تاریخچه حفظ می‌شوند. تحلیل با حداقل ۳۰ سؤال و تأیید دوبارهٔ تعریف مسئله ادامه می‌یابد. اسناد سریع قبلی همچنان برچسب پیش‌نویس دارند.',
    continued: 'تحلیل کامل با پاسخ‌های قبلی شروع شد.',
    level: 'سند مسیر سریع در سطح ۱ نوشته می‌شود؛ تنظیم طول تحلیل کامل برای ادامه حفظ می‌شود.',
  },
  en: {
    profile: 'Analysis path',
    full: 'Full analysis (at least 30 questions)',
    quick: 'Quick draft (12 to 15 questions)',
    warning: 'Draft; less complete than full analysis',
    help: 'The quick path produces a short level 1 document. You can continue to full analysis later with your questions, answers and files preserved.',
    continue: 'Continue to full analysis',
    effect:
      'Questions, answers, files and history are preserved. Analysis continues to at least 30 questions and a new approval of the problem definition. Earlier quick documents retain their draft label.',
    continued: 'Full analysis started with your previous answers.',
    level:
      'Quick documents use level 1; the full analysis length setting is preserved for continuation.',
  },
} as const;

export const quickDraftMessages = (locale: Locale) => messages[locale];
