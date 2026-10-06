import type { Locale } from '../../../i18n';
import { rateLimitErrors } from '../../../rate-limit-messages';

const messages = {
  fa: {
    title: 'کیفیت پرسش‌ها (ارزیابی Brain)',
    intro:
      'Brain پرسش‌های تحلیلگر را (نه پاسخ‌های شما را) با مدل می‌سنجد: آیا پاسخ تصمیمی را عوض می‌کند، راه‌حل خاصی را القا می‌کند، تکراری، مبهم یا نامناسب است. هر یافته شمارهٔ پرسش‌هایی را که نشان می‌دهد می‌آورد؛ یافتهٔ بی‌شاهد کنار گذاشته می‌شود. هیچ‌چیز خودکار تغییر نمی‌کند و هر ارزیابی یک تماس مدل هزینه دارد.',
    criteriaNote: 'جنبه‌هایی که سنجیده می‌شود را در «تنظیمات ← پرسش‌وپاسخ تحلیلگر» انتخاب می‌کنید.',
    run: 'ارزیابی کیفیت پرسش‌ها',
    running: 'در حال ارزیابی…',
    none: 'هنوز ارزیابی‌ای انجام نشده است.',
    latest: 'آخرین ارزیابی',
    when: 'زمان',
    scoreOf: 'امتیاز: {n} از ۵',
    questionsJudged: '{n} پرسش سنجیده شد',
    criteriaHeading: 'جنبه‌های سنجیده‌شده',
    criteria: {
      decision_relevance: 'اثر بر تصمیم',
      leading: 'القای راه‌حل',
      duplicate: 'تکراری بودن',
      vague: 'ابهام',
      tone: 'لحن',
    } as Record<string, string>,
    weaknesses: 'نقطه‌ضعف‌ها',
    strengths: 'نقطه‌قوت‌ها',
    noFindings: 'یافتهٔ دارای شاهدی ثبت نشد.',
    severities: { low: 'کم', medium: 'متوسط', high: 'زیاد' } as Record<string, string>,
    severity: 'اهمیت',
    recommendation: 'پیشنهاد',
    questions: 'پرسش‌ها',
    discarded: '{n} یافتهٔ بی‌شاهد یا خارج از جنبه‌های انتخابی کنار گذاشته شد.',
    failed: {
      provider_failure: 'ارائه‌دهندهٔ AI پاسخ نداد؛ ارزیابی انجام نشد. بعداً دوباره امتحان کنید.',
      invalid_output: 'پاسخ مدل قابل‌استفاده نبود؛ ارزیابی انجام نشد.',
    } as Record<string, string>,
    earlier: 'ارزیابی‌های قبلی',
    done: 'ارزیابی انجام شد.',
    loadFailed: 'ارزیابی‌های قبلی بارگذاری نشد.',
    errors: {
      ...rateLimitErrors.fa,
      AI_NOT_CONFIGURED: 'اتصال و مدل AI تنظیم نشده است؛ در «ارائه‌دهندگان AI» تنظیم کنید.',
      ANALYSIS_NO_QUESTIONS: 'تحلیلگر هنوز پرسشی نپرسیده است.',
    } as Record<string, string>,
    generic: 'ارزیابی انجام نشد؛ دوباره امتحان کنید.',
  },
  en: {
    title: 'Question quality (Brain evaluation)',
    intro:
      'The Brain judges the analyst’s questions (not your answers) with the model: would an answer change a decision, does a question steer towards a solution, is it a repeat, vague or badly put. Every finding names the questions it rests on, and a finding without evidence is dropped. Nothing is changed automatically, and each evaluation costs one model call.',
    criteriaNote: 'Choose which aspects are judged in “Settings ← Analyst questions”.',
    run: 'Evaluate question quality',
    running: 'Evaluating…',
    none: 'No evaluation has been made yet.',
    latest: 'Latest evaluation',
    when: 'When',
    scoreOf: 'Score: {n} of 5',
    questionsJudged: '{n} questions judged',
    criteriaHeading: 'Aspects judged',
    criteria: {
      decision_relevance: 'Bearing on a decision',
      leading: 'Steering to a solution',
      duplicate: 'Repeats',
      vague: 'Vagueness',
      tone: 'Tone',
    } as Record<string, string>,
    weaknesses: 'Weaknesses',
    strengths: 'Strengths',
    noFindings: 'No finding with evidence was recorded.',
    severities: { low: 'Low', medium: 'Medium', high: 'High' } as Record<string, string>,
    severity: 'Severity',
    recommendation: 'Recommendation',
    questions: 'Questions',
    discarded: '{n} finding(s) without evidence or outside the chosen aspects were dropped.',
    failed: {
      provider_failure:
        'The AI provider did not answer, so nothing was evaluated. Try again later.',
      invalid_output: 'The model’s answer was not usable, so nothing was evaluated.',
    } as Record<string, string>,
    earlier: 'Earlier evaluations',
    done: 'The evaluation is done.',
    loadFailed: 'Earlier evaluations could not be loaded.',
    errors: {
      ...rateLimitErrors.en,
      AI_NOT_CONFIGURED: 'No AI connection or model is set; configure it under “AI providers”.',
      ANALYSIS_NO_QUESTIONS: 'The analyst has not asked any question yet.',
    } as Record<string, string>,
    generic: 'The evaluation could not be made; try again.',
  },
} as const;

export function questionQualityMessages(locale: Locale) {
  return messages[locale];
}
