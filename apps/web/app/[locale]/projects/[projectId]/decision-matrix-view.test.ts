import { describe, expect, it } from 'vitest';
import { agreementLevel, initialOrder, moveKey, sharePercent } from './decision-matrix-view';

describe('decision matrix view helpers', () => {
  it('moves a criterion one place and stops at the ends without mutating', () => {
    const order = ['a', 'b', 'c'];
    expect(moveKey(order, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveKey(order, 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moveKey(order, 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveKey(order, 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveKey(order, 'x', 1)).toEqual(['a', 'b', 'c']);
    expect(order).toEqual(['a', 'b', 'c']);
  });
  it('starts from the enabled criteria, heaviest first', () => {
    expect(
      initialOrder([
        { key: 'cost', label: 'Cost', weight: 20, enabled: true },
        { key: 'risk', label: 'Risk', weight: 90, enabled: false },
        { key: 'impact', label: 'Impact', weight: 50, enabled: true },
        { key: 'time', label: 'Time', weight: 20, enabled: true },
      ]),
    ).toEqual(['impact', 'cost', 'time']);
  });
  it('never shows a sampled share as certain or impossible by rounding alone', () => {
    expect(sharePercent(0.999)).toBe(99);
    expect(sharePercent(0.001)).toBe(1);
    expect(sharePercent(1)).toBe(100);
    expect(sharePercent(0)).toBe(0);
    expect(sharePercent(0.714)).toBe(71);
  });
  it('reads the agreement of the two methods', () => {
    expect(agreementLevel(0.9, true)).toBe('agree');
    expect(agreementLevel(0.2, true)).toBe('differ');
    expect(agreementLevel(1, false)).toBe('split');
  });
});
