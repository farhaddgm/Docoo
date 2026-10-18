/**
 * What the page under the Smart window is showing, for the one case where the assistant has to
 * know it: the Brain report the administrator has open. Pages publish it, the chat sends the id,
 * and the server reads the report itself (read-only, permission-checked). Nothing is persisted.
 */
export interface SmartPageContext {
  readonly brainReportId: string | null;
}

const empty: SmartPageContext = { brainReportId: null };
const listeners = new Set<() => void>();
let current: SmartPageContext = empty;

export const smartPageContext = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): SmartPageContext => current,
  getServerSnapshot: (): SmartPageContext => empty,
  /** Publishes the open Brain report; `null` when none is open or the page is left. */
  setBrainReport: (brainReportId: string | null): void => {
    if (current.brainReportId === brainReportId) return;
    current = { ...current, brainReportId };
    for (const listener of listeners) listener();
  },
};
