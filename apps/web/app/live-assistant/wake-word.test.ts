import { describe, expect, it } from 'vitest';

import {
  createCheckedWakeDetector,
  createLocalWakeDetector,
  createWakeGuard,
  installWakeLanguage,
  MAX_WAKES_PER_MINUTE,
  WAKE_COOLDOWN_MS,
  wakeSupport,
  type RecognitionConstructor,
  type RecognitionLike,
  type RecognitionResultEvent,
  type WakeEnv,
} from './wake-detector';
import { matchesWakePhrase, soundKey } from './wake-match';

describe('recognising the wake phrase in what the browser heard', () => {
  it('takes the ways a recogniser writes "Hi Docoo"', () => {
    for (const heard of [
      'hi docoo',
      'Hi Docoo',
      'Hi, Docoo!',
      'hey docoo',
      'hi doku',
      'hi doco',
      'hi dockoo',
      'hi do coo',
      'hi daku',
      'high docu',
      'ok so hi docoo',
      'um hi docoo',
    ]) {
      expect(matchesWakePhrase(heard, 'Hi Docoo'), heard).toBe(true);
    }
  });

  it('does not wake for other speech that merely sounds close', () => {
    for (const heard of [
      '',
      'hello',
      'hi',
      'docoo',
      'hi do you',
      'hi doctor',
      'hi dad',
      'hi duke',
      'hi docoo is a good name for something',
      'the weather is nice',
      'hi tomorrow',
      'hi decor',
    ]) {
      expect(matchesWakePhrase(heard, 'Hi Docoo'), heard).toBe(false);
    }
  });

  it('follows a changed phrase, and never matches an empty one', () => {
    expect(matchesWakePhrase('hey computer', 'Hey Computer')).toBe(true);
    expect(matchesWakePhrase('hi docoo', 'Hey Computer')).toBe(false);
    expect(matchesWakePhrase('anything', '')).toBe(false);
    expect(matchesWakePhrase('anything', '   ')).toBe(false);
  });

  it('keeps a sound key that treats c, k and q alike and ignores doubled letters', () => {
    expect(soundKey('Docoo')).toBe(soundKey('doku'));
    expect(soundKey('Dokku')).toBe(soundKey('doku'));
  });
});

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = [];
  static availability = 'available';
  static installed = false;
  static failStart = false;
  lang = '';
  continuous = false;
  interimResults = false;
  phrases: unknown = null;
  onresult: ((event: RecognitionResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  aborted = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start(): void {
    if (FakeRecognition.failStart) throw new Error('already started');
    this.started += 1;
  }
  stop(): void {}
  abort(): void {
    this.aborted += 1;
  }
  hear(transcript: string): void {
    this.onresult?.({ resultIndex: 0, results: [[{ transcript }]] });
  }
  static available(): Promise<string> {
    return Promise.resolve(FakeRecognition.availability);
  }
  static install(): Promise<boolean> {
    FakeRecognition.installed = true;
    return Promise.resolve(true);
  }
}

// Chrome has the on-device switch on the prototype, which is how the code tells it from a cloud-only one.
Object.defineProperty(FakeRecognition.prototype, 'processLocally', {
  value: false,
  writable: true,
  configurable: true,
});

describe('listening for the wake phrase on the device', () => {
  let now = 0;
  let timers: { work: () => void; at: number; id: number }[] = [];
  let nextTimer = 1;
  const env = (recognition: RecognitionConstructor | null = FakeRecognition): WakeEnv => ({
    recognition,
    setTimeout: (work, ms) => {
      const id = nextTimer++;
      timers.push({ work, at: now + ms, id });
      return id;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((timer) => timer.id !== handle);
    },
    now: () => now,
  });
  const run = (ms: number) => {
    now += ms;
    const due = timers.filter((timer) => timer.at <= now);
    timers = timers.filter((timer) => timer.at > now);
    for (const timer of due) timer.work();
  };
  const last = () => FakeRecognition.instances.at(-1)!;

  const reset = () => {
    now = 100_000;
    timers = [];
    FakeRecognition.instances = [];
    FakeRecognition.availability = 'available';
    FakeRecognition.installed = false;
    FakeRecognition.failStart = false;
  };

  it('uses recognition only when the browser promises to keep the audio on the device', async () => {
    reset();
    expect(await wakeSupport(env(null))).toBe('unsupported');
    // A browser that has recognition but no on-device switch is not used (it would use the cloud).
    class Cloud {
      static available = () => FakeRecognition.available();
    }
    const cloudOnly = Cloud as unknown as RecognitionConstructor;
    expect(await wakeSupport(env(cloudOnly))).toBe('unsupported');
    expect(await wakeSupport(env())).toBe('ready');
    FakeRecognition.availability = 'downloadable';
    expect(await wakeSupport(env())).toBe('needs_language_pack');
    FakeRecognition.availability = 'unavailable';
    expect(await wakeSupport(env())).toBe('unsupported');
  });

  it('installs the language pack only when asked', async () => {
    reset();
    expect(FakeRecognition.installed).toBe(false);
    expect(await installWakeLanguage(env())).toBe(true);
    expect(FakeRecognition.installed).toBe(true);
    expect(await installWakeLanguage(env(null))).toBe(false);
  });

  it('turns on the on-device switch, never the cloud, and wakes when the phrase is heard', async () => {
    reset();
    const woken: number[] = [];
    const detector = createLocalWakeDetector(env(), 'Hi Docoo');
    await detector.start(() => woken.push(now));
    expect(last()).toMatchObject({ processLocally: true, continuous: true, started: 1 });
    last().hear('what is the weather');
    expect(woken).toEqual([]);
    last().hear('hi docoo');
    expect(woken).toHaveLength(1);
    detector.stop();
  });

  it('counts one call heard several times as one wake', async () => {
    reset();
    const woken: number[] = [];
    const detector = createLocalWakeDetector(env(), 'Hi Docoo');
    await detector.start(() => woken.push(now));
    last().hear('hi docoo');
    last().hear('hi docoo');
    run(WAKE_COOLDOWN_MS - 1);
    last().hear('hi docoo');
    expect(woken).toHaveLength(1);
    run(2);
    last().hear('hi docoo');
    expect(woken).toHaveLength(2);
    detector.stop();
  });

  it('pauses itself when a noisy room keeps calling it', async () => {
    reset();
    const woken: number[] = [];
    const guard = createWakeGuard();
    const detector = createLocalWakeDetector(env(), 'Hi Docoo', guard);
    await detector.start(() => woken.push(now));
    for (let i = 0; i < MAX_WAKES_PER_MINUTE + 3; i += 1) {
      last().hear('hi docoo');
      run(WAKE_COOLDOWN_MS + 1);
    }
    expect(woken).toHaveLength(MAX_WAKES_PER_MINUTE);
    detector.stop();
    // A detector made after the next sleep shares the pause.
    const again: number[] = [];
    const next = createLocalWakeDetector(env(), 'Hi Docoo', guard);
    await next.start(() => again.push(now));
    last().hear('hi docoo');
    expect(again).toEqual([]);
    next.stop();
  });

  it('starts again by itself when the recogniser ends, but not after stop or a refused microphone', async () => {
    reset();
    const detector = createLocalWakeDetector(env(), 'Hi Docoo');
    await detector.start(() => undefined);
    const first = last();
    now += 30_000;
    first.onend?.();
    run(1_000);
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(last().started).toBe(1);
    detector.stop();
    expect(last().aborted).toBe(1);
    last().onend?.();
    run(5_000);
    expect(FakeRecognition.instances).toHaveLength(2);

    reset();
    const refused = createLocalWakeDetector(env(), 'Hi Docoo');
    await refused.start(() => undefined);
    last().onerror?.({ error: 'not-allowed' });
    last().onend?.();
    run(5_000);
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it('gives up when it ends right after every start, and says so when it cannot start at all', async () => {
    reset();
    const detector = createLocalWakeDetector(env(), 'Hi Docoo');
    await detector.start(() => undefined);
    for (let i = 0; i < 12; i += 1) {
      last().onend?.();
      run(500);
    }
    expect(FakeRecognition.instances.length).toBeLessThan(10);

    reset();
    FakeRecognition.failStart = true;
    await expect(
      createLocalWakeDetector(env(), 'Hi Docoo').start(() => undefined),
    ).rejects.toThrow();
    await expect(
      createLocalWakeDetector(env(null), 'Hi Docoo').start(() => undefined),
    ).rejects.toThrow('wake_unsupported');
  });

  it('is not started at all when the browser cannot recognise on the device, or when it was stopped meanwhile', async () => {
    reset();
    FakeRecognition.availability = 'unavailable';
    await expect(
      createCheckedWakeDetector(env(), 'Hi Docoo', createWakeGuard()).start(() => undefined),
    ).rejects.toThrow('wake_unsupported');
    expect(FakeRecognition.instances).toHaveLength(0);

    reset();
    const detector = createCheckedWakeDetector(env(), 'Hi Docoo', createWakeGuard());
    const starting = detector.start(() => undefined);
    detector.stop();
    await starting;
    expect(FakeRecognition.instances).toHaveLength(0);
  });
});
