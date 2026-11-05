/**
 * گزارش یک‌صفحه‌ای فاز ۰ (ADR-0055 بخش ۱۱). آستانه‌ها پیشنهادی‌اند و باید قبل از اجرا با مالک
 * نهایی شوند؛ گزارش آن‌ها را عیناً نشان می‌دهد تا داوری شفاف باشد. معیارهای بدون داده «نامعلوم»
 * می‌مانند و به‌عنوان قبول حساب نمی‌شوند.
 */
import { addTotals, EMPTY_TOTALS, hasPrices, priceTotals } from './cost.mjs';
import { median } from './text.mjs';

export const THRESHOLDS = Object.freeze({
  /** سهم سناریوهایی که ابزار درست را با آرگومان درست صدا زدند. */
  toolAccuracyMin: 0.9,
  /** میانهٔ خطای واژهٔ رونویسی فارسی. */
  werMedianMax: 0.15,
  /** سهم نام/عدد/تاریخ‌هایی که درست شنیده شدند. */
  entityHitMin: 0.9,
  /** میانهٔ تأخیر از پایان حرف تا اولین صدای پاسخ. */
  latencyMedianMsMax: 2500,
  /** هزینهٔ هر دقیقهٔ گفتگوی فعال (دلار)، کران بالا. */
  usdPerActiveMinuteMax: 0.5,
});

const ratio = (hits, total) => (total === 0 ? null : hits / total);

export function aggregate(results, meta = {}) {
  const withTool = results.filter((item) => item.score.tool);
  const entities = results.flatMap((item) => item.score.entities);
  const totals = results.reduce((sum, item) => addTotals(sum, item.score.totals), {
    ...EMPTY_TOTALS,
  });
  const usd = priceTotals(totals, meta.prices);
  const minutes = meta.activeSeconds > 0 ? meta.activeSeconds / 60 : null;
  const noTool = results.filter((item) => item.score.noToolOk !== null);
  return {
    scenarios: results.length,
    toolAccuracy: ratio(withTool.filter((item) => item.score.tool.ok).length, withTool.length),
    noToolAccuracy: ratio(noTool.filter((item) => item.score.noToolOk).length, noTool.length),
    werMedian: median(results.map((item) => item.score.wer)),
    sttMissing: results.filter((item) => item.score.sttMissing).length,
    entityHit: ratio(entities.filter((item) => item.hit).length, entities.length),
    latencyMedianMs: median(results.map((item) => item.score.latencyMs)),
    totals,
    usd,
    usdPerActiveMinute: usd !== null && minutes ? usd / minutes : null,
    errors: results.reduce((sum, item) => sum + item.score.errors, 0),
  };
}

function check(value, ok, hard) {
  if (value === null) return { status: 'unknown', hard };
  return { status: ok ? 'pass' : 'fail', hard };
}

export function verdict(stats, heartbeat = null) {
  const rows = {
    toolAccuracy: check(stats.toolAccuracy, stats.toolAccuracy >= THRESHOLDS.toolAccuracyMin, true),
    entityHit: check(stats.entityHit, stats.entityHit >= THRESHOLDS.entityHitMin, true),
    wer: check(stats.werMedian, stats.werMedian <= THRESHOLDS.werMedianMax, true),
    latency: check(
      stats.latencyMedianMs,
      stats.latencyMedianMs <= THRESHOLDS.latencyMedianMsMax,
      false,
    ),
    cost: check(
      stats.usdPerActiveMinute,
      stats.usdPerActiveMinute <= THRESHOLDS.usdPerActiveMinuteMax,
      false,
    ),
    hidden: heartbeat
      ? check(true, !heartbeat.connectionLostWhileHidden, true)
      : { status: 'unknown', hard: true },
  };
  const values = Object.values(rows);
  const hardFail = values.some((row) => row.hard && row.status === 'fail');
  const softFail = values.some((row) => !row.hard && row.status === 'fail');
  const unknown = values.some((row) => row.status === 'unknown');
  const overall = hardFail ? 'no-go' : softFail ? 'conditional' : unknown ? 'incomplete' : 'go';
  return { rows, overall };
}

const LABEL = { pass: 'قبول', fail: 'رد', unknown: 'نامعلوم' };
const OVERALL = {
  go: 'برو: همهٔ معیارها قبول است (داوری انسانی بخش آخر هنوز لازم است).',
  conditional: 'مشروط: معیارهای اصلی قبول است ولی تأخیر یا هزینه از حد پیشنهادی بیشتر است.',
  'no-go': 'نرو (برای این مدل): دست‌کم یک معیار اصلی رد شد. آداپتر pipeline را بسنجید.',
  incomplete: 'ناقص: برخی معیارها داده ندارند؛ آن‌ها را اندازه بگیرید.',
};

const pct = (value) => (value === null ? '—' : `${(value * 100).toFixed(0)}٪`);
const usd = (value) => (value === null ? 'بدون قیمت' : `$${value.toFixed(3)}`);
const ms = (value) => (value === null ? '—' : `${Math.round(value)} ms`);

export function renderMarkdown({ meta, results, heartbeat = null, notes = '' }) {
  const stats = aggregate(results, meta);
  const decision = verdict(stats, heartbeat);
  const rows = decision.rows;
  const lines = [];
  lines.push('# گزارش فاز ۰ دستیار صوتی (ADR-0055)', '');
  lines.push(
    `- مدل: \`${meta.model ?? '—'}\` · صدا: \`${meta.voice ?? 'پیش‌فرض'}\` · مدل رونویسی: \`${meta.transcriptionModel ?? '—'}\``,
    `- زمان گفتگوی فعال: ${meta.activeSeconds ? `${Math.round(meta.activeSeconds)} ثانیه` : '—'} · سناریوها: ${stats.scenarios}`,
    `- قیمت‌های واردشده (دلار به‌ازای هر میلیون توکن): ${hasPrices(meta.prices) ? JSON.stringify(meta.prices) : 'داده نشد'}`,
    '',
    `## نتیجه: ${OVERALL[decision.overall]}`,
    '',
    '| معیار | مقدار | حد پیشنهادی | وضعیت |',
    '| --- | --- | --- | --- |',
    `| صدا زدن ابزار درست با آرگومان درست | ${pct(stats.toolAccuracy)} | ≥ ${pct(THRESHOLDS.toolAccuracyMin)} | ${LABEL[rows.toolAccuracy.status]} |`,
    `| نام/عدد/تاریخ درست شنیده‌شده | ${pct(stats.entityHit)} | ≥ ${pct(THRESHOLDS.entityHitMin)} | ${LABEL[rows.entityHit.status]} |`,
    `| میانهٔ خطای واژه (رونویسی) | ${pct(stats.werMedian)} | ≤ ${pct(THRESHOLDS.werMedianMax)} | ${LABEL[rows.wer.status]} |`,
    `| میانهٔ تأخیر تا اولین صدا | ${ms(stats.latencyMedianMs)} | ≤ ${THRESHOLDS.latencyMedianMsMax} ms | ${LABEL[rows.latency.status]} |`,
    `| هزینهٔ هر دقیقهٔ فعال (کران بالا) | ${stats.usdPerActiveMinute === null ? 'بدون قیمت' : `$${stats.usdPerActiveMinute.toFixed(3)}`} | ≤ $${THRESHOLDS.usdPerActiveMinuteMax} | ${LABEL[rows.cost.status]} |`,
    `| اتصال در زمان پنهان‌بودن مرورگر | ${heartbeat ? (heartbeat.connectionLostWhileHidden ? 'قطع شد' : 'ماند') : '—'} | نباید قطع شود | ${LABEL[rows.hidden.status]} |`,
    '',
  );
  if (stats.noToolAccuracy !== null) {
    lines.push(
      `- موارد «نباید ابزار صدا بزند» (مبهم/راز/خارج از دامنه): ${pct(stats.noToolAccuracy)} درست.`,
    );
  }
  if (stats.sttMissing > 0) {
    lines.push(
      `- در ${stats.sttMissing} سناریو رونویسی ورودی نیامد (مدل رونویسی تنظیم نشده یا رویداد نرسید)؛ خطای واژه و نام/عدد آن‌ها سنجیده نشد.`,
    );
  }
  lines.push(
    `- توکن‌ها: ورودی ${stats.totals.inputTokens}، خروجی ${stats.totals.outputTokens}، کل ${stats.totals.totalTokens} (صوتی ورودی ${stats.totals.audioIn}، صوتی خروجی ${stats.totals.audioOut}، کش‌شده ${stats.totals.cachedIn}). هزینهٔ کل: ${usd(stats.usd)}.`,
    `- خطای سرویس‌دهنده: ${stats.errors}.`,
    '',
    '## جزئیات سناریوها',
    '',
    '| سناریو | شنیده‌شده | ابزار | آرگومان‌ها | تأخیر | توکن |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const { scenario, score } of results) {
    const tool = score.tool
      ? `${score.tool.ok ? 'درست' : 'نادرست'} (${score.tool.calledName ?? 'صدا نزد'})`
      : score.noToolOk === null
        ? '—'
        : score.noToolOk
          ? 'درست (صدا نزد)'
          : 'نادرست (صدا زد)';
    const args = score.tool
      ? score.tool.args
          .map((arg) => `${arg.key}: ${arg.ok ? 'ok' : `✗ ←${JSON.stringify(arg.got)}`}`)
          .join('، ')
      : '—';
    const heard = (score.heard || '—').replace(/\|/gu, '/').slice(0, 80);
    lines.push(
      `| ${scenario.id} | ${heard} | ${tool} | ${args || '—'} | ${ms(score.latencyMs)} | ${score.totals.totalTokens} |`,
    );
  }
  if (heartbeat) {
    lines.push(
      '',
      '## مرورگر کوچک‌شده',
      '',
      `- مدت پنهان‌بودن: ${heartbeat.hiddenSeconds} ثانیه در ${heartbeat.windows} بازه؛ بزرگ‌ترین فاصلهٔ ضربان در حالت پنهان: ${heartbeat.maxHiddenGapMs} ms (حد عادی ۱۰۰۰)؛ فاصلهٔ بلند: ${heartbeat.longHiddenGaps}.`,
      `- رویدادهای سرویس‌دهنده در حالت پنهان: ${heartbeat.eventsWhileHidden}؛ اتصال در حالت پنهان قطع شد؟ ${heartbeat.connectionLostWhileHidden ? 'بله' : 'خیر'}.`,
    );
  }
  lines.push(
    '',
    '## داوری انسانی (پس از شنیدن گفتگو، خودتان پر کنید)',
    '',
    '- [ ] صدا و لحن فارسی قابل‌قبول است؟',
    '- [ ] وسط حرف قطع کردن (barge-in) درست کار کرد؟',
    '- [ ] دستیار بدون تأیید چیزی را «انجام‌شده» اعلام نکرد؟',
    '- [ ] مصرف داشبورد OpenAI برای ۱۰ دقیقهٔ بی‌حرف (اتصال باز) نزدیک صفر بود؟ عدد: ______',
    '',
    notes ? `## یادداشت\n\n${notes}\n` : '',
  );
  return lines.join('\n');
}
