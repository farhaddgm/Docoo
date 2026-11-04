/**
 * State of the live voice assistant in this browser (ADR-0055 §4-7, §4-11). One reducer owns every
 * legal move, so the floating pill, the Smart tab and the transport can never disagree.
 *
 * Only the pill position survives a reload: a live connection cannot, so a new page always
 * starts switched off.
 */

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

export interface LiveState {
  readonly status: LiveStatus;
  /** Whether a way to talk to the provider is set up. Without one the feature stays switched off. */
  readonly available: boolean;
  /** Tokens used by the current (or, when off, the last) session, voice and executor together. */
  readonly tokens: number;
  readonly startedAt: number | null;
  readonly error: LiveError | null;
  /** The server says a cost or time cap is close (80% or more); the session is still running. */
  readonly warning: boolean;
  readonly position: PillPosition | null;
}

export type LiveAction =
  | { readonly type: 'availability'; readonly available: boolean }
  | { readonly type: 'start' }
  | { readonly type: 'started'; readonly now: number }
  | { readonly type: 'usage'; readonly tokens: number }
  | { readonly type: 'sleep' }
  | { readonly type: 'wake' }
  | { readonly type: 'stop' }
  | { readonly type: 'stopped' }
  | { readonly type: 'failed'; readonly error: LiveError }
  | { readonly type: 'warning'; readonly on: boolean }
  | { readonly type: 'move'; readonly position: PillPosition | null };

export const initialLiveState = (position: PillPosition | null = null): LiveState => ({
  status: 'off',
  available: false,
  tokens: 0,
  startedAt: null,
  error: null,
  warning: false,
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
        status: 'starting',
        tokens: 0,
        startedAt: null,
        error: null,
        warning: false,
      };
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
        ? { ...state, status: 'off', startedAt: null, warning: false }
        : state;
    case 'failed':
      return state.status === 'off' || state.status === 'error'
        ? state
        : { ...state, status: 'error', error: action.error, startedAt: null, warning: false };
    case 'warning':
      // Only a running session has a cap to be close to; a stale answer after the end is ignored.
      return isLiveActive(state.status) && state.warning !== action.on
        ? { ...state, warning: action.on }
        : state;
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
