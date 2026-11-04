/**
 * State of the live voice assistant in this browser (ADR-0055 §4-7, §4-11). One reducer owns every
 * legal move, so the floating pill, the Smart tab and the transport can never disagree.
 *
 * Only the pill position survives a reload: a live connection cannot, so a new page always
 * starts switched off.
 */

import type { LiveActionView } from '@docoo/contracts';

export type LiveStatus = 'off' | 'starting' | 'awake' | 'asleep' | 'closing' | 'error';

export type LiveError =
  | 'unavailable'
  | 'other_tab'
  | 'start_failed'
  | 'connection_lost'
  /** The server ended the session because a cost or time cap was reached. */
  | 'cap_reached'
  /** The owner switched the assistant off in the settings, or it is not ready to start. */
  | 'switched_off';

export interface PillPosition {
  readonly x: number;
  readonly y: number;
}

/** Why the last confirmation of a change did not count; the card says what to do about it. */
export type ConfirmHintReason =
  | 'unclear'
  | 'echo_mismatch'
  | 'too_soon'
  /** The change is no longer waiting (time ran out, it was cancelled): the card shows its new state. */
  | 'closed'
  | 'failed';

export interface ConfirmHint {
  readonly actionId: string;
  readonly reason: ConfirmHintReason;
}

/** The most proposals kept on screen; the oldest finished ones go first. */
export const MAX_ACTIONS = 30;

/** When this tab first saw a change and when it saw it finish, on this browser's own clock. */
export interface ActionTiming {
  readonly firstAt: number;
  readonly settledAt: number | null;
}

/** How the owner talks to the assistant in this session: by voice, or by typing. */
export type LiveChannel = 'voice' | 'text';

/** One line of a typed conversation, kept in this tab while the session runs. */
export interface ChatLine {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  /** A line the page wrote because the request failed, not something the assistant said. */
  readonly failed?: boolean;
}

/** The most chat lines kept on screen. */
export const MAX_CHAT_LINES = 60;

export interface LiveState {
  readonly channel: LiveChannel;
  /** Typed conversation of this session, oldest first. */
  readonly chat: readonly ChatLine[];
  /** A typed request is being answered. */
  readonly asking: boolean;
  readonly status: LiveStatus;
  /** Whether a way to talk to the provider is set up. Without one the feature stays switched off. */
  readonly available: boolean;
  /** Tokens used by the current (or, when off, the last) session, voice and executor together. */
  readonly tokens: number;
  readonly startedAt: number | null;
  readonly error: LiveError | null;
  /** The server says a cost or time cap is close (80% or more); the session is still running. */
  readonly warning: boolean;
  /** The server-side session this tab runs, while it runs. */
  readonly sessionId: string | null;
  /** The changes the assistant proposed in this session, oldest first, and where each stands. */
  readonly actions: readonly LiveActionView[];
  readonly timing: Readonly<Record<string, ActionTiming>>;
  readonly hint: ConfirmHint | null;
  readonly position: PillPosition | null;
}

export type LiveAction =
  | { readonly type: 'availability'; readonly available: boolean }
  | { readonly type: 'start'; readonly channel?: LiveChannel }
  | { readonly type: 'chat'; readonly line: ChatLine }
  | { readonly type: 'asking'; readonly on: boolean }
  | { readonly type: 'started'; readonly now: number }
  | { readonly type: 'usage'; readonly tokens: number }
  | { readonly type: 'sleep' }
  | { readonly type: 'wake' }
  | { readonly type: 'stop' }
  | { readonly type: 'stopped' }
  | { readonly type: 'failed'; readonly error: LiveError }
  | { readonly type: 'warning'; readonly on: boolean }
  | { readonly type: 'session'; readonly id: string | null }
  | { readonly type: 'action'; readonly view: LiveActionView; readonly at: number }
  | { readonly type: 'hint'; readonly hint: ConfirmHint | null }
  | { readonly type: 'move'; readonly position: PillPosition | null };

export const initialLiveState = (position: PillPosition | null = null): LiveState => ({
  channel: 'voice',
  chat: [],
  asking: false,
  status: 'off',
  available: false,
  tokens: 0,
  startedAt: null,
  error: null,
  warning: false,
  sessionId: null,
  actions: [],
  timing: {},
  hint: null,
  position,
});

const ACTIVE: readonly LiveStatus[] = ['starting', 'awake', 'asleep'];
/** Usage that arrives while closing still belongs to the session (the last answer is billed). */
const BILLABLE: readonly LiveStatus[] = [...ACTIVE, 'closing'];

export const isLiveActive = (status: LiveStatus): boolean => ACTIVE.includes(status);

/**
 * Returns the same object when an action changes nothing, so subscribers are not woken for no
 * reason and a repeated click cannot start a second session.
 */
export function reduceLive(state: LiveState, action: LiveAction): LiveState {
  switch (action.type) {
    case 'availability':
      return state.available === action.available
        ? state
        : { ...state, available: action.available };
    case 'start':
      if (state.status !== 'off' && state.status !== 'error') return state;
      return {
        ...state,
        channel: action.channel ?? 'voice',
        chat: [],
        asking: false,
        status: 'starting',
        tokens: 0,
        startedAt: null,
        error: null,
        warning: false,
        sessionId: null,
        actions: [],
        timing: {},
        hint: null,
      };
    case 'chat':
      return BILLABLE.includes(state.status)
        ? { ...state, chat: [...state.chat, action.line].slice(-MAX_CHAT_LINES) }
        : state;
    case 'asking':
      return state.asking === action.on || !BILLABLE.includes(state.status)
        ? state
        : { ...state, asking: action.on };
    case 'started':
      return state.status === 'starting'
        ? { ...state, status: 'awake', startedAt: action.now }
        : state;
    case 'usage': {
      if (!BILLABLE.includes(state.status)) return state;
      if (!Number.isFinite(action.tokens) || action.tokens <= 0) return state;
      const tokens = Math.min(Number.MAX_SAFE_INTEGER, state.tokens + Math.floor(action.tokens));
      return tokens === state.tokens ? state : { ...state, tokens };
    }
    case 'sleep':
      return state.status === 'awake' ? { ...state, status: 'asleep' } : state;
    case 'wake':
      return state.status === 'asleep' ? { ...state, status: 'awake' } : state;
    case 'stop':
      if (state.status === 'error') return { ...state, status: 'off', error: null };
      return isLiveActive(state.status) ? { ...state, status: 'closing' } : state;
    case 'stopped':
      return state.status === 'closing' || isLiveActive(state.status)
        ? {
            ...state,
            status: 'off',
            startedAt: null,
            warning: false,
            sessionId: null,
            actions: [],
            chat: [],
            asking: false,
            hint: null,
          }
        : state;
    case 'failed':
      return state.status === 'off' || state.status === 'error'
        ? state
        : {
            ...state,
            status: 'error',
            error: action.error,
            startedAt: null,
            warning: false,
            sessionId: null,
            actions: [],
            timing: {},
            chat: [],
            asking: false,
            hint: null,
          };
    case 'warning':
      // Only a running session has a cap to be close to; a stale answer after the end is ignored.
      return isLiveActive(state.status) && state.warning !== action.on
        ? { ...state, warning: action.on }
        : state;
    case 'session':
      return isLiveActive(state.status) && state.sessionId !== action.id
        ? { ...state, sessionId: action.id }
        : state;
    case 'action': {
      // Changes belong to a running (or closing) session; a late answer after the end is dropped.
      if (!BILLABLE.includes(state.status)) return state;
      const open = (view: LiveActionView) =>
        view.status === 'proposed' || view.status === 'first_confirmed';
      const before = state.timing[action.view.id];
      const timing: ActionTiming = {
        firstAt: before?.firstAt ?? action.at,
        settledAt: before?.settledAt ?? (open(action.view) ? null : action.at),
      };
      const at = state.actions.findIndex((item) => item.id === action.view.id);
      if (
        at >= 0 &&
        before?.firstAt === timing.firstAt &&
        before.settledAt === timing.settledAt &&
        JSON.stringify(state.actions[at]) === JSON.stringify(action.view)
      ) {
        return state;
      }
      let actions =
        at >= 0
          ? state.actions.map((item, index) => (index === at ? action.view : item))
          : [...state.actions, action.view].sort((a, b) =>
              a.proposedAt.localeCompare(b.proposedAt),
            );
      // Past the limit the oldest finished ones go; one still waiting for a person never does.
      while (actions.length > MAX_ACTIONS) {
        const drop = actions.findIndex((view) => !open(view));
        if (drop < 0) break;
        actions = actions.filter((_, index) => index !== drop);
      }
      const known = new Set(actions.map((view) => view.id));
      const kept = Object.fromEntries(
        Object.entries({ ...state.timing, [action.view.id]: timing }).filter(([id]) =>
          known.has(id),
        ),
      );
      // A hint belongs to one waiting change: when that change moves, the hint is stale.
      const hint = state.hint && state.hint.actionId === action.view.id ? null : state.hint;
      return { ...state, actions, timing: kept, hint };
    }
    case 'hint':
      if (!isLiveActive(state.status)) return state;
      return JSON.stringify(state.hint) === JSON.stringify(action.hint)
        ? state
        : { ...state, hint: action.hint };
    case 'move':
      return state.position === action.position ||
        (state.position &&
          action.position &&
          state.position.x === action.position.x &&
          state.position.y === action.position.y)
        ? state
        : { ...state, position: action.position };
  }
}
