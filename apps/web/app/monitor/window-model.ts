import { stoppedSince, type MonitorControlState } from './control';

/**
 * What a monitor window shows right now (ADR-0056 §5-1, §5-4). The choice is a pure function of
 * what the window knows, so each case can be tested without a browser.
 */
export type WindowView =
  | 'loading'
  | 'guest'
  | 'owner_only'
  | 'unavailable'
  | 'off'
  | 'stopped'
  | 'expired'
  | 'blackout'
  | 'ready';

export type WindowLoad = 'loading' | 'guest' | 'denied' | 'unavailable' | 'ready';

export interface WindowInput {
  readonly load: WindowLoad;
  /** Whether this kind of monitor is switched on in the settings. */
  readonly enabled: boolean;
  readonly control: MonitorControlState;
  readonly openedAt: number;
  readonly now: number;
  readonly maxPlayHours: number;
}

export function windowView(input: WindowInput): WindowView {
  switch (input.load) {
    case 'loading':
      return 'loading';
    case 'guest':
      return 'guest';
    case 'denied':
      return 'owner_only';
    case 'unavailable':
      return 'unavailable';
    case 'ready':
      break;
  }
  // The owner's stop and the time limit come before everything: a window that should be gone shows
  // nothing of the work, even if a setting is read late.
  if (stoppedSince(input.control, input.openedAt)) return 'stopped';
  if (input.now - input.openedAt >= input.maxPlayHours * 3_600_000) return 'expired';
  if (!input.enabled) return 'off';
  if (input.control.blackout) return 'blackout';
  return 'ready';
}

/** A window that has nothing more to say closes itself when the browser allows it. */
export const shouldCloseWindow = (view: WindowView): boolean =>
  view === 'stopped' || view === 'expired';

/** The faint mark on the screen: nothing, the workspace name, or the name with the time. */
export function watermarkText(mode: string, workspaceName: string, time: string): string {
  if (mode === 'name') return workspaceName;
  if (mode === 'name_time') return `${workspaceName} · ${time}`;
  return '';
}
