import type { LiveActionView } from '@docoo/contracts';

import type { ActionTiming } from './state';

/**
 * What the confirmation card shows and what a spoken "yes" applies to (ADR-0055 §4-5, §4-6),
 * with no React and no server in it so it can be tested on its own.
 */

export const isOpen = (view: LiveActionView): boolean =>
  view.status === 'proposed' || view.status === 'first_confirmed';

/**
 * Seconds left to confirm, counted on this browser's own clock from when the proposal arrived,
 * using only the length of the window the server gave (its expiry minus its proposal time). The
 * two clocks are never compared, so a browser whose clock is wrong still shows the right time. The
 * server's own clock decides in the end. Anything unreadable counts as no time left.
 */
export function secondsLeft(view: LiveActionView, receivedAtMs: number, nowMs: number): number {
  const total = (Date.parse(view.expiresAt) - Date.parse(view.proposedAt)) / 1000;
  if (!Number.isFinite(total)) return 0;
  const used = Math.max(0, (nowMs - receivedAtMs) / 1000);
  return Math.max(0, Math.ceil(total - used));
}

/** Still waiting for a person, and still inside its time. Oldest first. */
export function waitingActions(
  actions: readonly LiveActionView[],
  remaining: (view: LiveActionView) => number,
): LiveActionView[] {
  return actions
    .filter((view) => isOpen(view) && remaining(view) > 0)
    .sort((a, b) => a.proposedAt.localeCompare(b.proposedAt));
}

/** Waiting changes whose time is over on this clock; the server closes them when looked at. */
export function overdueActions(
  actions: readonly LiveActionView[],
  remaining: (view: LiveActionView) => number,
): LiveActionView[] {
  return actions.filter((view) => isOpen(view) && remaining(view) === 0);
}

export type StepKey = 'preview' | 'readback' | 'confirm' | 'echo';
export type StepState = 'done' | 'current' | 'todo';

const STEP_OF: Record<string, StepKey> = {
  preview: 'preview',
  readback: 'readback',
  voice_or_click: 'confirm',
  target_echo_or_click: 'echo',
};

/**
 * The steps of one change, as the server planned them for its risk, with where it stands: the
 * preview and its read-back are on the screen already, the confirmation is the current step until
 * given, and an irreversible change then asks for the name of the thing itself.
 */
export function stepsOf(view: LiveActionView): { key: StepKey; state: StepState }[] {
  const keys = view.steps.flatMap((step) => (STEP_OF[step] ? [STEP_OF[step]] : []));
  return keys.map((key) => {
    if (key === 'preview' || key === 'readback') return { key, state: 'done' as const };
    if (key === 'confirm') {
      return { key, state: view.status === 'proposed' ? ('current' as const) : ('done' as const) };
    }
    return {
      key,
      state: view.status === 'first_confirmed' ? ('current' as const) : ('todo' as const),
    };
  });
}

/**
 * The simple changes that can be confirmed together, with one answer (the owner's decision: one
 * confirmation for a plan of simple changes, a separate one for each that costs or cannot be
 * undone). Only reversible changes (T1) that have not been confirmed at all.
 */
export function groupable(waiting: readonly LiveActionView[]): LiveActionView[] {
  const simple = waiting.filter((view) => view.tier === 'T1' && view.status === 'proposed');
  return simple.length >= 2 ? simple : [];
}

/**
 * What a spoken answer applies to. When everything waiting is a simple change, one "yes" confirms
 * them all, as the card offers; otherwise it applies to the oldest one only, so an expensive or
 * irreversible change always gets an answer of its own.
 */
export function voiceTargets(waiting: readonly LiveActionView[]): LiveActionView[] {
  const first = waiting[0];
  if (!first) return [];
  const allSimple = waiting.every((view) => view.tier === 'T1' && view.status === 'proposed');
  return allSimple ? [...waiting] : [first];
}

/** Seconds left of a change, from the timing the state recorded when it arrived. */
export function remainingFor(
  timing: Readonly<Record<string, ActionTiming>>,
  view: LiveActionView,
  nowMs: number,
): number {
  return secondsLeft(view, timing[view.id]?.firstAt ?? nowMs, nowMs);
}

/** How long a finished change stays on the card, so the owner sees what became of it. */
export const RESULT_VISIBLE_MS = 8000;

/** Changes that finished a moment ago, newest first, at most three. */
export function recentResults(
  actions: readonly LiveActionView[],
  timing: Readonly<Record<string, ActionTiming>>,
  nowMs: number,
): LiveActionView[] {
  return actions
    .filter((view) => {
      const settled = timing[view.id]?.settledAt;
      return !isOpen(view) && settled != null && nowMs - settled < RESULT_VISIBLE_MS;
    })
    .sort((a, b) => (timing[b.id]?.settledAt ?? 0) - (timing[a.id]?.settledAt ?? 0))
    .slice(0, 3);
}
