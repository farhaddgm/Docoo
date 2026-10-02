import { describe, expect, it } from 'vitest';

import {
  direction,
  errorMessage,
  formatDate,
  formatNumber,
  isLocale,
  localizedPath,
  messagesFor,
  navigation,
} from './i18n';

describe('i18n (FR-LOC-001..004)', () => {
  it('maps locales to direction and validates them', () => {
    expect(direction('fa')).toBe('rtl');
    expect(direction('en')).toBe('ltr');
    expect(isLocale('fa')).toBe(true);
    expect(isLocale('de')).toBe(false);
  });

  it('switches language while keeping the current page', () => {
    expect(localizedPath('/fa', 'en')).toBe('/en');
    expect(localizedPath('/fa/reset-password', 'en')).toBe('/en/reset-password');
    expect(localizedPath('/en/forgot-password', 'fa')).toBe('/fa/forgot-password');
    expect(localizedPath('/', 'fa')).toBe('/fa/');
  });

  it('formats numbers and dates for the locale from locale-neutral values', () => {
    expect(formatNumber('fa', 1234)).toBe('۱٬۲۳۴');
    expect(formatNumber('en', 1234)).toBe('1,234');
    expect(formatDate('en', '2026-10-02T00:00:00Z')).toContain('2026');
    expect(formatDate('fa', '2026-10-02T00:00:00Z')).toMatch(/[۰-۹]/);
  });

  it('maps API problem codes to safe localized messages', () => {
    expect(errorMessage('fa', 'AUTH_INVALID_CREDENTIALS')).toBe('ایمیل یا گذرواژه درست نیست.');
    expect(errorMessage('en', 'AUTH_INVALID_CREDENTIALS')).toBe(
      'The email or password is incorrect.',
    );
    expect(errorMessage('en', 'SOMETHING_UNKNOWN')).toBe('Something went wrong. Please try again.');
    expect(errorMessage('fa', undefined)).toBe('عملیات انجام نشد. دوباره تلاش کنید.');
  });

  it('has a complete translation for every navigation entry and message', () => {
    const fa = messagesFor('fa');
    const en = messagesFor('en');
    for (const key of navigation) {
      expect(fa.nav[key]).toBeTruthy();
      expect(en.nav[key]).toBeTruthy();
    }
    expect(Object.keys(fa).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(fa.errors).sort()).toEqual(Object.keys(en.errors).sort());
  });
});
