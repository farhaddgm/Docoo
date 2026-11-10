import { describe, expect, it } from 'vitest';

import {
  initialControl,
  parseControl,
  reduceControl,
  stoppedSince,
  type MonitorControlState,
} from './control';

describe('monitor controls', () => {
  it('start quiet: no blackout and never stopped', () => {
    expect(initialControl).toEqual({ blackout: false, stopAt: 0 });
    expect(stoppedSince(initialControl, 0)).toBe(false);
    expect(stoppedSince(initialControl, 123)).toBe(false);
  });

  it('black the screens out and bring them back', () => {
    const black = reduceControl(initialControl, 'blackout', 10);
    expect(black.blackout).toBe(true);
    expect(reduceControl(black, 'resume', 20).blackout).toBe(false);
  });

  it('stop closes the windows opened before the stop, and only those', () => {
    const stopped = reduceControl(initialControl, 'stop', 1000);
    expect(stoppedSince(stopped, 999)).toBe(true);
    expect(stoppedSince(stopped, 1000)).toBe(true);
    expect(stoppedSince(stopped, 1001)).toBe(false);
  });

  it('start again from a clean page after a stop, not from a black one', () => {
    const black: MonitorControlState = { blackout: true, stopAt: 0 };
    expect(reduceControl(black, 'stop', 5)).toEqual({ blackout: false, stopAt: 5 });
  });

  it('keep an earlier stop when the owner then blacks out or resumes', () => {
    const stopped = reduceControl(initialControl, 'stop', 50);
    expect(reduceControl(stopped, 'blackout', 60).stopAt).toBe(50);
    expect(reduceControl(stopped, 'resume', 60).stopAt).toBe(50);
  });
});

describe('reading the stored state', () => {
  it('reads what was written', () => {
    expect(parseControl(JSON.stringify({ blackout: true, stopAt: 7 }))).toEqual({
      blackout: true,
      stopAt: 7,
    });
  });

  it('takes the quiet state for anything unusable', () => {
    expect(parseControl(null)).toEqual(initialControl);
    expect(parseControl('')).toEqual(initialControl);
    expect(parseControl('{not json')).toEqual(initialControl);
    expect(parseControl('"text"')).toEqual(initialControl);
    expect(parseControl(JSON.stringify({ blackout: 'yes', stopAt: 'soon' }))).toEqual(
      initialControl,
    );
    expect(parseControl(JSON.stringify({ stopAt: -5 }))).toEqual(initialControl);
  });
});
