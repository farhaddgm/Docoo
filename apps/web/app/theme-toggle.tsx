'use client';

import { useEffect, useRef, useState } from 'react';

import { messagesFor, type Locale } from './i18n';
import {
  applyThemePreference,
  readThemePreference,
  storeThemePreference,
  themePreferences,
  themeSwatches,
  type ThemePreference,
} from './theme';

/**
 * Theme picker: one palette button in the top bar opens the list of colour themes shared with
 * Bee Researcher (follow the system, light, dark and six palettes). The choice is kept in this
 * browser and applies at once.
 */
export function ThemePicker({ locale }: { readonly locale: Locale }) {
  const content = messagesFor(locale);
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Storage is only readable in the browser, so the saved choice is picked up after hydration.
  useEffect(() => {
    setPreference(readThemePreference());
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  function choose(next: ThemePreference) {
    setPreference(next);
    storeThemePreference(next);
    applyThemePreference(next);
  }

  return (
    <div className="theme-picker" ref={wrapper}>
      <button
        ref={trigger}
        type="button"
        className="theme-picker-button"
        aria-expanded={open}
        aria-controls="theme-picker-panel"
        aria-label={`${content.theme.label}: ${content.theme[preference]}`}
        title={content.theme.label}
        onClick={() => setOpen((value) => !value)}
      >
        <span
          className="theme-swatch"
          style={{ background: themeSwatches[preference] }}
          aria-hidden="true"
        />
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
          <path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.8 0-1-.8-1.4-.8-2.4 0-1 .8-1.8 1.9-1.8H17a4 4 0 0 0 4-4C21 7 17 3 12 3zM7.5 11.5h.01M10 7.5h.01M14.5 7.5h.01" />
        </svg>
      </button>
      <div id="theme-picker-panel" className="theme-picker-panel" hidden={!open}>
        <p className="theme-picker-title">{content.theme.label}</p>
        <div role="group" aria-label={content.theme.label} className="theme-picker-list">
          {themePreferences.map((item) => (
            <button
              key={item}
              type="button"
              className="theme-choice"
              aria-pressed={preference === item}
              onClick={() => choose(item)}
            >
              <span
                className="theme-swatch"
                style={{ background: themeSwatches[item] }}
                aria-hidden="true"
              />
              <span>{content.theme[item]}</span>
            </button>
          ))}
        </div>
        <p className="theme-picker-hint">{content.theme.pickerHint}</p>
      </div>
    </div>
  );
}
