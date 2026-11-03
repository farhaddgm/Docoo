/**
 * نرمال‌سازی و مقایسهٔ متن فارسی برای سنجش درک گفتار (فاز ۰ ADR-0055).
 * یک گوینده «۱۲ آبان ۱۴۰۵» می‌گوید و مدل «12 آبان 1405» می‌نویسد؛ این تفاوت‌ها خطا نیستند.
 */

const INDIC_DIGITS = new Map(
  [...'۰۱۲۳۴۵۶۷۸۹']
    .map((digit, index) => [digit, String(index)])
    .concat([...'٠١٢٣٤٥٦٧٨٩'].map((digit, index) => [digit, String(index)])),
);

/** رسم‌الخط عربی ← فارسی، ارقام ← لاتین، نیم‌فاصله ← فاصله، نشانه‌گذاری حذف. */
export function normalizeFa(input) {
  let text = String(input ?? '').normalize('NFKC');
  // اعراب (\u064B-\u065F، \u0670) و کشیده (\u0640) حذف می‌شود.
  text = text.replace(/[\u064B-\u065F\u0670\u0640]/gu, '');
  text = text.replace(/[يى]/gu, 'ی').replace(/ك/gu, 'ک').replace(/ة/gu, 'ه');
  text = text.replace(/[۰-۹٠-٩]/gu, (digit) => INDIC_DIGITS.get(digit) ?? digit);
  // جداکنندهٔ هزارگان میان رقم‌ها (۲٬۵۰۰٬۰۰۰ یا 2,500,000) حذف می‌شود.
  text = text.replace(/(\d)[\u066C,\u060C](?=\d{3}(?!\d))/gu, '$1');
  text = text.replace(/\u200C/gu, ' ');
  text = text.replace(/[\u060C\u061B\u061F\u066B.,;:!?()"'«»\-–—_/\\[\]{}]/gu, ' ');
  return text.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function distance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

/** خطای واژه (Word Error Rate) بین متن مرجع و متن شنیده‌شده؛ عدد بیش از ۱ ممکن است. */
export function wer(reference, heard) {
  const ref = normalizeFa(reference).split(' ').filter(Boolean);
  const hyp = normalizeFa(heard).split(' ').filter(Boolean);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return distance(ref, hyp) / ref.length;
}

/** خطای نویسه (Character Error Rate)، بدون فاصله‌ها. */
export function cer(reference, heard) {
  const ref = [...normalizeFa(reference).replace(/ /gu, '')];
  const hyp = [...normalizeFa(heard).replace(/ /gu, '')];
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return distance(ref, hyp) / ref.length;
}

/**
 * آیا موجودیت (نام، عدد، تاریخ) در متن هست؟ هر دو طرف نرمال می‌شوند. آرایه یعنی هر یک از
 * شکل‌های پذیرفتنی (مدل رونویسی ممکن است عدد را رقم یا حروف بنویسد).
 */
export function entityInText(text, entity) {
  if (Array.isArray(entity)) return entity.some((option) => entityInText(text, option));
  const wanted = normalizeFa(entity);
  return wanted.length > 0 && normalizeFa(text).includes(wanted);
}

export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
