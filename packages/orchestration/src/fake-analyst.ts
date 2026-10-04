import { questionCategories, type QuestionCategory } from '@docoo/domain';
import type { NormalizedModelRequest } from '@docoo/providers';

import { ANALYSIS_ROUND_SCHEMA_NAME } from './analysis.js';

/** Two-word aspects, distinct enough that no two generated questions look alike. */
const ASPECTS: readonly (readonly [string, string])[] = [
  ['primary goal', 'هدف اصلی'],
  ['secondary goal', 'هدف فرعی'],
  ['target users', 'کاربران هدف'],
  ['project sponsor', 'حامی پروژه'],
  ['decision maker', 'تصمیم‌گیرنده نهایی'],
  ['regulatory duty', 'الزام قانونی'],
  ['hard deadline', 'مهلت قطعی'],
  ['first milestone', 'نخستین مرحله'],
  ['team size', 'اندازه تیم'],
  ['total budget', 'بودجه کل'],
  ['running cost', 'هزینه جاری'],
  ['existing data', 'داده موجود'],
  ['data quality', 'کیفیت داده'],
  ['data owner', 'مالک داده'],
  ['success metric', 'معیار موفقیت'],
  ['failure signal', 'نشانه شکست'],
  ['main risk', 'ریسک اصلی'],
  ['external dependency', 'وابستگی بیرونی'],
  ['legal limit', 'محدودیت حقوقی'],
  ['excluded area', 'حوزه خارج دامنه'],
  ['current process', 'فرایند فعلی'],
  ['pain point', 'نقطه درد'],
  ['past attempt', 'تلاش گذشته'],
  ['competitor move', 'اقدام رقیب'],
  ['market segment', 'بخش بازار'],
  ['peak season', 'فصل اوج'],
  ['approval chain', 'زنجیره تأیید'],
  ['support channel', 'کانال پشتیبانی'],
  ['training need', 'نیاز آموزش'],
  ['rollout plan', 'برنامه استقرار'],
  ['security rule', 'قاعده امنیتی'],
  ['privacy rule', 'قاعده حریم خصوصی'],
  ['reporting need', 'نیاز گزارش‌گیری'],
  ['integration point', 'نقطه یکپارچه‌سازی'],
  ['legacy system', 'سیستم قدیمی'],
  ['change appetite', 'تمایل به تغییر'],
  ['owner turnover', 'جابه‌جایی مسئول'],
  ['review rhythm', 'ریتم بازبینی'],
  ['quality bar', 'سطح کیفیت'],
  ['exit criterion', 'ملاک پایان'],
];

const CATEGORY_WORDS: Readonly<Record<QuestionCategory, readonly [string, string]>> = {
  goal: ['goal', 'هدف'],
  constraint: ['constraint', 'محدودیت'],
  context: ['context', 'زمینه'],
  stakeholder: ['stakeholder', 'ذی‌نفع'],
  time: ['time', 'زمان'],
  budget: ['budget', 'بودجه'],
  data: ['data', 'داده'],
  risk: ['risk', 'ریسک'],
  success_criteria: ['success criteria', 'معیار موفقیت'],
  out_of_scope: ['out of scope', 'خارج از دامنه'],
};

/** Questions per batch of the fake analyst: two batches reach the thirty-question minimum. */
const FAKE_BATCH = 20;

function dataOf(request: NormalizedModelRequest): Record<string, unknown> {
  const content = request.messages[0]?.content ?? '';
  const match = /<data>([\s\S]*)<\/data>/u.exec(content);
  try {
    return match ? (JSON.parse(match[1]!) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Deterministic stand-in for the analyst in CI and local development (provider kind `fake`):
 * two batches of twenty distinct questions covering every dimension, then "enough". Other
 * structured outputs are left to the generic schema sampler (returns null).
 */
export function fakeAnalystResponder(request: NormalizedModelRequest): unknown {
  if (request.responseSchema?.name !== ANALYSIS_ROUND_SCHEMA_NAME) return null;
  const data = dataOf(request);
  const persian = (request.instructions ?? '').includes('Persian');
  const index = persian ? 1 : 0;
  const asked = typeof data['asked'] === 'number' ? data['asked'] : 0;
  const capacity = typeof data['capacity'] === 'number' ? data['capacity'] : FAKE_BATCH;
  const gaps = Array.isArray(data['coverageGaps']) ? data['coverageGaps'].length : 0;
  const rejected = Array.isArray(data['reviewerFeedback']) && data['reviewerFeedback'].length > 0;

  const sufficient = asked >= 30 && gaps === 0;
  const count = sufficient || (rejected && asked >= 30) ? 0 : Math.min(capacity, FAKE_BATCH);
  const questions = Array.from({ length: count }, (_, offset) => {
    const number = asked + offset;
    const category = questionCategories[number % questionCategories.length]!;
    const aspect = ASPECTS[number % ASPECTS.length]![index];
    const word = CATEGORY_WORDS[category][index];
    return {
      text: persian
        ? `درباره ${aspect} چه می‌توانید بگویید؟`
        : `What can you say about the ${aspect}?`,
      category,
      rationale: persian
        ? `پاسخ، تصمیم‌های مربوط به ${word} را روشن می‌کند.`
        : `The answer settles decisions about the ${word}.`,
      followUpOf: 0,
    };
  });
  return {
    understood: persian
      ? `تا اینجا ${asked} پرسش مطرح شده و تصویر مسئله در حال روشن‌شدن است.`
      : `${asked} questions were asked so far and the problem is becoming clear.`,
    nextAmbiguity: persian
      ? 'مهم‌ترین ابهام باقی‌مانده، معیار موفقیت است.'
      : 'The success measure is the main open point.',
    sufficient: sufficient || (rejected && asked >= 30),
    sufficiencyReason: persian
      ? 'پوشش همهٔ ابعاد لازم کافی است.'
      : 'Every required dimension is covered.',
    categoryNotes: [],
    contradictions: [],
    questions,
  };
}
