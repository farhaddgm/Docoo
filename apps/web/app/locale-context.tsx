'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { Locale } from './i18n';

const LocaleContext = createContext<Locale>('fa');

/** Gives shared widgets (the field help button) the page language without threading a prop. */
export function LocaleProvider({
  locale,
  children,
}: {
  readonly locale: Locale;
  readonly children: ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}
