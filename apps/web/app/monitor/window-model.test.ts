import { describe, expect, it } from 'vitest';

import { initialControl } from './control';
import { shouldCloseWindow, watermarkText, windowView, type WindowInput } from './window-model';

const HOUR = 3_600_000;
const base: WindowInput = {
  load: 'ready',
  enabled: true,
  control: initialControl,
  openedAt: 1_000_000,
  now: 1_000_000 + 1000,
  maxPlayHours: 8,
};

describe('what a monitor window shows', () => {
  it('shows its content when it is on and nothing stops it', () => {
    expect(windowView(base)).toBe('ready');
  });

  it('waits, or says why it cannot show anything, before it knows the settings', () => {
    expect(windowView({ ...base, load: 'loading' })).toBe('loading');
    expect(windowView({ ...base, load: 'guest' })).toBe('guest');
    expect(windowView({ ...base, load: 'denied' })).toBe('owner_only');
    expect(windowView({ ...base, load: 'unavailable' })).toBe('unavailable');
  });

  it('shows nothing of the work while the monitor is switched off', () => {
    expect(windowView({ ...base, enabled: false })).toBe('off');
  });

  it('goes black on the owner blackout and comes back on resume', () => {
    expect(windowView({ ...base, control: { blackout: true, stopAt: 0 } })).toBe('blackout');
    expect(windowView({ ...base, control: { blackout: false, stopAt: 0 } })).toBe('ready');
  });

  it('is stopped when the owner stopped the broadcast after it was opened', () => {
    const stopped = { blackout: false, stopAt: base.openedAt + 10 };
    expect(windowView({ ...base, control: stopped })).toBe('stopped');
    // A window opened after the stop is a new broadcast.
    expect(windowView({ ...base, control: { blackout: false, stopAt: base.openedAt - 10 } })).toBe(
      'ready',
    );
  });

  it('expires after the hours the settings allow', () => {
    expect(windowView({ ...base, now: base.openedAt + 8 * HOUR - 1 })).toBe('ready');
    expect(windowView({ ...base, now: base.openedAt + 8 * HOUR })).toBe('expired');
    expect(windowView({ ...base, maxPlayHours: 1, now: base.openedAt + HOUR })).toBe('expired');
  });

  it('puts the stop and the time limit before everything else, even a black screen or a switch off', () => {
    const stopped = { blackout: true, stopAt: base.openedAt + 1 };
    expect(windowView({ ...base, enabled: false, control: stopped })).toBe('stopped');
    expect(
      windowView({
        ...base,
        enabled: false,
        control: { blackout: true, stopAt: 0 },
        now: base.openedAt + 9 * HOUR,
      }),
    ).toBe('expired');
  });

  it('closes itself only when stopped or expired', () => {
    expect(shouldCloseWindow('stopped')).toBe(true);
    expect(shouldCloseWindow('expired')).toBe(true);
    for (const view of [
      'loading',
      'guest',
      'owner_only',
      'unavailable',
      'off',
      'blackout',
      'ready',
    ] as const) {
      expect(shouldCloseWindow(view), view).toBe(false);
    }
  });
});

describe('the faint mark', () => {
  it('is the workspace name, with the time, or nothing', () => {
    expect(watermarkText('name', 'Docoo', '10:30')).toBe('Docoo');
    expect(watermarkText('name_time', 'Docoo', '10:30')).toBe('Docoo · 10:30');
    expect(watermarkText('none', 'Docoo', '10:30')).toBe('');
    expect(watermarkText('anything else', 'Docoo', '10:30')).toBe('');
  });
});
