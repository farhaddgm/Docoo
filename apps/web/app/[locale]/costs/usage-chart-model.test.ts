import { describe, expect, it } from 'vitest';

import {
  CHART,
  colourSlot,
  dayTickIndexes,
  linePath,
  nearestIndex,
  niceTicks,
  shortDay,
  visibleLines,
  xAt,
  yAt,
} from './usage-chart-model';

describe('niceTicks', () => {
  it('rounds the top up to a clean number with even steps from zero', () => {
    expect(niceTicks(870)).toEqual({ top: 1000, ticks: [0, 250, 500, 750, 1000] });
    expect(niceTicks(12_300)).toEqual({ top: 15_000, ticks: [0, 5000, 10_000, 15_000] });
  });
  it('still draws an axis when nothing was used', () => {
    expect(niceTicks(0)).toEqual({ top: 1, ticks: [0, 1] });
  });
});

describe('scales and paths', () => {
  it('puts the first day at the left edge, the last at the right, zero on the baseline', () => {
    expect(xAt(0, 10)).toBe(CHART.left);
    expect(xAt(9, 10)).toBe(CHART.width - CHART.right);
    expect(yAt(0, 100)).toBe(CHART.height - CHART.bottom);
    expect(yAt(100, 100)).toBe(CHART.top);
  });
  it('centres a single day instead of dividing by zero', () => {
    expect(Number.isFinite(xAt(0, 1))).toBe(true);
  });
  it('draws one segment per day', () => {
    expect(linePath([0, 5, 10], 10).split('L')).toHaveLength(3);
  });
  it('finds the nearest day and stays inside the plot', () => {
    expect(nearestIndex(-50, 30)).toBe(0);
    expect(nearestIndex(5000, 30)).toBe(29);
    expect(nearestIndex(xAt(10, 30), 30)).toBe(10);
  });
  it('picks a few x labels including both ends', () => {
    expect(dayTickIndexes(30)).toEqual([0, 7, 15, 22, 29]);
    expect(dayTickIndexes(3)).toEqual([0, 1, 2]);
  });
  it('shortens a day to month/day', () => {
    expect(shortDay('2026-11-14')).toBe('11/14');
  });
});

describe('series', () => {
  it('leaves out a source with no tokens but keeps one line when everything is empty', () => {
    const used = { key: 'stage', points: [0, 3] };
    const idle = { key: 'brain', points: [0, 0] };
    expect(visibleLines([used, idle])).toEqual([used]);
    expect(visibleLines([idle])).toEqual([idle]);
  });
  it('colours a source by what it is, not by how many lines are shown', () => {
    expect(colourSlot('stage')).toBe(1);
    expect(colourSlot('assistant')).toBe(2);
    expect(colourSlot('other')).toBe(5);
    expect(colourSlot('all')).toBe(1);
  });
});
