import type { Locale } from '../../i18n';

/**
 * The words of the Brain page (ADR-0033). The API sends kinds, counts and numbers only; every
 * sentence a person reads is made here, in Persian and English, in short plain language.
 * Longer explanations sit behind the "i" button (`*Help`).
 */
const fa = {
  intro:
    'Brain مشکل‌های مهم را پیدا می‌کند و کار پیشنهاد می‌دهد. بدون تأیید شما هیچ چیز عوض نمی‌شود.',
  scope: 'چه چیزی بررسی شود؟',
  scopeHelp:
    'همه پروژه‌ها یا فقط یک پروژه. دانش بین همه پروژه‌ها مشترک است؛ برای یک پروژه فقط دانشی بررسی می‌شود که به آن پروژه مربوط است یا برایش استفاده شده.',
  scopeAll: 'همه پروژه‌ها',
  period: 'مدت',
  periodHelp:
    'Brain نیمه دوم این مدت را با نیمه اول مقایسه می‌کند تا افت کیفیت و جهش هزینه را ببیند.',
  periods: { '7': '۷ روز اخیر', '30': '۳۰ روز اخیر', '90': '۹۰ روز اخیر' } as Record<
    string,
    string
  >,
  run: 'بررسی کن',
  running: 'در حال بررسی…',
  unchanged: 'ساختن گزارش هیچ چیز را تغییر نمی‌دهد.',
  modelEvaluation: 'بررسی نقش‌ها با مدل (هزینه دارد)',
  modelEvaluationHelp:
    'Brain چند خروجی اخیر هر نقش را با اصول و وظایف آن نقش مقایسه می‌کند. هر نقش یک فراخوانی مدل است و هزینه دارد. نتیجه در بخش «جزئیات نقش‌ها» می‌آید.',
  history: 'گزارش‌های قبلی',
  historyEmpty: 'هنوز گزارشی ساخته نشده است.',
  allScope: 'همه پروژه‌ها',
  oneProject: 'یک پروژه',
  findings: 'مهم‌ترین موارد',
  findingsHelp:
    'موارد از مهم به کم‌اهمیت مرتب شده‌اند. اهمیت از شدت مشکل، تعداد موردها و تازگی آن‌ها حساب می‌شود. هر مورد شاهد دارد: همان رکوردهایی که Brain دیده است.',
  noFindings: 'مورد مهمی پیدا نشد. در این مدت همه‌چیز عادی بود.',
  severity: { high: 'مهم', medium: 'متوسط', low: 'کم' } as Record<string, string>,
  evidence: 'شاهدها',
  evidenceHelp:
    'رکوردهایی که این مورد از آن‌ها پیدا شد. اگر پیوند داشته باشند، روی آن‌ها بزنید تا همان رکورد باز شود.',
  moreEvidence: 'و {n} مورد دیگر',
  evidenceTypes: {
    knowledge: 'دانش',
    knowledge_conflict: 'تعارض',
    stage_review: 'بازبینی',
    stage_attempt: 'تلاش',
    stage_run: 'اجرای مرحله',
    evaluation: 'ارزیابی',
    audit_override: 'تصمیم دستی',
    project: 'پروژه',
    model_invocation: 'فراخوانی مدل',
  } as Record<string, string>,
  nextSteps: 'کارهای پیشنهادی',
  nextStepsHelp:
    'پیوندها فقط یک صفحه را باز می‌کنند. دکمه «تأیید و اجرا» همان کاری را می‌کند که خودتان در صفحه مربوط می‌کردید، با همان اجازه‌ها. هر پیشنهاد فقط یک بار تأیید یا رد می‌شود و در Audit Log می‌ماند.',
  stages: {
    analysis: 'تحلیل',
    research: 'تحقیق',
    ideation: 'ایده‌پردازی',
    documentation: 'مستندسازی',
    evaluation: 'ارزیابی',
  } as Record<string, string>,
  kinds: {
    knowledge_weak: {
      title: 'دانش ضعیف',
      body: '{count} دانش تأییدشده امتیاز کم دارد (کم‌ترین: {lowest} از ۱۰۰).',
    },
    knowledge_unaudited: {
      title: 'دانش بدون ممیزی',
      body: '{count} دانش هنوز ممیزی نشده. قدیمی‌ترین {oldestDays} روز منتظر مانده.',
    },
    knowledge_stale: {
      title: 'دانش کهنه',
      body: '{expired} مورد منقضی شده، {expiring} مورد به‌زودی منقضی می‌شود و منبع {sourceChanged} مورد عوض شده.',
    },
    knowledge_contradiction: {
      title: 'دانش متناقض',
      body: '{count} تعارض باز وجود دارد؛ {high} مورد شدید است.',
    },
    'quality_drift:rejection': {
      title: 'افت کیفیت در مرحله {stage}',
      body: 'خروجی ردشده از {previousPercent}٪ به {recentPercent}٪ رسیده ({count} رد).',
    },
    'quality_drift:incomplete': {
      title: 'افت کیفیت در مرحله {stage}',
      body: 'خروجی ناقص از {previousPercent}٪ به {recentPercent}٪ رسیده ({count} مورد).',
    },
    'risky_decision:passed_stage': {
      title: 'مرحله با تصمیم دستی گذشت',
      body: '{count} مرحله بعد از تمام شدن تلاش‌ها با تصمیم شما ادامه یافت.',
    },
    'risky_decision:exception': {
      title: 'ارزیابی ردشده با استثنا پذیرفته شد',
      body: '{count} ارزیابی ردشده را با استثنا پذیرفته‌اید.',
    },
    'risky_decision:override': {
      title: 'تصمیم دستی خلاف نظر Brain',
      body: '{count} دانش را برخلاف ممیزی Brain تأیید کرده‌اید.',
    },
    'cost_anomaly:spike': {
      title: 'جهش هزینه',
      body: 'هزینه این پروژه از {previousUsd} دلار به {recentUsd} دلار رسیده.',
    },
    'cost_anomaly:unpriced': {
      title: 'هزینه بدون قیمت',
      body: '{count} فراخوانی قیمت ندارد؛ هزینه واقعی ممکن است بیشتر باشد.',
    },
    'recurring_failure:provider': {
      title: 'خطای تکراری ارائه‌دهنده',
      body: '{count} بار خطای «{errorCode}» از {provider}.',
    },
    'recurring_failure:attempts': {
      title: 'تمام شدن تلاش‌ها در مرحله {stage}',
      body: '{count} بار تلاش‌های این مرحله تمام شد.',
    },
  } as Record<string, { title: string; body: string }>,
  actions: {
    open_knowledge: 'باز کردن دانش',
    open_conflicts: 'دیدن تعارض‌ها',
    open_project: 'باز کردن پروژه',
    open_costs: 'دیدن هزینه',
    open_providers: 'دیدن اتصال‌ها',
    open_agent: 'دیدن نقش',
    audit_knowledge: 'ممیزی این دانش',
    request_revision: 'خواستن بازبینی این خروجی',
    pause_project: 'توقف این پروژه',
  } as Record<string, string>,
  confirmText: {
    audit_knowledge: 'ممیزی Brain روی نسخه فعلی این دانش اجرا می‌شود و دانش تأیید یا رد می‌شود.',
    request_revision: 'خروجی فعلی این مرحله رد می‌شود و ایجنت یک تلاش تازه انجام می‌دهد.',
    pause_project: 'پروژه متوقف می‌شود تا خودتان دوباره آن را ادامه دهید.',
  } as Record<string, string>,
  approve: 'تأیید و اجرا',
  confirm: 'بله، انجام شود',
  cancel: 'انصراف',
  dismiss: 'رد پیشنهاد',
  noteLabel: 'یادداشت (اختیاری)',
  working: 'در حال انجام…',
  decisions: {
    done: 'انجام شد',
    dismissed: 'رد شد',
    failed: 'ناموفق بود',
    running: 'در حال انجام',
  } as Record<string, string>,
  errors: {
    BRAIN_ACTION_FORBIDDEN: 'اجازه این کار را ندارید.',
    BRAIN_ACTION_DECIDED: 'درباره این پیشنهاد قبلا تصمیم گرفته شده است.',
    KNOWLEDGE_ALREADY_REVIEWED: 'این دانش دیگر قابل ممیزی نیست. گزارش تازه بسازید.',
    WORKFLOW_OUTPUT_SUPERSEDED: 'خروجی عوض شده است. گزارش تازه بسازید.',
    PROJECT_STATE_CONFLICT: 'وضعیت پروژه عوض شده است. گزارش تازه بسازید.',
    PROJECT_VERSION_CONFLICT: 'پروژه از زمان گزارش تغییر کرده است. گزارش تازه بسازید.',
    generic: 'انجام نشد. گزارش تازه بسازید و دوباره امتحان کنید.',
  } as Record<string, string>,
  narrative: 'خلاصه ساده',
  narrativeHelp:
    'این خلاصه را مدل نوشته است. فقط نوع و تعداد مشکل‌ها به مدل داده می‌شود، نه متن پروژه یا دانش. با تنظیم «brain.narrative_enabled» روشن می‌شود و هر گزارش یک فراخوانی مدل هزینه دارد.',
  narrativeBadge: 'نوشته مدل',
  roleDetails: 'جزئیات نقش‌ها',
  roleDetailsHelp:
    'انحراف هر نقش از منشورش، با شاهد، و در صورت درخواست ارزیابی مدل‌محور. این بخش برای کسی است که می‌خواهد دقیق‌تر بداند.',
  loadFailed: 'بارگیری نشد.',
};

type Messages = typeof fa;

const en: Messages = {
  intro:
    'Brain finds the important problems and suggests what to do. Nothing changes unless you approve it.',
  scope: 'What should be checked?',
  scopeHelp:
    'All projects, or just one. Knowledge is shared by all projects; for one project, only the knowledge that belongs to it or was used for it is checked.',
  scopeAll: 'All projects',
  period: 'Period',
  periodHelp:
    'Brain compares the second half of this period with the first half to spot a drop in quality or a jump in cost.',
  periods: { '7': 'Last 7 days', '30': 'Last 30 days', '90': 'Last 90 days' },
  run: 'Check now',
  running: 'Checking…',
  unchanged: 'Making a report changes nothing.',
  modelEvaluation: 'Check the roles with the model (costs money)',
  modelEvaluationHelp:
    'Brain compares a few recent outputs of each role with the principles and duties of that role. Each role is one model call and has a cost. The result appears under “Role details”.',
  history: 'Earlier reports',
  historyEmpty: 'No report has been made yet.',
  allScope: 'All projects',
  oneProject: 'One project',
  findings: 'Most important points',
  findingsHelp:
    'Points are sorted from most to least important. Importance comes from how serious the problem is, how many items it covers and how recent they are. Every point has evidence: the records Brain looked at.',
  noFindings: 'Nothing important was found. All looked normal in this period.',
  severity: { high: 'Important', medium: 'Medium', low: 'Minor' },
  evidence: 'Evidence',
  evidenceHelp:
    'The records this point was found from. If an item is a link, select it to open that record.',
  moreEvidence: 'and {n} more',
  evidenceTypes: {
    knowledge: 'Knowledge',
    knowledge_conflict: 'Conflict',
    stage_review: 'Review',
    stage_attempt: 'Attempt',
    stage_run: 'Stage run',
    evaluation: 'Evaluation',
    audit_override: 'Manual decision',
    project: 'Project',
    model_invocation: 'Model call',
  },
  nextSteps: 'Suggested next steps',
  nextStepsHelp:
    'Links only open a page. “Approve and run” does what you would do yourself on that page, with the same permissions. Each suggestion can be approved or dismissed once, and stays in the audit log.',
  stages: {
    analysis: 'Analysis',
    research: 'Research',
    ideation: 'Ideation',
    documentation: 'Documentation',
    evaluation: 'Evaluation',
  },
  kinds: {
    knowledge_weak: {
      title: 'Weak knowledge',
      body: '{count} approved knowledge item(s) have a low score (lowest: {lowest} of 100).',
    },
    knowledge_unaudited: {
      title: 'Knowledge without an audit',
      body: '{count} knowledge item(s) have not been audited. The oldest has waited {oldestDays} day(s).',
    },
    knowledge_stale: {
      title: 'Out-of-date knowledge',
      body: '{expired} expired, {expiring} expire soon and the source of {sourceChanged} changed.',
    },
    knowledge_contradiction: {
      title: 'Contradicting knowledge',
      body: '{count} conflict(s) are open; {high} serious.',
    },
    'quality_drift:rejection': {
      title: 'Quality is dropping in {stage}',
      body: 'Rejected outputs went from {previousPercent}% to {recentPercent}% ({count} rejected).',
    },
    'quality_drift:incomplete': {
      title: 'Quality is dropping in {stage}',
      body: 'Incomplete outputs went from {previousPercent}% to {recentPercent}% ({count} of them).',
    },
    'risky_decision:passed_stage': {
      title: 'A stage was passed by decision',
      body: '{count} stage(s) went on by your decision after the attempts ran out.',
    },
    'risky_decision:exception': {
      title: 'A failed evaluation was accepted',
      body: 'You accepted {count} failed evaluation(s) with an exception.',
    },
    'risky_decision:override': {
      title: 'A decision against Brain’s opinion',
      body: 'You approved {count} knowledge item(s) against the Brain audit.',
    },
    'cost_anomaly:spike': {
      title: 'Cost jump',
      body: 'This project’s cost went from ${previousUsd} to ${recentUsd}.',
    },
    'cost_anomaly:unpriced': {
      title: 'Cost without a price',
      body: '{count} call(s) have no price, so the real cost may be higher.',
    },
    'recurring_failure:provider': {
      title: 'Repeated provider error',
      body: 'The error “{errorCode}” from {provider} happened {count} times.',
    },
    'recurring_failure:attempts': {
      title: 'Attempts ran out in {stage}',
      body: 'The attempts of this stage ran out {count} times.',
    },
  },
  actions: {
    open_knowledge: 'Open the knowledge',
    open_conflicts: 'See the conflicts',
    open_project: 'Open the project',
    open_costs: 'See the cost',
    open_providers: 'See the connections',
    open_agent: 'See the role',
    audit_knowledge: 'Audit this knowledge',
    request_revision: 'Ask for a new version of this output',
    pause_project: 'Pause this project',
  },
  confirmText: {
    audit_knowledge:
      'The Brain audit runs on the current version of this knowledge, which is then approved or rejected.',
    request_revision:
      'The current output of this stage is rejected and the agent makes a new attempt.',
    pause_project: 'The project is paused until you resume it yourself.',
  },
  approve: 'Approve and run',
  confirm: 'Yes, do it',
  cancel: 'Cancel',
  dismiss: 'Dismiss',
  noteLabel: 'Note (optional)',
  working: 'Working…',
  decisions: { done: 'Done', dismissed: 'Dismissed', failed: 'Failed', running: 'Running' },
  errors: {
    BRAIN_ACTION_FORBIDDEN: 'You may not do this.',
    BRAIN_ACTION_DECIDED: 'This suggestion was already decided.',
    KNOWLEDGE_ALREADY_REVIEWED: 'This knowledge can no longer be audited. Make a new report.',
    WORKFLOW_OUTPUT_SUPERSEDED: 'The output has changed. Make a new report.',
    PROJECT_STATE_CONFLICT: 'The project state has changed. Make a new report.',
    PROJECT_VERSION_CONFLICT: 'The project changed after the report. Make a new report.',
    generic: 'It did not work. Make a new report and try again.',
  },
  narrative: 'Plain summary',
  narrativeHelp:
    'The model wrote this summary. It only receives the kinds and counts of the problems, never project or knowledge text. It is turned on by the setting “brain.narrative_enabled”, and each report costs one model call.',
  narrativeBadge: 'Written by the model',
  roleDetails: 'Role details',
  roleDetailsHelp:
    'How each role departs from its charter, with evidence, and the model-based evaluation if you asked for it. This is for someone who wants more detail.',
  loadFailed: 'Could not load.',
};

const messages: Record<Locale, Messages> = { fa, en };

export function brainMessages(locale: Locale): Messages {
  return messages[locale];
}

export const fill = (template: string, values: Record<string, string | number>) =>
  Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
