/**
 * قیمت‌گذاری مصرف توکن یک پاسخ بلادرنگ.
 *
 * قیمت‌ها را اجراکننده می‌دهد (دلار به‌ازای هر میلیون توکن) و در کد ثابت نیست، چون قیمت‌های
 * گزارش‌شده در تحلیل ADR-0055 از منابع ثانویه‌اند. بدون قیمت، نتیجه «بدون قیمت» است و هرگز صفر نیست.
 *
 * `usage` همان شکل `response.usage` رویداد `response.done` است. اگر سرویس‌دهنده تخفیف کش را
 * جدا بر اساس نوع توکن نگوید، رقم دلاری **کران بالا** است (بدون تخفیف کش) و توکن‌های کش‌شده جدا می‌آیند.
 */

const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** توکن‌های یک پاسخ به تفکیک نوع. */
export function breakdown(usage) {
  const input = usage?.input_token_details ?? {};
  const output = usage?.output_token_details ?? {};
  return {
    inputTokens: num(usage?.input_tokens),
    outputTokens: num(usage?.output_tokens),
    totalTokens: num(usage?.total_tokens) || num(usage?.input_tokens) + num(usage?.output_tokens),
    audioIn: num(input.audio_tokens),
    textIn: num(input.text_tokens),
    cachedIn: num(input.cached_tokens),
    audioOut: num(output.audio_tokens),
    textOut: num(output.text_tokens),
  };
}

export const EMPTY_TOTALS = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  audioIn: 0,
  textIn: 0,
  cachedIn: 0,
  audioOut: 0,
  textOut: 0,
});

export function addTotals(a, b) {
  const result = { ...EMPTY_TOTALS };
  for (const key of Object.keys(result)) result[key] = num(a?.[key]) + num(b?.[key]);
  return result;
}

/** قیمت‌ها: `{ audioIn, audioOut, textIn, textOut }` دلار به‌ازای هر میلیون توکن. */
export function hasPrices(prices) {
  return ['audioIn', 'audioOut', 'textIn', 'textOut'].every(
    (key) => typeof prices?.[key] === 'number' && prices[key] >= 0,
  );
}

/** کران بالای هزینه؛ `null` یعنی قیمت داده نشده (نه صفر). */
export function priceTotals(totals, prices) {
  if (!hasPrices(prices)) return null;
  const million = 1_000_000;
  return (
    (num(totals.audioIn) * prices.audioIn +
      num(totals.audioOut) * prices.audioOut +
      num(totals.textIn) * prices.textIn +
      num(totals.textOut) * prices.textOut) /
    million
  );
}
