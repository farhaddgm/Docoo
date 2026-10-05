/** Colour theme of the backoffice: follow the system, or force light or dark. */
export type ThemePreference = 'system' | 'light' | 'dark';

export const themePreferences: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const themeStorageKey = 'docoo-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** The stored choice, or `system` when nothing valid is stored or storage is unavailable. */
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(themeStorageKey);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function storeThemePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(themeStorageKey);
    else localStorage.setItem(themeStorageKey, preference);
  } catch {
    // Private mode or blocked storage: the choice just lasts until the page is closed.
  }
}

/** `system` leaves the attribute off so the stylesheet follows `prefers-color-scheme`. */
export function applyThemePreference(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = preference;
}

/**
 * Runs in <head> before the first paint so a stored choice never flashes the other theme.
 * Inline scripts are allowed by the Content-Security-Policy (see content-security-policy.ts).
 */
export const themeInitScript = `try{var t=localStorage.getItem(${JSON.stringify(themeStorageKey)});if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
