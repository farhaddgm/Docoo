export type SmartTab = 'walker' | 'chat' | 'errors';

/** What the browser remembers about Smart: on/off, side, collapsed, tab and walker project. */
export interface SmartUiState {
  readonly enabled: boolean;
  readonly minimized: boolean;
  readonly side: 'start' | 'end';
  readonly tab: SmartTab;
  readonly projectId: string | null;
}

export const defaultUiState: SmartUiState = {
  enabled: true,
  minimized: true,
  side: 'end',
  tab: 'walker',
  projectId: null,
};

const STORAGE_KEY = 'docoo.smart.ui';
const tabs: readonly SmartTab[] = ['walker', 'chat', 'errors'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads a stored value defensively: anything malformed falls back to the default field. */
export function parseUiState(raw: string | null): SmartUiState {
  if (!raw) return defaultUiState;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return defaultUiState;
  }
  if (typeof value !== 'object' || value === null) return defaultUiState;
  const record = value as Record<string, unknown>;
  return {
    enabled: typeof record['enabled'] === 'boolean' ? record['enabled'] : defaultUiState.enabled,
    minimized:
      typeof record['minimized'] === 'boolean' ? record['minimized'] : defaultUiState.minimized,
    side: record['side'] === 'start' || record['side'] === 'end' ? record['side'] : 'end',
    tab: tabs.find((tab) => tab === record['tab']) ?? defaultUiState.tab,
    projectId:
      typeof record['projectId'] === 'string' && uuidPattern.test(record['projectId'])
        ? record['projectId']
        : null,
  };
}

const listeners = new Set<() => void>();
let current: SmartUiState = defaultUiState;
let loaded = false;

function load(): void {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    current = parseUiState(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    current = defaultUiState;
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = parseUiState(event.newValue);
    for (const listener of listeners) listener();
  });
}

function save(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* private mode or full storage: the state simply stays per page */
  }
}

/** External store for `useSyncExternalStore`; the server snapshot is always the default. */
export const smartUi = {
  subscribe: (listener: () => void): (() => void) => {
    load();
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: (): SmartUiState => {
    load();
    return current;
  },
  getServerSnapshot: (): SmartUiState => defaultUiState,
  update: (patch: Partial<SmartUiState>): void => {
    load();
    const next = { ...current, ...patch };
    if ((Object.keys(next) as (keyof SmartUiState)[]).every((key) => next[key] === current[key])) {
      return;
    }
    current = next;
    save();
    for (const listener of listeners) listener();
  },
};
