import type { Locale } from '../../../i18n';

const messages = {
  fa: {
    stepOf: 'گام {n} از {total}',
    stepsLabel: 'گام‌های ساخت پروژه',
    steps: [
      'اطلاعات پایه و مسئله',
      'حوزه‌ها و اولویت',
      'گردش‌کار و gate',
      'ایجنت و مدل',
      'دانش و تحقیق',
      'راه‌حل‌ها',
      'اسناد',
      'مرور و ثبت',
    ],
    stepHelp: [
      'عنوان، کد و مسئلهٔ اولیه. مسئله پس از فعال‌شدن پروژه قابل‌تغییر نیست.',
      'حوزه‌های موضوعی پروژه به ترتیب اولویت؛ حوزهٔ اول در تعارض مقدارها برنده است.',
      'تأیید انسانی، تعداد تلاش هر مرحله و سقف هزینه. اگر چیزی را تغییر ندهید، مقدار ارث‌برده می‌ماند.',
      'اتصال و مدل هوش مصنوعی این پروژه. اصول، وظایف و دستور کار هر نقش بعد از ساخت پروژه در تب «ایجنت‌ها» تغییر می‌کند.',
      'چه مقدار دانش تأییدشده به مرحلهٔ تحقیق برسد.',
      'تعداد راه‌حل‌هایی که تولید می‌شود.',
      'سطح طول و قالب پیش‌فرض اسناد این پروژه. بازهٔ هر سطح در «قالب‌ها و سطوح سند» تعیین می‌شود.',
      'تنظیمات مؤثری که پروژه با آن شروع می‌کند و منبع هر مقدار. با «ساخت پروژه» همه با هم ثبت می‌شوند.',
    ],
    back: 'گام قبل',
    next: 'گام بعد',
    create: 'ساخت پروژه',
    creating: 'در حال ساخت…',
    draftSaved:
      'پیش‌نویس این صفحه خودکار در همین مرورگر نگه داشته می‌شود؛ خروج از صفحه داده را از بین نمی‌برد.',
    draftRestored: 'پیش‌نویس قبلی شما بازیابی شد.',
    discardDraft: 'شروع از نو',
    needBasics:
      'کد، عنوان و شرح مسئله لازم است و کد فقط حروف انگلیسی، رقم، «_» و «-» دارد (حداکثر ۶۴ نویسه).',
    inherited: 'مقدار ارث‌برده',
    changedHere: 'تغییرکرده برای این پروژه',
    reviewLoading: 'در حال محاسبهٔ تنظیمات مؤثر…',
    reviewFailed: 'تنظیمات مؤثر محاسبه نشد؛ مقدارها را بررسی کنید.',
    reviewTable: 'تنظیمات مؤثر پروژه',
    setting: 'تنظیم',
    value: 'مقدار',
    source: 'منبع',
    summary: 'خلاصهٔ پروژه',
    overridesCount: '{n} تنظیم برای این پروژه تغییر کرده است.',
    noOverrides: 'هیچ تنظیمی تغییر نکرده؛ پروژه همهٔ مقدارها را از حوزه‌ها و workspace می‌گیرد.',
    modelInherited: 'مدل ارث‌برده از workspace',
    created: 'پروژه ساخته شد. برای اجرا آن را در صفحهٔ خودش فعال کنید.',
  },
  en: {
    stepOf: 'Step {n} of {total}',
    stepsLabel: 'Steps to create a project',
    steps: [
      'Basics and the problem',
      'Topics and priority',
      'Workflow and gates',
      'Agents and model',
      'Knowledge and research',
      'Solutions',
      'Documents',
      'Review and create',
    ],
    stepHelp: [
      'Title, code and the initial problem. The problem cannot change once the project is active.',
      'The project’s topics in priority order; the first topic wins when their values conflict.',
      'Human approval, attempts per stage and the cost ceiling. Leave a value alone and it stays inherited.',
      'The AI connection and model of this project. The principles, duties and task of each role are changed after creation on the project’s Agents tab.',
      'How much approved knowledge reaches the research stage.',
      'How many solutions are generated.',
      'The length level and default template of this project’s documents. The range of each level is set on "Templates and document levels".',
      'The effective settings the project starts with and where each value comes from. "Create project" saves everything together.',
    ],
    back: 'Previous step',
    next: 'Next step',
    create: 'Create project',
    creating: 'Creating…',
    draftSaved:
      'This page keeps a draft in this browser automatically; leaving the page does not lose your input.',
    draftRestored: 'Your earlier draft was restored.',
    discardDraft: 'Start over',
    needBasics:
      'Code, title and the problem are required, and the code has only English letters, digits, "_" and "-" (at most 64 characters).',
    inherited: 'Inherited value',
    changedHere: 'Changed for this project',
    reviewLoading: 'Working out the effective settings…',
    reviewFailed: 'The effective settings could not be worked out; check the values.',
    reviewTable: 'Effective settings of the project',
    setting: 'Setting',
    value: 'Value',
    source: 'Source',
    summary: 'Project summary',
    overridesCount: '{n} setting(s) are changed for this project.',
    noOverrides:
      'No setting is changed; the project takes every value from its topics and the workspace.',
    modelInherited: 'Model inherited from the workspace',
    created: 'The project was created. Activate it on its own page to run it.',
  },
};

export type WizardText = (typeof messages)['fa'];

export function wizardMessages(locale: Locale): WizardText {
  return messages[locale];
}
