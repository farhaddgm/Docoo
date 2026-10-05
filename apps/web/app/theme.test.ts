import { runInThisContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyThemePreference,
  isThemePreference,
  readThemePreference,
  storeThemePreference,
  themeInitScript,
  themeStorageKey,
} from './theme';

function stubBrowser() {
  const store = new Map<string, string>();
  const root = { dataset: {} as Record<string, string | undefined> };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  vi.stubGlobal('document', { documentElement: root });
  return { store, root };
}

afterEach(() => vi.unstubAllGlobals());

describe('theme preference', () => {
  it('accepts only the three known values', () => {
    expect(['system', 'light', 'dark'].every(isThemePreference)).toBe(true);
    expect(isThemePreference('sepia')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('stores light and dark, and forgets the choice for system', () => {
    const { store } = stubBrowser();
    storeThemePreference('dark');
    expect(store.get(themeStorageKey)).toBe('dark');
    expect(readThemePreference()).toBe('dark');
    storeThemePreference('system');
    expect(store.has(themeStorageKey)).toBe(false);
    expect(readThemePreference()).toBe('system');
  });

  it('ignores an invalid stored value and survives unavailable storage', () => {
    const { store } = stubBrowser();
    store.set(themeStorageKey, 'sepia');
    expect(readThemePreference()).toBe('system');
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(readThemePreference()).toBe('system');
    expect(() => storeThemePreference('light')).not.toThrow();
  });

  it('sets data-theme for light and dark and removes it for system', () => {
    const { root } = stubBrowser();
    applyThemePreference('dark');
    expect(root.dataset['theme']).toBe('dark');
    applyThemePreference('system');
    expect(root.dataset['theme']).toBeUndefined();
  });

  it('has an init script that applies the stored choice before paint', () => {
    const { store, root } = stubBrowser();
    store.set(themeStorageKey, 'light');
    runInThisContext(themeInitScript);
    expect(root.dataset['theme']).toBe('light');
    root.dataset['theme'] = undefined;
    store.set(themeStorageKey, 'junk');
    runInThisContext(themeInitScript);
    expect(root.dataset['theme']).toBeUndefined();
  });
});
