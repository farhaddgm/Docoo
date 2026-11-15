/** The pure parts of the usage chart: scales, ticks and paths. No React, so they are testable. */

/** Where a model call came from; the order fixes each source's colour slot. */
export const USAGE_SOURCES = ['stage', 'assistant', 'brain', 'smart', 'other'] as const;
export type UsageSource = (typeof USAGE_SOURCES)[number];

export interface UsageSeriesLine {
  readonly key: string;
  readonly points: readonly number[];
}

export const CHART = { width: 720, height: 260, left: 52, right: 16, top: 12, bottom: 28 } as const;

/** A round axis maximum and evenly spaced ticks from 0 up to it (1, 2, 2.5 or 5 times a power of ten). */
export function niceTicks(max: number, count = 4): { top: number; ticks: number[] } {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= rough) ?? 10) * power;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top + step / 2; value += step)
    ticks.push(Math.round(value * 1e6) / 1e6);
  return { top, ticks };
}

export function xAt(index: number, length: number): number {
  const span = CHART.width - CHART.left - CHART.right;
  return CHART.left + (length <= 1 ? span / 2 : (index / (length - 1)) * span);
}

export function yAt(value: number, top: number): number {
  const span = CHART.height - CHART.top - CHART.bottom;
  return CHART.top + span - (value / top) * span;
}

/** An SVG path through the points, one straight segment per day. */
export function linePath(points: readonly number[], top: number): string {
  return points
    .map(
      (value, index) =>
        `${index === 0 ? 'M' : 'L'}${xAt(index, points.length).toFixed(1)} ${yAt(value, top).toFixed(1)}`,
    )
    .join(' ');
}

/** The day closest to a horizontal position (in chart units), clamped to the plot. */
export function nearestIndex(x: number, length: number): number {
  if (length <= 1) return 0;
  const span = CHART.width - CHART.left - CHART.right;
  const ratio = (x - CHART.left) / span;
  return Math.min(length - 1, Math.max(0, Math.round(ratio * (length - 1))));
}

/** Indexes of about `count` evenly spaced days for the x axis, always including the first and last. */
export function dayTickIndexes(length: number, count = 5): number[] {
  if (length <= count) return Array.from({ length }, (_, index) => index);
  const last = length - 1;
  return Array.from({ length: count }, (_, index) => Math.round((index / (count - 1)) * last));
}

/** `2026-11-14` as the day and month only (the year is clear from the period). */
export function shortDay(day: string): string {
  return day.slice(5).replace('-', '/');
}

/** The lines worth drawing: a source with no tokens in the period is left out, not drawn flat. */
export function visibleLines(series: readonly UsageSeriesLine[]): UsageSeriesLine[] {
  const used = series.filter((line) => line.points.some((value) => value > 0));
  return used.length > 0 ? used : series.slice(0, 1);
}

/** The colour slot (1-5) of a line: by the source it shows, never by how many lines there are. */
export function colourSlot(key: string): number {
  const index = USAGE_SOURCES.indexOf(key as UsageSource);
  return index === -1 ? 1 : index + 1;
}
