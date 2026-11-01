import type { Locale } from '../../../i18n';

const messages = {
  fa: {
    stepOf: 'گام {n} از {total}',
    stepsLabel: 'گام‌های ساخت پروژه',
    steps: ['مسئله', 'زمینه و روش', 'تنظیمات پیشرفته', 'مرور و ساخت'],
    stepHelp: [
      'اول بگویید پروژه دربارهٔ چیست: عنوان و شرح مسئله. مسئله پس از فعال‌شدن پروژه قابل‌تغییر نیست، پس آن را دقیق بنویسید.',
      'پروژه به کدام کسب‌وکار و حوزه‌ها مربوط است و تحلیلش کامل باشد یا سریع. حوزه‌ها به ترتیب اولویت‌اند؛ حوزهٔ اول در تعارض مقدارها برنده است.',
      'همه‌چیز مقدار پیش‌فرض مناسبی دارد و لازم نیست چیزی را تغییر بدهید. فقط اگر رفتار این پروژه باید با بقیه فرق کند، بخش مربوط را باز کنید.',
      'پیش از ساخت، خلاصهٔ پروژه و تنظیماتی را که با آن شروع می‌شود ببینید. با «ساخت پروژه» همه با هم ثبت می‌شوند.',
    ],
    required: 'اجباری',
    optional: 'اختیاری',
    stepDoneMark: 'کامل',
    stepNeedsWork: 'ناقص',
    stepChangedCount: '{n} تغییر',
    advancedIntro:
      'بدون تغییر، پروژه با پیش‌فرض‌های حوزه‌ها و workspace شروع می‌شود. بعد از ساخت هم می‌توانید این‌ها را در تب «تنظیمات» پروژه عوض کنید.',
    sectionTitles: {
      workflow: 'روند و تأیید',
      model: 'مدل هوش مصنوعی',
      research: 'دانش و تحقیق',
      solutions: 'راه‌حل‌ها',
      documents: 'اسناد',
    },
    sectionHelp: {
      workflow:
        'آیا هر مرحله منتظر تأیید شما بماند، هر مرحله چند بار دوباره تلاش کند و سقف هزینهٔ هر اجرا چقدر باشد.',
      model:
        'اتصال و مدل هوش مصنوعی این پروژه. اصول، وظایف و دستور کار هر نقش بعد از ساخت پروژه در تب «ایجنت‌ها» تغییر می‌کند.',
      research: 'چه مقدار دانش تأییدشده به مرحلهٔ تحقیق برسد.',
      solutions: 'چند راه‌حل تولید شود و با چه معیار و وزنی امتیاز بگیرند.',
      documents:
        'سطح طول و قالب پیش‌فرض اسناد این پروژه. بازهٔ هر سطح در «قالب‌ها و سطوح سند» تعیین می‌شود.',
    },
    settingTitles: {
      'workflow.require_human_approval': {
        title: 'تأیید دستی پیش از رفتن به مرحلهٔ بعد',
        hint: 'اگر روشن باشد، پروژه پس از پایان هر مرحله می‌ایستد تا شما خروجی را تأیید کنید.',
      },
      'workflow.max_attempts_per_stage': {
        title: 'حداکثر دفعات تلاش دوبارهٔ هر مرحله',
        hint: 'اگر مرحله‌ای شکست بخورد یا خروجی‌اش رد شود، حداکثر این‌قدر دوباره اجرا می‌شود؛ بعد از آن می‌ایستد و منتظر مدیر می‌ماند.',
      },
      'ai.max_cost_usd_per_run': {
        title: 'سقف هزینهٔ هر اجرا (دلار)',
        hint: 'جمع هزینهٔ مدل هوش مصنوعی در یک اجرای پروژه از این مبلغ بیشتر نمی‌شود.',
      },
      'research.max_queries': {
        title: 'تعداد عبارت‌های جست‌وجو در پایگاه دانش',
        hint: 'محقق از روی مسئله و هدف‌ها حداکثر این‌قدر عبارت جست‌وجو می‌سازد و هرکدام را جداگانه در پایگاه دانش می‌گردد. عدد بیشتر یعنی پوشش گسترده‌تر ولی کندتر.',
      },
      'research.knowledge_limit': {
        title: 'حداکثر تعداد بخش‌های دانشِ داده‌شده به مدل',
        hint: 'از نتیجهٔ جست‌وجو فقط این تعداد بخش (پاراگراف) از دانش تأییدشده در پرامپت مدل می‌گذارند. صفر یعنی تحقیق بدون استفاده از پایگاه دانش.',
      },
      'research.max_sources': {
        title: 'حداکثر تعداد منبعِ متمایز در تحقیق',
        hint: 'سقف تعداد منبع‌های متفاوت (سند یا مرجع دانش) که تحقیق از آن‌ها بهره می‌برد؛ چند بخش از یک منبع فقط یک منبع حساب می‌شود.',
      },
      'knowledge.min_audit_score': {
        title: 'حداقل امتیاز اعتبار دانش برای استفاده در تحقیق (۰ تا ۱)',
        hint: 'دانشی که امتیاز ممیزی‌اش کمتر از این مقدار باشد در تحقیق استفاده نمی‌شود. ۰٫۷ یعنی ۷۰٪.',
      },
      'solution.count': {
        title: 'تعداد راه‌حل‌های پیشنهادی',
        hint: 'در مرحلهٔ ایده‌پردازی چند راه‌حل تولید و امتیازدهی شود.',
      },
      'document.level': {
        title: 'سطح طول سند (۱ کوتاه تا ۵ بسیار مفصل)',
        hint: 'هرچه عدد بزرگ‌تر باشد سندهای خروجی مفصل‌تر نوشته می‌شوند.',
      },
      'document.default_template': {
        title: 'قالب پیش‌فرض سند',
        hint: 'ساختار کلی سندهایی که برای این پروژه نوشته می‌شود.',
      },
      'document.default_export_format': {
        title: 'فرمت پیش‌فرض خروجی سند',
        hint: 'فرمتی که در صفحهٔ سند ابتدا برای دانلود پیشنهاد می‌شود.',
      },
    } as Record<string, { title: string; hint: string }>,
    sectionDefault: 'پیش‌فرض',
    sectionChanged: '{n} تغییر',
    continueDefaults: 'ادامه با پیش‌فرض‌ها',
    noTopicsNote:
      'هنوز حوزه‌ای انتخاب نکرده‌اید. پروژه ساخته می‌شود ولی تا دست‌کم یک حوزه نداشته باشد نمی‌توان آن را فعال کرد.',
    reviewEdit: 'ویرایش',
    reviewEditProblem: 'ویرایش مسئله',
    reviewEditContext: 'ویرایش زمینه و روش',
    reviewEditAdvanced: 'ویرایش تنظیمات پیشرفته',
    roadmapTitle: 'بعد از ساخت چه می‌شود؟',
    roadmapIntro:
      'پروژه به‌صورت پیش‌نویس ساخته می‌شود و در صفحهٔ خودش «مسیر پروژه» را می‌بینید. مسیر این است:',
    roadmap: [
      'فعال‌سازی: پروژه را با یک دکمه فعال می‌کنید (به مسئله و دست‌کم یک حوزه نیاز دارد).',
      'تحلیل: تحلیلگر پرسش می‌پرسد و شما پاسخ می‌دهید؛ سپس تعریف مسئله را تأیید می‌کنید.',
      'تحقیق و ایده‌پردازی: خروجی هر مرحله را بازبینی می‌کنید و یک راه‌حل را انتخاب می‌کنید.',
      'مستندسازی و ارزیابی: اسناد نوشته و ارزیابی می‌شوند و شما تأیید نهایی را می‌دهید.',
      'تکمیل: پروژه را تکمیل می‌کنید؛ هر جا تصمیم شما لازم باشد همان‌جا اعلام می‌شود.',
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
    baselineFailed:
      'مقدار پیش‌فرض تنظیم‌ها بارگذاری نشد (احتمالاً ارتباط با سرور قطع شد). تا بارگذاری دوباره، تنظیم‌های پروژه نمایش داده نمی‌شوند.',
    baselineRetry: 'تلاش دوباره',
    reviewTable: 'تنظیمات مؤثر پروژه',
    setting: 'تنظیم',
    value: 'مقدار',
    source: 'منبع',
    summary: 'خلاصهٔ پروژه',
    problemTemplate: 'قالب مسئله',
    noProblemTemplate: 'بدون قالب',
    problemTemplateCandidate: 'نامزد؛ ارزیابی‌نشده',
    problemTemplateNote:
      'این قالب فقط پرسش‌های راهنما را نشان می‌دهد و نسخهٔ آن برای ثبت سابقه ذخیره می‌شود؛ در تحلیل یا خروجی پروژه تغییری ایجاد نمی‌کند. کیفیتش هنوز ارزیابی نشده است.',
    problemTemplatePrompts: 'پرسش‌های راهنمای قالب مسئله',
    problemTemplateRubric: 'rubric پیشنهادی (فقط برای بازبینی)',
    problemTemplateSuggestedSections: 'بخش‌های پیشنهادی سند',
    problemPattern: 'الگوی روش حل مسئله',
    noProblemPattern: 'بدون الگو؛ مسیر معمول پروژه',
    problemPatternNote:
      'نسخهٔ منتشرشدهٔ الگوی workspace به پروژه پیوست می‌شود. در این مرحله اجرای فعالیت‌ها به‌طور خودکار تغییر نمی‌کند.',
    problemPatternExecutionNote:
      'این نسخه فقط برای ردیابی روی پروژه ثبت می‌شود؛ اجرای مرحله‌های الگو تا اتصال و تأیید workflow فعال نیست.',
    overridesCount: '{n} تنظیم برای این پروژه تغییر کرده است.',
    noOverrides: 'هیچ تنظیمی تغییر نکرده؛ پروژه همهٔ مقدارها را از حوزه‌ها و workspace می‌گیرد.',
    modelInherited: 'مدل ارث‌برده از workspace',
    created: 'پروژه ساخته شد. برای اجرا آن را در صفحهٔ خودش فعال کنید.',
    criteriaTitle: 'معیارها و وزن‌های امتیازدهی راه‌حل',
    criteriaHelp:
      'وزن معیارهای فعال باید دقیقاً ۱۰۰ شود. اگر چیزی را تغییر ندهید، معیارهای پیش‌فرض می‌ماند؛ بعداً هم در تب «راه‌حل‌ها» نسخهٔ تازه می‌سازید.',
    criterion: 'معیار',
    weight: 'وزن',
    enabled: 'فعال',
    total: 'جمع وزن‌های فعال',
    criteriaNotHundred: 'جمع وزن‌های فعال باید ۱۰۰ باشد (اکنون {n}).',
    criteriaNoneEnabled: 'دست‌کم یک معیار باید فعال باشد.',
    criteriaLoading: 'در حال خواندن معیارهای پیش‌فرض…',
    criteriaReset: 'بازگشت به معیارهای پیش‌فرض',
    explorationBanner:
      'این یک کاوش است: مثل یک پروژه همهٔ مرحله‌ها را می‌گذراند، اما به‌جای ایده، ابعاد مختلف موضوع را پیشنهاد می‌دهد؛ هر بعد می‌تواند پروژه‌ای جدا شود. موضوع یا رویداد را در «مسئله» بنویسید.',
    dimensionBanner:
      'ساخت از بُعد «{candidate}» در کاوش «{exploration}». عنوان و شرح مسئله از آن پر شده است؛ هر چیزی را می‌توانید عوض کنید.',
    dimensionOpen: 'بازکردن کاوش',
    seedUnselected:
      'این بُعد هنوز در کاوش انتخاب نشده است. ابتدا آن را در تب راه‌حل‌های کاوش انتخاب کنید؛ فعلاً می‌توانید پروژه را دستی بسازید.',
    seedLoading: 'در حال خواندن بُعد از کاوش…',
    seedFailed: 'بُعد کاوش خوانده نشد؛ می‌توانید پروژه را دستی بسازید.',
    seedMissing: 'این بُعد در کاوش پیدا نشد؛ می‌توانید پروژه را دستی بسازید.',
    criteriaSummary: 'معیارهای راه‌حل',
    criteriaDefault: 'پیش‌فرض',
    criteriaCustom: '{n} معیار فعال با وزن دلخواه',
  },
  en: {
    stepOf: 'Step {n} of {total}',
    stepsLabel: 'Steps to create a project',
    steps: ['The problem', 'Context and method', 'Advanced settings', 'Review and create'],
    stepHelp: [
      'Start with what the project is about: a title and the problem. The problem cannot change once the project is active, so write it with care.',
      'Which business and topics the project belongs to, and whether its analysis is full or quick. Topics are in priority order; the first topic wins when their values conflict.',
      'Everything has a sensible default and you do not have to change anything. Open a section only if this project should behave differently from the rest.',
      'Before creating, see the project summary and the settings it starts with. "Create project" saves everything together.',
    ],
    required: 'Required',
    optional: 'Optional',
    stepDoneMark: 'Complete',
    stepNeedsWork: 'Incomplete',
    stepChangedCount: '{n} changed',
    advancedIntro:
      'Unchanged, the project starts with the defaults of its topics and the workspace. You can still change these after creation on the project’s Settings tab.',
    sectionTitles: {
      workflow: 'Workflow and approval',
      model: 'AI model',
      research: 'Knowledge and research',
      solutions: 'Solutions',
      documents: 'Documents',
    },
    sectionHelp: {
      workflow:
        'Whether each stage waits for your approval, how many times a stage may try again, and the cost ceiling of one run.',
      model:
        'The AI connection and model of this project. The principles, duties and task of each role are changed after creation on the project’s Agents tab.',
      research: 'How much approved knowledge reaches the research stage.',
      solutions: 'How many solutions are generated and the criteria and weights that score them.',
      documents:
        'The length level and default template of this project’s documents. The range of each level is set on "Templates and document levels".',
    },
    settingTitles: {
      'workflow.require_human_approval': {
        title: 'Manual approval before the next stage',
        hint: 'When on, the project pauses after each stage until you approve its output.',
      },
      'workflow.max_attempts_per_stage': {
        title: 'Maximum retries per stage',
        hint: 'If a stage fails or its output is rejected it is re-run up to this many times, then it pauses for the administrator.',
      },
      'ai.max_cost_usd_per_run': {
        title: 'Cost ceiling per run (USD)',
        hint: 'The total AI model cost of one project run will not exceed this amount.',
      },
      'research.max_queries': {
        title: 'Number of knowledge-base search phrases',
        hint: 'From the problem and objectives, research builds at most this many search phrases and runs each against the knowledge base. More means wider coverage but slower.',
      },
      'research.knowledge_limit': {
        title: 'Maximum knowledge passages given to the model',
        hint: 'Of the search results, only this many approved knowledge passages are put into the model prompt. Zero means research runs without the knowledge base.',
      },
      'research.max_sources': {
        title: 'Maximum distinct sources used in research',
        hint: 'The ceiling on different sources (documents or references) research may draw on; several passages from one source count as one source.',
      },
      'knowledge.min_audit_score': {
        title: 'Minimum knowledge reliability score for research (0 to 1)',
        hint: 'Knowledge whose audit score is below this is not used in research. 0.7 means 70%.',
      },
      'solution.count': {
        title: 'Number of proposed solutions',
        hint: 'How many solutions the ideation stage generates and scores.',
      },
      'document.level': {
        title: 'Document length level (1 short to 5 very detailed)',
        hint: 'The higher the number, the more detailed the output documents are.',
      },
      'document.default_template': {
        title: 'Default document template',
        hint: 'The overall structure of the documents written for this project.',
      },
      'document.default_export_format': {
        title: 'Default document export format',
        hint: 'The format offered first for download on the document page.',
      },
    } as Record<string, { title: string; hint: string }>,
    sectionDefault: 'Default',
    sectionChanged: '{n} changed',
    continueDefaults: 'Continue with the defaults',
    noTopicsNote:
      'You have not chosen a topic yet. The project can be created but cannot be activated until it has at least one topic.',
    reviewEdit: 'Edit',
    reviewEditProblem: 'Edit the problem',
    reviewEditContext: 'Edit context and method',
    reviewEditAdvanced: 'Edit advanced settings',
    roadmapTitle: 'What happens after creating?',
    roadmapIntro:
      'The project is created as a draft and its own page shows the "Project journey". It goes like this:',
    roadmap: [
      'Activate: one button activates the project (it needs the problem and at least one topic).',
      'Analysis: the analyst asks questions and you answer; then you approve the problem definition.',
      'Research and ideas: you review the output of each stage and choose a solution.',
      'Documents and evaluation: documents are written and evaluated and you give the final approval.',
      'Complete: you complete the project; anything that needs your decision is announced where it happens.',
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
    baselineFailed:
      'The default values of the settings could not be loaded (the connection to the server probably dropped). The project settings are hidden until they load.',
    baselineRetry: 'Try again',
    reviewTable: 'Effective settings of the project',
    setting: 'Setting',
    value: 'Value',
    source: 'Source',
    summary: 'Project summary',
    problemTemplate: 'Problem template',
    noProblemTemplate: 'No template',
    problemTemplateCandidate: 'Candidate; not evaluated',
    problemTemplateNote:
      'This template only shows optional prompts and its version is saved for traceability; it does not change project analysis or output. Its quality has not been evaluated.',
    problemTemplatePrompts: 'Problem-template prompts',
    problemTemplateRubric: 'Proposed rubric (review only)',
    problemTemplateSuggestedSections: 'Suggested document sections',
    problemPattern: 'Problem-solving pattern',
    noProblemPattern: 'No pattern; use the standard project path',
    problemPatternNote:
      'A published workspace pattern version is attached to the project. Execution does not change automatically at this stage.',
    problemPatternExecutionNote:
      'This version is recorded for traceability only; pattern-stage execution is not enabled until the workflow is connected and approved.',
    overridesCount: '{n} setting(s) are changed for this project.',
    noOverrides:
      'No setting is changed; the project takes every value from its topics and the workspace.',
    modelInherited: 'Model inherited from the workspace',
    created: 'The project was created. Activate it on its own page to run it.',
    criteriaTitle: 'Solution criteria and weights',
    criteriaHelp:
      'The enabled weights must add up to exactly 100. Leave them alone and the default criteria stay; you can still save a new version later on the Solutions tab.',
    criterion: 'Criterion',
    weight: 'Weight',
    enabled: 'Enabled',
    total: 'Sum of enabled weights',
    criteriaNotHundred: 'The enabled weights must add up to 100 (now {n}).',
    criteriaNoneEnabled: 'At least one criterion must be enabled.',
    criteriaLoading: 'Reading the default criteria…',
    criteriaReset: 'Back to the default criteria',
    explorationBanner:
      'This is an exploration: like a project it goes through every stage, but instead of ideas it proposes the dimensions of the topic, and each dimension can become a project of its own. Write the topic or event in the problem field.',
    dimensionBanner:
      'Made from the dimension “{candidate}” of the exploration “{exploration}”. The title and the problem statement are filled in from it; you can change anything.',
    dimensionOpen: 'Open the exploration',
    seedUnselected:
      'This dimension is not selected in the exploration yet. Select it in the exploration’s solutions tab first; for now you can make the project by hand.',
    seedLoading: 'Reading the dimension from the exploration…',
    seedFailed:
      'The dimension could not be read from the exploration; you can create the project by hand.',
    seedMissing:
      'This dimension was not found in the exploration; you can create the project by hand.',
    criteriaSummary: 'Solution criteria',
    criteriaDefault: 'Default',
    criteriaCustom: '{n} enabled criteria with chosen weights',
  },
};

export type WizardText = (typeof messages)['fa'];

export function wizardMessages(locale: Locale): WizardText {
  return messages[locale];
}
