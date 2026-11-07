import type { LiveActionView, LiveAskStep, LiveScreenInstruction } from '@docoo/contracts';

import {
  groupable,
  isOpen,
  remainingFor,
  voiceTargets,
  waitingActions,
} from './confirmation-model';
import { parsePosition } from './drag';
import type { LiveBackend } from './live-api';
import { acquireSingleTabLock, type LockHandle, type LocksApi } from './lock';
import {
  initialLiveState,
  isLiveActive,
  reduceLive,
  type ConfirmHintReason,
  type LiveAction,
  type LiveChannel,
  type LiveError,
  type LiveState,
  type LiveStatus,
  type PillPosition,
} from './state';
import { screenOfResult } from './screen';
import type { LiveTransport, LiveTransportFactory, LiveTransportHandlers } from './transport';

/**
 * The live assistant's session, kept outside React like the "AI is working" notice
 * (`ai-activity-store.ts`): it is mounted once in the root layout, so changing page neither closes
 * nor restarts it, and it does not depend on whether the Smart window is open (ADR-0055 §4-11).
 */

export const PILL_STORAGE_KEY = 'docoo.live.pill';

export interface LiveStoreDeps {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Resolves with a handle when this tab may run the session, null when another tab does. */
  readonly acquireLock: () => Promise<LockHandle | null>;
  readonly now: () => number;
  /** How often the open session reports its usage to the server (also its heartbeat). */
  readonly heartbeatMs?: number;
  readonly timers?: {
    readonly every: (work: () => void, ms: number) => () => void;
  };
}

export const HEARTBEAT_MS = 15_000;
/** Without an answer from the server for this many reports in a row the session is closed. */
export const MAX_MISSED_HEARTBEATS = 3;
/** The transcript lines waiting to be sent; the oldest are dropped past this, never the newest. */
const MAX_PENDING_LINES = 200;
const LINES_PER_REQUEST = 20;

/** A typed session has no provider connection in the browser: the server's executor does the work. */
const textTransport: LiveTransport = {
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
};
/** The recent lines handed to the executor's model with each typed request. */
const CONTEXT_LINES = 10;
const MAX_TEXT_CHARS = 2000;

type PendingLine = { role: 'user' | 'assistant'; content: string };

/** Why a start was refused, from the problem code the server gave. */
function startErrorOf(error: unknown): LiveError {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'LIVE_CAP_REACHED') return 'cap_reached';
  if (code === 'LIVE_ASSISTANT_UNAVAILABLE') return 'switched_off';
  return 'start_failed';
}

/** Why the server ended a session that was running, from the end reason it recorded. */
function endedErrorOf(reason: string | null): LiveError {
  if (reason === 'cap_cost' || reason === 'cap_time' || reason === 'cap_daily')
    return 'cap_reached';
  if (reason === 'disabled') return 'switched_off';
  if (reason === 'superseded') return 'other_tab';
  return 'connection_lost';
}

/** A problem that means the session itself is over, whichever call it came back from. */
function sessionErrorOf(error: unknown): LiveError | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'LIVE_CAP_REACHED') return 'cap_reached';
  if (code === 'LIVE_ASSISTANT_UNAVAILABLE') return 'switched_off';
  if (code === 'LIVE_SESSION_ENDED') return 'connection_lost';
  return null;
}

const RETRY_REASON: Record<string, ConfirmHintReason> = {
  LIVE_CONFIRMATION_UNCLEAR: 'unclear',
  LIVE_CONFIRMATION_ECHO_MISMATCH: 'echo_mismatch',
  LIVE_CONFIRMATION_TOO_SOON: 'too_soon',
};
const CLOSED_CODES = new Set([
  'LIVE_ACTION_EXPIRED',
  'LIVE_ACTION_CANCELLED',
  'LIVE_ACTION_NOT_OPEN',
  'LIVE_ACTION_NOT_FOUND',
]);

export type ConfirmResult =
  | { readonly ok: true; readonly view: LiveActionView }
  | { readonly ok: false; readonly reason: ConfirmHintReason };

function readPosition(storage: LiveStoreDeps['storage']): PillPosition | null {
  try {
    return parsePosition(storage?.getItem(PILL_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

function savePosition(storage: LiveStoreDeps['storage'], position: PillPosition | null): void {
  try {
    if (position) storage?.setItem(PILL_STORAGE_KEY, JSON.stringify(position));
  } catch {
    /* private mode or full storage: the pill simply starts at its default place next time */
  }
}

export function createLiveStore(deps: LiveStoreDeps) {
  let state = initialLiveState(readPosition(deps.storage));
  const serverState = initialLiveState();
  const listeners = new Set<() => void>();
  let factory: LiveTransportFactory | null = null;
  let transport: LiveTransport | null = null;
  let lock: LockHandle | null = null;
  let starting: Promise<void> | null = null;
  // The server side of the session (ADR-0055 §4-5). Without a backend the store runs on its own,
  // which is how the tests and the development stand-in use it.
  let backend: LiveBackend | null = null;
  // Shows what the assistant asks to show on the screen; none in tests unless they give one.
  let showOnScreen: ((list: readonly LiveScreenInstruction[]) => void) | null = null;
  let sessionId: string | null = null;
  let costUsd = 0;
  /** Tokens the server's executor used for typed requests: the server counts them itself. */
  let executorTokens = 0;
  let nextLine = 1;
  let pending: PendingLine[] = [];
  let missed = 0;
  let stopBeating: (() => void) | null = null;
  let beating = false;
  const every =
    deps.timers?.every ??
    ((work: () => void, ms: number) => {
      const id = setInterval(work, ms);
      return () => clearInterval(id);
    });

  /** The status right now; a function so a check made before an await is not assumed to still hold. */
  const currentStatus = (): LiveStatus => state.status;

  function dispatch(action: LiveAction): void {
    const next = reduceLive(state, action);
    if (next === state) return;
    state = next;
    if (action.type === 'move') savePosition(deps.storage, next.position);
    for (const listener of listeners) listener();
  }

  /** Sends the waiting transcript lines; what could not be sent stays for the next report. */
  async function flushLines(): Promise<void> {
    const id = sessionId;
    if (!backend || !id) return;
    while (pending.length > 0) {
      const batch = pending.slice(0, LINES_PER_REQUEST);
      try {
        await backend.appendMessages(id, batch);
      } catch {
        return;
      }
      pending = pending.slice(batch.length);
    }
  }

  /** The session is over at the server; keep nothing that would report to it again. */
  function forgetServerSession(): void {
    stopBeating?.();
    stopBeating = null;
    sessionId = null;
    pending = [];
  }

  /** Frees the connection, the lock and the server session. Safe to call twice; a failing stop never keeps the lock. */
  async function teardown(reason: 'user' | 'error' = 'user'): Promise<void> {
    const current = transport;
    const held = lock;
    const id = sessionId;
    stopBeating?.();
    stopBeating = null;
    transport = null;
    lock = null;
    try {
      await current?.stop();
    } catch {
      /* best effort: the browser releases the microphone with the page at the latest */
    }
    if (backend && id) {
      try {
        await flushLines();
        await backend.endSession(id, reason);
      } catch {
        /* the server ends a session it no longer hears from; the next start also replaces it */
      }
    }
    sessionId = null;
    pending = [];
    held?.release();
  }

  /** What the browser reports: the totals of this session, which only grow. */
  function totals() {
    // Rounded to a millionth of a dollar: adding many small prices leaves floating-point dust.
    return {
      inputTokens: Math.max(0, state.tokens - executorTokens),
      outputTokens: 0,
      costUsd: Math.round(costUsd * 1e6) / 1e6,
    };
  }

  /** The server ended the session (a cap, the owner's switch, another start): close down here. */
  function closeBecause(error: LiveError): void {
    if (!isLiveActive(state.status)) return;
    forgetServerSession();
    dispatch({ type: 'failed', error });
    void teardown();
  }

  function endedByServer(reason: string | null): void {
    closeBecause(endedErrorOf(reason));
  }

  // ---- changes the assistant proposes ------------------------------------------------------

  /** Takes a view the server gave into the state; one that ended is told to the model too. */
  function accept(view: LiveActionView, options: { report: boolean }): void {
    dispatch({ type: 'action', view, at: deps.now() });
    if (options.report && !isOpen(view) && view.status !== 'refused') {
      try {
        transport?.reportAction?.(view);
      } catch {
        /* the model not hearing about it must not undo what a person decided */
      }
    }
  }

  async function refresh(actionId: string): Promise<void> {
    if (!backend) return;
    try {
      accept(await backend.getAction(actionId), { report: true });
    } catch (error) {
      const closing = sessionErrorOf(error);
      if (closing) closeBecause(closing);
    }
  }

  async function propose(
    capability: string,
    params: Record<string, unknown>,
    tainted = false,
  ): Promise<LiveActionView> {
    const id = sessionId;
    if (!backend || !id || !isLiveActive(state.status)) {
      throw new Error('The live session is not running.');
    }
    try {
      const view = await backend.proposeAction({ sessionId: id, capability, params, tainted });
      if (sessionId !== id) throw new Error('The live session ended.');
      accept(view, { report: false });
      // A page to open or a draft for a form comes back in the result of a finished call.
      const instruction = view.status === 'executed' ? screenOfResult(view.result) : null;
      if (instruction) showOnScreen?.([instruction]);
      return view;
    } catch (error) {
      const closing = sessionErrorOf(error);
      if (closing) closeBecause(closing);
      throw error;
    }
  }

  /** What became of a confirmation that did not go through, shown on the card, never thrown. */
  async function stepFailed(actionId: string, error: unknown): Promise<ConfirmResult> {
    const closing = sessionErrorOf(error);
    if (closing) {
      closeBecause(closing);
      return { ok: false, reason: 'closed' };
    }
    const code = (error as { code?: unknown } | null)?.code;
    const retry = typeof code === 'string' ? RETRY_REASON[code] : undefined;
    if (retry) {
      dispatch({ type: 'hint', hint: { actionId, reason: retry } });
      return { ok: false, reason: retry };
    }
    if (typeof code === 'string' && CLOSED_CODES.has(code)) {
      await refresh(actionId);
      return { ok: false, reason: 'closed' };
    }
    dispatch({ type: 'hint', hint: { actionId, reason: 'failed' } });
    return { ok: false, reason: 'failed' };
  }

  /** A person said yes, by click or by voice. The server reads it and says whether it counts. */
  async function confirm(
    actionId: string,
    input: { via: 'voice' | 'click'; transcript?: string },
  ): Promise<ConfirmResult> {
    if (!backend || !isLiveActive(state.status)) return { ok: false, reason: 'failed' };
    try {
      const view = await backend.confirmAction(actionId, input);
      accept(view, { report: true });
      return { ok: true, view };
    } catch (error) {
      return stepFailed(actionId, error);
    }
  }

  async function cancel(actionId: string): Promise<ConfirmResult> {
    if (!backend || !isLiveActive(state.status)) return { ok: false, reason: 'failed' };
    try {
      const view = await backend.cancelAction(actionId);
      accept(view, { report: true });
      return { ok: true, view };
    } catch (error) {
      return stepFailed(actionId, error);
    }
  }

  const waiting = (): LiveActionView[] =>
    waitingActions(state.actions, (view) => remainingFor(state.timing, view, deps.now()));

  /** One click for the simple changes that wait together; each is its own confirmation on the ledger. */
  async function confirmGroup(): Promise<void> {
    for (const view of groupable(waiting())) {
      const result = await confirm(view.id, { via: 'click' });
      if (!result.ok) return;
    }
  }

  /**
   * What the person said. With nothing waiting it is only conversation. With changes waiting it is
   * their answer: to all of them when they are all simple, otherwise to the oldest alone. The
   * server reads it; an unclear answer changes nothing and the card says to repeat or click.
   */
  async function answerByVoice(transcript: string): Promise<void> {
    if (transcript.trim() === '') return;
    for (const view of voiceTargets(waiting())) {
      const result = await confirm(view.id, { via: 'voice', transcript });
      if (!result.ok) return;
    }
  }

  // ---- typing to the assistant -------------------------------------------------------------

  function addLine(
    role: 'user' | 'assistant',
    text: string,
    failed = false,
    steps: readonly LiveAskStep[] = [],
  ): void {
    dispatch({
      type: 'chat',
      line: {
        id: nextLine++,
        role,
        text,
        ...(failed ? { failed: true } : {}),
        ...(steps.length > 0 ? { steps } : {}),
      },
    });
  }

  /**
   * The owner typed something. The server's executor works through the gateway: what it proposes
   * comes back waiting on the confirmation card, never done. The answer, and what the executor
   * used, are shown here; the server already counts that use in the session and its caps.
   */
  async function ask(raw: string, currentProjectId?: string): Promise<boolean> {
    const text = raw.trim().slice(0, MAX_TEXT_CHARS);
    const id = sessionId;
    if (text === '' || !backend || !id || state.asking || !isLiveActive(state.status)) {
      return false;
    }
    const context = state.chat
      .filter((line) => !line.failed)
      .slice(-CONTEXT_LINES)
      .map((line) => ({ role: line.role, content: line.text }));
    addLine('user', text);
    dispatch({ type: 'asking', on: true });
    try {
      const answer = await backend.ask(id, {
        text,
        context,
        ...(currentProjectId ? { currentProjectId } : {}),
      });
      if (sessionId !== id) return false;
      const used = answer.usage.inputTokens + answer.usage.outputTokens;
      executorTokens += used;
      dispatch({ type: 'usage', tokens: used });
      for (const view of answer.actions) accept(view, { report: false });
      addLine('assistant', answer.answer, false, answer.steps);
      if (answer.screen.length > 0) showOnScreen?.(answer.screen);
      return true;
    } catch (error) {
      if (sessionId !== id) return false;
      const closing = sessionErrorOf(error);
      if (closing) {
        closeBecause(closing);
        return false;
      }
      const code = (error as { code?: unknown } | null)?.code;
      addLine('assistant', typeof code === 'string' ? code : 'LIVE_ASK_FAILED', true);
      return false;
    } finally {
      dispatch({ type: 'asking', on: false });
    }
  }

  async function beat(): Promise<void> {
    const id = sessionId;
    if (!backend || !id || beating || !isLiveActive(state.status)) return;
    beating = true;
    try {
      await flushLines();
      const answer = await backend.reportUsage(id, totals());
      missed = 0;
      if (answer.session.status === 'ended') endedByServer(answer.session.endReason);
      else dispatch({ type: 'warning', on: answer.capStatus === 'warn' });
    } catch {
      missed += 1;
      if (missed >= MAX_MISSED_HEARTBEATS && isLiveActive(state.status)) {
        dispatch({ type: 'failed', error: 'connection_lost' });
        void teardown('error');
      }
    } finally {
      beating = false;
    }
  }

  /** Events from a transport that was already replaced or stopped are dropped. */
  function handlersFor(owner: LiveTransport): LiveTransportHandlers {
    const live = (act: () => void) => () => {
      if (transport === owner) act();
    };
    return {
      onUsage: (tokens, cost) => {
        if (transport !== owner) return;
        dispatch({ type: 'usage', tokens });
        if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) costUsd += cost;
      },
      onMessage: (role, content) => {
        if (transport !== owner || !sessionId || content.trim() === '') return;
        pending.push({ role, content: content.trim().slice(0, 4000) });
        if (pending.length > MAX_PENDING_LINES) pending = pending.slice(-MAX_PENDING_LINES);
      },
      propose: (capability, params, tainted) => {
        if (transport !== owner) return Promise.reject(new Error('The live session is closed.'));
        return propose(capability, params, tainted);
      },
      onSpeech: (transcript) => {
        if (transport === owner) void answerByVoice(transcript);
      },
      onSleep: live(() => dispatch({ type: 'sleep' })),
      onWake: live(() => dispatch({ type: 'wake' })),
      onLost: live(() => {
        if (!isLiveActive(state.status)) return;
        dispatch({ type: 'failed', error: 'connection_lost' });
        void teardown('error');
      }),
    };
  }

  async function open(): Promise<void> {
    const typed = state.channel === 'text';
    if (!factory && !typed) {
      dispatch({ type: 'failed', error: 'unavailable' });
      return;
    }
    const handle = await deps.acquireLock();
    if (!handle) {
      dispatch({ type: 'failed', error: 'other_tab' });
      return;
    }
    lock = handle;
    // stop() was pressed while waiting for the lock: it tears everything down.
    if (state.status !== 'starting') return;
    costUsd = 0;
    executorTokens = 0;
    missed = 0;
    pending = [];
    if (backend) {
      // The server first: it checks that the assistant is on and no cap is reached before the
      // microphone or any connection to a provider is opened.
      try {
        sessionId = (await backend.startSession(state.channel)).id;
        dispatch({ type: 'session', id: sessionId });
      } catch (error) {
        if (currentStatus() === 'closing') return;
        await teardown('error');
        dispatch({ type: 'failed', error: startErrorOf(error) });
        return;
      }
      if (currentStatus() !== 'starting') return;
    }
    const created = typed ? textTransport : factory!();
    transport = created;
    try {
      await created.start(handlersFor(created));
    } catch {
      // Read afresh: stop() may have been pressed while the connection was opening.
      if (currentStatus() === 'closing') return;
      await teardown('error');
      dispatch({ type: 'failed', error: 'start_failed' });
      return;
    }
    dispatch({ type: 'started', now: deps.now() });
    if (backend && sessionId) {
      stopBeating = every(() => void beat(), deps.heartbeatMs ?? HEARTBEAT_MS);
    }
  }

  function start(options: { channel?: LiveChannel } = {}): Promise<void> {
    if (state.status !== 'off' && state.status !== 'error') return starting ?? Promise.resolve();
    dispatch({ type: 'start', channel: options.channel ?? 'voice' });
    starting = open().finally(() => {
      starting = null;
    });
    return starting;
  }

  async function stop(): Promise<void> {
    if (state.status === 'error') {
      dispatch({ type: 'stop' });
      return;
    }
    if (!isLiveActive(state.status)) return;
    dispatch({ type: 'stop' });
    await starting?.catch(() => undefined);
    await teardown();
    dispatch({ type: 'stopped' });
  }

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: (): LiveState => state,
    getServerSnapshot: (): LiveState => serverState,
    start,
    stop,
    propose,
    confirm,
    cancel,
    confirmGroup,
    answerByVoice,
    ask,
    refresh,
    /** Seconds left to confirm a change, on this browser's clock; 0 when its time is over. */
    secondsLeft: (view: LiveActionView): number => remainingFor(state.timing, view, deps.now()),
    move: (position: PillPosition | null): void => dispatch({ type: 'move', position }),
    /**
     * Tells the store which workspace's server to report to. A session already running keeps the
     * backend it started with, so opening the Smart tab of another workspace changes nothing.
     */
    setBackend: (next: LiveBackend | null): void => {
      if (!isLiveActive(state.status) && state.status !== 'closing') backend = next;
    },
    /** Tells the store how to show a page or a form draft on the screen (the host gives the router). */
    setScreenHandler: (next: ((list: readonly LiveScreenInstruction[]) => void) | null): void => {
      showOnScreen = next;
    },
    /** Tells the store how to reach the provider; without one, starting reports "unavailable". */
    setTransportFactory: (next: LiveTransportFactory | null): void => {
      factory = next;
      dispatch({ type: 'availability', available: next !== null });
    },
  };
}

export type LiveStore = ReturnType<typeof createLiveStore>;

function browserDeps(): LiveStoreDeps {
  const granted: LockHandle = { release: () => undefined };
  if (typeof window === 'undefined') {
    return { storage: null, acquireLock: () => Promise.resolve(granted), now: () => Date.now() };
  }
  let storage: Storage | null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return {
    storage,
    acquireLock: () => acquireSingleTabLock((navigator as unknown as { locks?: LocksApi }).locks),
    now: () => Date.now(),
  };
}

/** The one store of this page. The root layout mounts its pill; nothing else owns a session. */
export const liveAssistant: LiveStore = createLiveStore(browserDeps());
