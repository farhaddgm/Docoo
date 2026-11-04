import type { LiveActionView } from '@docoo/contracts';
import { describe, expect, it } from 'vitest';

import {
  groupable,
  overdueActions,
  recentResults,
  remainingFor,
  secondsLeft,
  stepsOf,
  voiceTargets,
  waitingActions,
} from './confirmation-model';

let counter = 0;
const view = (over: Partial<LiveActionView> = {}): LiveActionView => {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    sessionId: '11111111-1111-4111-8111-111111111111',
    capability: 'project.pause',
    projectId: null,
    tier: 'T1',
    steps: ['preview', 'voice_or_click'],
    status: 'proposed',
    summary: 'Pause it',
    targetName: null,
    refusalReason: null,
    cancelReason: null,
    result: null,
    errorCode: null,
    proposedAt: `2026-11-04T10:00:${String(counter).padStart(2, '0')}.000000Z`,
    expiresAt: `2026-11-04T10:05:${String(counter).padStart(2, '0')}.000000Z`,
    firstConfirmedAt: null,
    confirmedAt: null,
    finishedAt: null,
    nextStep: 'confirm',
    ...over,
  };
};
const T2 = ['preview', 'readback', 'voice_or_click'];
const T3 = ['preview', 'readback', 'voice_or_click', 'target_echo_or_click'];

describe('the steps of a change', () => {
  it('follow the risk the server planned, with the confirmation as the current step', () => {
    expect(stepsOf(view())).toEqual([
      { key: 'preview', state: 'done' },
      { key: 'confirm', state: 'current' },
    ]);
    expect(stepsOf(view({ tier: 'T2', steps: T2 })).map((step) => step.key)).toEqual([
      'preview',
      'readback',
      'confirm',
    ]);
    expect(stepsOf(view({ tier: 'T3', steps: T3 })).map((step) => [step.key, step.state])).toEqual([
      ['preview', 'done'],
      ['readback', 'done'],
      ['confirm', 'current'],
      ['echo', 'todo'],
    ]);
  });

  it('move on to the name of the thing once an irreversible change was confirmed the first time', () => {
    const second = stepsOf(view({ tier: 'T3', steps: T3, status: 'first_confirmed' }));
    expect(second.map((step) => [step.key, step.state])).toEqual([
      ['preview', 'done'],
      ['readback', 'done'],
      ['confirm', 'done'],
      ['echo', 'current'],
    ]);
  });

  it('skip a step it does not know rather than invent one', () => {
    expect(
      stepsOf(view({ steps: ['preview', 'mystery', 'voice_or_click'] })).map((s) => s.key),
    ).toEqual(['preview', 'confirm']);
    expect(stepsOf(view({ steps: [] }))).toEqual([]);
  });
});

describe('the time left', () => {
  const sample = view({
    proposedAt: '2026-11-04T10:00:00.000000Z',
    expiresAt: '2026-11-04T10:05:00.000000Z',
  });

  it('is the length of the window the server gave, counted from when it arrived on this clock', () => {
    expect(secondsLeft(sample, 1_000_000, 1_000_000)).toBe(300);
    expect(secondsLeft(sample, 1_000_000, 1_000_000 + 61_500)).toBe(239);
    expect(secondsLeft(sample, 1_000_000, 1_000_000 + 300_000)).toBe(0);
    expect(secondsLeft(sample, 1_000_000, 1_000_000 + 9_000_000)).toBe(0);
  });

  it('does not care what the date on this computer is', () => {
    // A clock a year behind or ahead gives the same answer: only differences on it are used.
    for (const base of [0, 1_700_000_000_000, 4_000_000_000_000]) {
      expect(secondsLeft(sample, base, base + 100_000)).toBe(200);
    }
  });

  it('never goes negative, and an unreadable time counts as none', () => {
    expect(secondsLeft(sample, 5_000, 1_000)).toBe(300);
    expect(secondsLeft(view({ expiresAt: 'not a date' }), 0, 0)).toBe(0);
    expect(secondsLeft(view({ proposedAt: '' }), 0, 0)).toBe(0);
  });

  it('is read from the timing the state kept, or counted from now when none was kept', () => {
    expect(remainingFor({ [sample.id]: { firstAt: 0, settledAt: null } }, sample, 100_000)).toBe(
      200,
    );
    expect(remainingFor({}, sample, 100_000)).toBe(300);
  });
});

describe('what is waiting', () => {
  const remainingOf = (seconds: Record<string, number>) => (v: LiveActionView) =>
    seconds[v.id] ?? 0;

  it('is the open changes with time left, oldest first, and no finished or overdue one', () => {
    const first = view();
    const second = view();
    const done = view({ status: 'executed' });
    const late = view();
    const remaining = remainingOf({ [first.id]: 10, [second.id]: 20, [done.id]: 99, [late.id]: 0 });
    expect(waitingActions([second, done, late, first], remaining).map((v) => v.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(overdueActions([second, done, late, first], remaining).map((v) => v.id)).toEqual([
      late.id,
    ]);
  });

  it('keeps a change that was confirmed once and waits for the second', () => {
    const half = view({ tier: 'T3', steps: T3, status: 'first_confirmed' });
    expect(waitingActions([half], () => 5)).toEqual([half]);
  });
});

describe('simple changes together', () => {
  it('are offered as a group from two reversible, unconfirmed changes on', () => {
    const a = view();
    const b = view();
    expect(groupable([a])).toEqual([]);
    expect(groupable([a, b])).toEqual([a, b]);
  });

  it('leave out whatever costs or cannot be undone, or was already confirmed once', () => {
    const a = view();
    const b = view();
    const costly = view({ tier: 'T2', steps: T2 });
    const half = view({ tier: 'T3', steps: T3, status: 'first_confirmed' });
    expect(groupable([a, costly, half])).toEqual([]);
    expect(groupable([a, b, costly, half])).toEqual([a, b]);
  });
});

describe('what a spoken answer applies to', () => {
  it('is nothing when nothing waits', () => {
    expect(voiceTargets([])).toEqual([]);
  });

  it('is every change when they are all simple, as one answer to a plan', () => {
    const a = view();
    const b = view();
    expect(voiceTargets([a, b])).toEqual([a, b]);
    expect(voiceTargets([a])).toEqual([a]);
  });

  it('is the oldest one alone as soon as a costly or irreversible change waits among them', () => {
    const a = view();
    const costly = view({ tier: 'T2', steps: T2 });
    const irreversible = view({ tier: 'T3', steps: T3 });
    expect(voiceTargets([a, costly])).toEqual([a]);
    expect(voiceTargets([costly, a])).toEqual([costly]);
    expect(voiceTargets([irreversible, a])).toEqual([irreversible]);
  });

  it('is the one change waiting for its second confirmation, alone', () => {
    const half = view({ tier: 'T3', steps: T3, status: 'first_confirmed' });
    const b = view();
    expect(voiceTargets([half, b])).toEqual([half]);
    expect(voiceTargets([half])).toEqual([half]);
  });
});

describe('what just finished', () => {
  it('stays visible for a few seconds, newest first, at most three', () => {
    const a = view({ status: 'executed' });
    const b = view({ status: 'failed' });
    const c = view({ status: 'cancelled' });
    const d = view({ status: 'expired' });
    const open = view();
    const old = view({ status: 'executed' });
    const timing = {
      [a.id]: { firstAt: 0, settledAt: 1_000 },
      [b.id]: { firstAt: 0, settledAt: 2_000 },
      [c.id]: { firstAt: 0, settledAt: 3_000 },
      [d.id]: { firstAt: 0, settledAt: 4_000 },
      [open.id]: { firstAt: 0, settledAt: null },
      [old.id]: { firstAt: 0, settledAt: -20_000 },
    };
    expect(recentResults([a, b, c, d, open, old], timing, 5_000).map((v) => v.id)).toEqual([
      d.id,
      c.id,
      b.id,
    ]);
    expect(recentResults([a], timing, 20_000)).toEqual([]);
  });
});
