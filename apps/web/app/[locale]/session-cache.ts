import type { SessionIdentity } from './signed-in';

/**
 * The last session this tab loaded. Every page mounts its own shell, so without this the sidebar
 * would vanish while the next page asks for the session again; with it the shell paints at once
 * and the fresh answer replaces it.
 */
let cached: SessionIdentity | null = null;

export function cachedSession(): SessionIdentity | null {
  return cached;
}

export function rememberSession(identity: SessionIdentity | null): void {
  cached = identity;
}
