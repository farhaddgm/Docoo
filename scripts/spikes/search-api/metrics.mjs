/** توابع خالص برای spike مقایسهٔ ارائه‌دهندگان جست‌وجو؛ بدون I/O تا قابل‌آزمون باشند. */

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LETTER = /\p{L}/gu;

/** نسبت حروف عربی/فارسی به کل حروف متن؛ برای متن بدون حرف صفر است. */
export function persianRatio(text) {
  const letters = (text ?? '').match(LETTER)?.length ?? 0;
  if (letters === 0) return 0;
  return ((text ?? '').match(ARABIC_SCRIPT)?.length ?? 0) / letters;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** کلید یکتاسازی نشانی: بدون fragment، بدون پارامتر ردیابی و بدون اسلش پایانی. */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'fbclid' || key === 'gclid') u.searchParams.delete(key);
    }
    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    const query = u.searchParams.toString();
    return `${u.protocol}//${u.hostname}${path}${query ? `?${query}` : ''}`;
  } catch {
    return null;
  }
}

/** نتیجه‌های عادی‌شدهٔ یک ارائه‌دهنده را به آمار توصیفی تبدیل می‌کند. */
export function describeResults(results, language) {
  const seen = new Set();
  const hosts = new Set();
  let duplicates = 0;
  let inLanguage = 0;
  let withText = 0;
  for (const r of results) {
    const key = canonicalUrl(r.url);
    if (key === null) continue;
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
    const host = hostOf(r.url);
    if (host) hosts.add(host);
    const sample = `${r.title ?? ''} ${r.snippet ?? ''}`;
    const fa = persianRatio(sample) >= 0.3;
    if (language === 'fa' ? fa : !fa) inLanguage += 1;
    if ((r.snippet ?? '').trim().length >= 200) withText += 1;
  }
  const total = results.length;
  return {
    total,
    unique: seen.size,
    duplicates,
    distinctHosts: hosts.size,
    languageShare: total === 0 ? 0 : inLanguage / total,
    withTextShare: total === 0 ? 0 : withText / total,
  };
}

/** شباهت Jaccard میان مجموعه‌های نشانی دو ارائه‌دهنده (۰ تا ۱). */
export function urlOverlap(a, b) {
  const sa = new Set(a.map(canonicalUrl).filter(Boolean));
  const sb = new Set(b.map(canonicalUrl).filter(Boolean));
  if (sa.size === 0 && sb.size === 0) return 0;
  let both = 0;
  for (const k of sa) if (sb.has(k)) both += 1;
  return both / (sa.size + sb.size - both);
}

/**
 * دقت@k از قضاوت انسانی: ۰ نامرتبط، ۱ نیمه‌مرتبط، ۲ مرتبط.
 * نشانی بدون قضاوت شمرده نمی‌شود و در `unjudged` می‌آید تا گزارش، داده‌ی ناقص را پنهان نکند.
 */
export function precisionAtK(ranked, judgments, k) {
  const top = ranked.slice(0, k);
  let relevant = 0;
  let judged = 0;
  for (const r of top) {
    const key = canonicalUrl(r.url);
    const score = key === null ? undefined : judgments[key];
    if (score === undefined) continue;
    judged += 1;
    if (score >= 2) relevant += 1;
  }
  return {
    precision: judged === 0 ? null : relevant / judged,
    judged,
    unjudged: top.length - judged,
  };
}

/** هزینهٔ برآوردی یک جست‌وجو با قیمت هر هزار درخواست. */
export function costPerSearch(pricePerThousand) {
  return pricePerThousand / 1000;
}

export function median(values) {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
