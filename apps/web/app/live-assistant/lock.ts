/**
 * One live session per browser (ADR-0055 §4-11): a second tab would open a second microphone and a
 * second paid connection. The Web Locks API is shared by all tabs of the origin; the lock is held
 * for as long as the session lives and goes away with the tab.
 */

export interface LockHandle {
  release(): void;
}

export interface LocksApi {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>;
}

export const LIVE_LOCK_NAME = 'docoo.live-assistant';

const nothingToRelease: LockHandle = { release: () => undefined };

/**
 * Resolves with a handle when this tab may run the session, and null when another tab already does.
 * A browser without Web Locks (or one that refuses them) gets a no-op handle: the session still
 * runs, just without the protection.
 */
export function acquireSingleTabLock(locks: LocksApi | undefined): Promise<LockHandle | null> {
  if (!locks) return Promise.resolve(nothingToRelease);
  return new Promise((resolve) => {
    locks
      .request(LIVE_LOCK_NAME, { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return null;
        }
        return new Promise<void>((held) => {
          resolve({ release: () => held() });
        });
      })
      .catch(() => resolve(nothingToRelease));
  });
}
