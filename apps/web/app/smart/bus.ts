/**
 * Tiny event bus that lets low-level code (api-client, error boundary) signal errors to Smart
 * without importing it, so nothing depends on the Smart UI being mounted.
 */
export type SmartBusEvent =
  /** A 5xx answer; the server records it itself (SMT-001). */
  | { type: 'server-error'; status: number; method: string; path: string }
  /** A browser-side error that still has to be reported to the server. */
  | {
      type: 'client-error';
      kind: 'runtime' | 'promise' | 'render' | 'api';
      message: string;
      detail?: string;
      method?: string;
      path?: string;
    }
  /** The server stored a browser error; Smart may show a toast for it. */
  | { type: 'error-recorded'; errorId: string; message: string };

type Listener = (event: SmartBusEvent) => void;
const listeners = new Set<Listener>();

export const smartBus = {
  emit(event: SmartBusEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        /* a listener must never break the emitter */
      }
    }
  },
  on(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
