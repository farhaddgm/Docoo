/**
 * Colour theme of the backoffice: follow the system, force light or dark, or one of the
 * colour palettes shared with Bee Researcher (blue, honey, forest, slate, black and yellow, red).
 */
export type ThemePreference =
  'system' | 'light' | 'dark' | 'default' | 'honey' | 'forest' | 'slate' | 'blackyellow' | 'red';

export const themePreferences: readonly ThemePreference[] = [
  'system',
  'light',
  'dark',
  'default',
  'honey',
  'forest',
  'slate',
  'blackyellow',
  'red',
];

/** Swatch colour shown for each theme in the picker. */
export const themeSwatches: Record<ThemePreference, string> = {
  system: 'linear-gradient(135deg, #eef3fb 50%, #17243f 50%)',
  light: '#f8fafc',
  dark: '#17243f',
  default: '#2457d6',
  honey: '#f5b942',
  forest: '#237a57',
  slate: '#64748b',
  blackyellow: 'linear-gradient(135deg, #171717 50%, #f5c542 50%)',
  red: '#c7364c',
};

export const themeStorageKey = 'docoo-theme';

/** Whether the desktop sidebar is folded to its icon rail (`collapsed`) or open. */
export const sidebarStorageKey = 'docoo-sidebar';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (themePreferences as readonly string[]).includes(value);
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
export const themeInitScript = `try{var t=localStorage.getItem(${JSON.stringify(themeStorageKey)});if(${JSON.stringify(themePreferences.filter((item) => item !== 'system'))}.indexOf(t)>-1)document.documentElement.dataset.theme=t}catch(e){}try{if(localStorage.getItem(${JSON.stringify(sidebarStorageKey)})==='collapsed')document.documentElement.dataset.sidebar='collapsed'}catch(e){}`;
