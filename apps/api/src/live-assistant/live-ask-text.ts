import type { LiveAskStop } from '@docoo/contracts';

import type { LiveLocale } from './capabilities.js';

/**
 * The few sentences the server itself says when the executor's model could not: nothing is made up
 * about what happened, and no provider message (which could carry a request or a key's name) is
 * ever shown.
 */
export function askAnswerText(input: {
  readonly locale: LiveLocale;
  readonly answer: string;
  readonly stop: LiveAskStop;
  readonly waiting: number;
}): string {
  const fa = input.locale === 'fa';
  const answer = input.answer.trim();
  if (input.stop === 'error') {
    return fa
      ? 'اتصال به مدل کار نکرد. اتصال و مدل اجرا را در تنظیمات دستیار بررسی کنید.'
      : 'The connection to the model did not work. Check the executor connection and model in the assistant settings.';
  }
  if (input.stop === 'cost_cap') {
    return fa
      ? 'به سقف هزینهٔ این درخواست رسیدم و همین‌جا ایستادم.'
      : 'I reached the cost cap of this request and stopped here.';
  }
  const note =
    input.stop === 'tool_limit'
      ? fa
        ? ' (چند کار را به‌خاطر سقف تعداد اقدام در هر درخواست انجام ندادم.)'
        : ' (I skipped some steps because of the limit on steps per request.)'
      : '';
  if (answer !== '') return answer + note;
  if (input.waiting > 0) {
    return fa
      ? `${input.waiting} تغییر برای تأیید شما آماده است.`
      : `${input.waiting} change${input.waiting === 1 ? ' is' : 's are'} waiting for your confirmation.`;
  }
  return fa ? 'پاسخی دریافت نشد.' : 'No answer came back.';
}
