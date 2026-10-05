'use client';

import { useEffect, useState } from 'react';

import { messagesFor, type Locale } from './i18n';
import {
  applyThemePreference,
  readThemePreference,
  storeThemePreference,
  themePreferences,
  type ThemePreference,
} from './theme';

const iconPaths: Record<ThemePreference, string> = {
  system: 'M3 5h18v11H3zM8 20h8M12 16v4',
  light:
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  dark: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
};

/** Three-way colour theme switch: follow the system, light, or dark. */
export function ThemeToggle({ locale }: { readonly locale: Locale }) {
  const content = messagesFor(locale);
  const [preference, setPreference] = useState<ThemePreference>('system');

  // Storage is only readable in the browser, so the saved choice is picked up after hydration.
  useEffect(() => {
    setPreference(readThemePreference());
  }, []);

  function choose(next: ThemePreference) {
    setPreference(next);
    storeThemePreference(next);
    applyThemePreference(next);
  }

  return (
    <div className="theme-toggle" role="group" aria-label={content.theme.label}>
      {themePreferences.map((item) => (
        <button
          key={item}
          type="button"
          className="theme-option"
          aria-pressed={preference === item}
          aria-label={content.theme[item]}
          title={content.theme[item]}
          onClick={() => choose(item)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d={iconPaths[item]} />
          </svg>
        </button>
      ))}
    </div>
  );
}
