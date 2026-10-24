import type { Locale } from '../../../i18n';
import type { JourneyBlock, JourneyState, JourneyStep } from './project-journey';

const messages = {
  fa: {
    title: 'مسیر پروژه',
    intro:
      'از ساخت تا تکمیل، این گام‌ها را می‌روید. گام جاری مشخص است و دکمه‌اش شما را همان‌جا می‌برد.',
    stepsLabel: 'گام‌های پروژه',
    steps: {
      created: 'ساخت پروژه',
      activate: 'فعال‌سازی',
      analysis: 'تحلیل',
      ideas: 'تحقیق و ایده‌پردازی',
      documents: 'مستندسازی و ارزیابی',
      complete: 'تکمیل پروژه',
    } as Record<JourneyStep, string>,
    descriptions: {
      created: 'پروژه ساخته شد.',
      activate: 'با فعال‌سازی، گردش‌کار شروع می‌شود. به مسئله و دست‌کم یک حوزه نیاز دارد.',
      analysis:
        'تحلیلگر دربارهٔ مسئله پرسش می‌پرسد؛ شما پاسخ می‌دهید و تعریف مسئله را تأیید می‌کنید.',
      ideas:
        'پروژه تحقیق می‌کند و راه‌حل می‌سازد؛ خروجی هر مرحله را بازبینی و یک راه‌حل را انتخاب می‌کنید.',
      documents: 'اسناد نوشته و ارزیابی می‌شوند؛ شما نسخهٔ نهایی را تأیید می‌کنید.',
      complete: 'همهٔ مرحله‌ها تمام شده؛ با تکمیل پروژه کار بسته می‌شود.',
    } as Record<JourneyStep, string>,
    states: {
      done: 'انجام شد',
      current: 'گام جاری',
      waiting: 'منتظر شماست',
      blocked: 'متوقف',
      upcoming: 'بعدی',
    } as Record<JourneyState, string>,
    blocks: {
      needs_problem: 'برای فعال‌سازی، مسئلهٔ پروژه را بنویسید.',
      needs_topics: 'برای فعال‌سازی، دست‌کم یک حوزه برای پروژه انتخاب کنید.',
      paused: 'پروژه متوقف است؛ دلیل را برطرف و پروژه را ادامه دهید.',
      run_failed: 'یک مرحله با خطا مواجه شد یا ارائه‌دهندهٔ AI پاسخ نداد؛ در گردش‌کار بررسی کنید.',
      configuration: 'اتصال یا مدل AI تنظیم نشده است.',
      cost_limit: 'به سقف هزینهٔ این پروژه رسیدید.',
    } as Record<JourneyBlock, string>,
    tasks: '{n} کار منتظر شماست.',
    actions: {
      editProblem: 'ویرایش مسئله و حوزه‌ها',
      activate: 'شروع کار پروژه',
      analysis: 'رفتن به پرسش‌ها',
      workflow: 'رفتن به گردش‌کار',
      solutions: 'دیدن راه‌حل‌ها',
      documents: 'دیدن اسناد',
      complete: 'پایان‌دادن به پروژه',
      resume: 'از سرگیری پروژه',
    },
  },
  en: {
    title: 'Project journey',
    intro:
      'From creating to completing, these are the steps you go through. The current step is marked and its button takes you there.',
    stepsLabel: 'Project steps',
    steps: {
      created: 'Create the project',
      activate: 'Activate',
      analysis: 'Analysis',
      ideas: 'Research and ideas',
      documents: 'Documents and evaluation',
      complete: 'Complete the project',
    } as Record<JourneyStep, string>,
    descriptions: {
      created: 'The project was created.',
      activate: 'Activating starts the workflow. It needs the problem and at least one topic.',
      analysis:
        'The analyst asks about the problem; you answer and approve the problem definition.',
      ideas:
        'The project researches and builds solutions; you review the output of each stage and choose a solution.',
      documents: 'Documents are written and evaluated; you approve the final version.',
      complete: 'Every stage is done; completing the project closes the work.',
    } as Record<JourneyStep, string>,
    states: {
      done: 'Done',
      current: 'Current step',
      waiting: 'Waiting for you',
      blocked: 'Stopped',
      upcoming: 'Next',
    } as Record<JourneyState, string>,
    blocks: {
      needs_problem: 'To activate, write the problem of the project.',
      needs_topics: 'To activate, choose at least one topic for the project.',
      paused: 'The project is paused; fix the reason and resume it.',
      run_failed: 'A stage failed or the AI provider did not answer; look at it in the workflow.',
      configuration: 'No AI connection or model is configured.',
      cost_limit: "The project's cost ceiling was reached.",
    } as Record<JourneyBlock, string>,
    tasks: '{n} task(s) are waiting for you.',
    actions: {
      editProblem: 'Edit the problem and topics',
      activate: 'Start the project',
      analysis: 'Go to the questions',
      workflow: 'Go to the workflow',
      solutions: 'See the solutions',
      documents: 'See the documents',
      complete: 'Finish the project',
      resume: 'Pick the project back up',
    },
  },
} as const;

export function journeyMessages(locale: Locale) {
  return messages[locale];
}
