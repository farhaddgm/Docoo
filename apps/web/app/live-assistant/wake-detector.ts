import { matchesWakePhrase } from './wake-match';

/**
 * Listening for the wake phrase while the assistant sleeps (ADR-0057 §15).
 *
 * The detector is the browser's own speech recognition run **on the device** (`processLocally`):
 * if the browser cannot promise that no audio leaves the device, it is not used at all. It runs
 * only while the assistant is asleep, is stopped before the voice link opens, and never sends
 * anything anywhere: it hands back one thing, "the phrase was heard".
 */

export interface WakeDetector {
  /** Starts listening; `onWake` is called each time the phrase is heard. Rejects if it cannot. */
  start(onWake: () => void): Promise<void>;
  stop(): void;
}

export type WakeSupport = 'ready' | 'needs_language_pack' | 'unsupported';

/** The parts of the browser's recognition object this uses (all optional: browsers differ). */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  phrases?: unknown;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>;
}

export interface RecognitionConstructor {
  new (): RecognitionLike;
  /** Chrome: whether a language can be recognised on the device ("available", "downloadable"…). */
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
}

export interface WakeEnv {
  readonly recognition: RecognitionConstructor | null;
  readonly setTimeout: (work: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly now: () => number;
}

export const WAKE_LANGUAGE = 'en-US';
/** After a wake, the same phrase is ignored for this long (one call is heard several times). */
export const WAKE_COOLDOWN_MS = 4_000;
/** More wakes than this in a minute is a noise problem, not a person: it is paused. */
export const MAX_WAKES_PER_MINUTE = 3;
export const WAKE_PAUSE_MS = 10 * 60_000;
const RESTART_DELAY_MS = 400;
/** Restarts that fail this many times in a row give up (a revoked permission, a broken engine). */
const MAX_FAILED_RESTARTS = 5;
/** An end sooner than this after a start means it did not really run. */
const QUICK_END_MS = 2_000;

/** What this browser can do, without starting anything. */
export async function wakeSupport(env: Pick<WakeEnv, 'recognition'>): Promise<WakeSupport> {
  const Recognition = env.recognition;
  if (!Recognition) return 'unsupported';
  // Without the on-device switch there is no promise about where the audio goes.
  if (!('processLocally' in Recognition.prototype)) return 'unsupported';
  if (!Recognition.available) return 'unsupported';
  try {
    const answer = await Recognition.available({ langs: [WAKE_LANGUAGE], processLocally: true });
    if (answer === 'available') return 'ready';
    return answer === 'downloadable' || answer === 'downloading'
      ? 'needs_language_pack'
      : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** Downloads the on-device language pack (the person pressed a button; it is not done silently). */
export async function installWakeLanguage(env: Pick<WakeEnv, 'recognition'>): Promise<boolean> {
  const Recognition = env.recognition;
  if (!Recognition?.install) return false;
  try {
    return await Recognition.install({ langs: [WAKE_LANGUAGE], processLocally: true });
  } catch {
    return false;
  }
}

/** The phrase may have been heard in an interim result or a final one; the last few words count. */
function heardIn(event: RecognitionResultEvent, phrase: string): boolean {
  for (let index = event.resultIndex; index < event.results.length; index += 1) {
    const alternatives = event.results[index];
    if (!alternatives) continue;
    for (let alt = 0; alt < alternatives.length; alt += 1) {
      const transcript = alternatives[alt]?.transcript ?? '';
      if (matchesWakePhrase(transcript, phrase)) return true;
    }
  }
  return false;
}

/**
 * Keeps a noisy room from waking the assistant again and again: the same call heard several times
 * is one wake, and too many wakes in a minute pause listening for a while. One guard is shared by
 * every detector of the page, since a new one is made each time the assistant falls asleep.
 */
export interface WakeGuard {
  allow(now: number): boolean;
}

export function createWakeGuard(): WakeGuard {
  let lastWake = Number.NEGATIVE_INFINITY;
  let recent: number[] = [];
  let pausedUntil = 0;
  return {
    allow(at) {
      if (at < pausedUntil || at - lastWake < WAKE_COOLDOWN_MS) return false;
      recent = recent.filter((time) => at - time < 60_000);
      recent.push(at);
      lastWake = at;
      if (recent.length > MAX_WAKES_PER_MINUTE) {
        pausedUntil = at + WAKE_PAUSE_MS;
        recent = [];
        return false;
      }
      return true;
    },
  };
}

export function createLocalWakeDetector(
  env: WakeEnv,
  phrase: string,
  guard: WakeGuard = createWakeGuard(),
): WakeDetector {
  let recognition: RecognitionLike | null = null;
  let running = false;
  let restart: unknown = null;
  let failedRestarts = 0;
  let openedAt = 0;
  let onWake: (() => void) | null = null;

  function wakeHeard(): void {
    if (guard.allow(env.now())) onWake?.();
  }

  function open(): void {
    if (!running || !env.recognition) return;
    const instance = new env.recognition();
    openedAt = env.now();
    instance.lang = WAKE_LANGUAGE;
    instance.continuous = true;
    instance.interimResults = true;
    instance.processLocally = true;
    // A hint to the recogniser (Chrome): the phrase is likely, so it is not turned into other words.
    try {
      instance.phrases = [{ phrase, boost: 8 }];
    } catch {
      /* a browser without phrase hints still works, only less well */
    }
    instance.onresult = (event) => {
      failedRestarts = 0;
      if (running && heardIn(event, phrase)) wakeHeard();
    };
    instance.onerror = (event) => {
      // A refused microphone or an unusable engine does not get better by trying again.
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        running = false;
      }
    };
    instance.onend = () => {
      if (recognition === instance) recognition = null;
      if (!running) return;
      // Ending after a long quiet stretch is normal; only ends right after a start are failures.
      failedRestarts = env.now() - openedAt >= QUICK_END_MS ? 0 : failedRestarts + 1;
      if (failedRestarts > MAX_FAILED_RESTARTS) {
        running = false;
        return;
      }
      // Recognition ends by itself every so often; it is started again, a moment later.
      restart = env.setTimeout(open, RESTART_DELAY_MS);
    };
    recognition = instance;
    try {
      instance.start();
    } catch {
      recognition = null;
      running = false;
    }
  }

  return {
    start(callback) {
      if (!env.recognition) return Promise.reject(new Error('wake_unsupported'));
      onWake = callback;
      running = true;
      failedRestarts = 0;
      open();
      return running ? Promise.resolve() : Promise.reject(new Error('wake_failed'));
    },
    stop() {
      running = false;
      onWake = null;
      if (restart !== null) env.clearTimeout(restart);
      restart = null;
      const current = recognition;
      recognition = null;
      if (current) {
        current.onresult = null;
        current.onend = null;
        current.onerror = null;
        try {
          current.abort();
        } catch {
          /* already stopped */
        }
      }
    },
  };
}

/**
 * The detector the page uses: it first asks the browser whether it can recognise on the device, and
 * does not start (nor fall back to the cloud) when it cannot.
 */
export function createCheckedWakeDetector(
  env: WakeEnv,
  phrase: string,
  guard: WakeGuard,
): WakeDetector {
  const inner = createLocalWakeDetector(env, phrase, guard);
  let stopped = false;
  return {
    async start(onWake) {
      stopped = false;
      if ((await wakeSupport(env)) !== 'ready') throw new Error('wake_unsupported');
      // Put to sleep and woken again, or stopped, while the browser was being asked.
      if (stopped) return;
      await inner.start(onWake);
    },
    stop() {
      stopped = true;
      inner.stop();
    },
  };
}

/** The real browser's recognition constructor, if it has one. */
export function browserWakeEnv(): WakeEnv {
  const scope = (typeof window === 'undefined' ? {} : window) as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return {
    recognition: scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null,
    setTimeout: (work, ms) => setTimeout(work, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  };
}
