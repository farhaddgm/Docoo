/**
 * آزمون «مرورگر کوچک‌شده» (HUG-006): یک ضربان هر ثانیه ثبت می‌شود. اگر مرورگر تب پنهان را کند
 * کند، فاصلهٔ ضربان‌ها از بازهٔ مورد انتظار بزرگ‌تر می‌شود. این خلاصه می‌گوید در زمان پنهان بودن
 * چه اتفاقی افتاد، تا بدانیم اتصال زنده با وجود پنهان بودن سالم ماند یا نه.
 *
 * نمونه: { t (میلی‌ثانیه)، hidden (بولی) }؛ رویداد: { t، kind: 'connection' | 'event'، state? }
 */

export function summarizeHeartbeat(samples, events = [], { intervalMs = 1000 } = {}) {
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  let hiddenMs = 0;
  let maxHiddenGapMs = 0;
  let longHiddenGaps = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const current = ordered[index];
    const previous = ordered[index - 1];
    if (!current.hidden || !previous.hidden) continue;
    const gap = current.t - previous.t;
    hiddenMs += gap;
    maxHiddenGapMs = Math.max(maxHiddenGapMs, gap);
    if (gap > intervalMs * 3) longHiddenGaps += 1;
  }

  const hiddenWindows = [];
  let start = null;
  for (const sample of ordered) {
    if (sample.hidden && start === null) start = sample.t;
    if (!sample.hidden && start !== null) {
      hiddenWindows.push([start, sample.t]);
      start = null;
    }
  }
  if (start !== null && ordered.length > 0) hiddenWindows.push([start, ordered.at(-1).t]);

  const during = (event) => hiddenWindows.some(([from, to]) => event.t >= from && event.t <= to);
  const eventsHidden = events.filter((event) => event.kind === 'event' && during(event)).length;
  const lostWhileHidden = events.some(
    (event) =>
      event.kind === 'connection' &&
      ['failed', 'disconnected', 'closed'].includes(event.state) &&
      during(event),
  );

  return {
    hiddenSeconds: Math.round(hiddenMs / 1000),
    maxHiddenGapMs,
    longHiddenGaps,
    eventsWhileHidden: eventsHidden,
    connectionLostWhileHidden: lostWhileHidden,
    windows: hiddenWindows.length,
  };
}
