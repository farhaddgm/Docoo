import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import '@fontsource-variable/vazirmatn/wght.css';

import '../globals.css';
import { InfoTipHost } from '../info-tip';
import { direction, isLocale } from '../i18n';
import { LocaleProvider } from '../locale-context';
import { themeInitScript } from '../theme';

export const metadata: Metadata = {
  title: 'Docoo Backoffice',
  description: 'Private AI-assisted product development workspace',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f8fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1522' },
  ],
};

export function generateStaticParams() {
  return [{ locale: 'fa' }, { locale: 'en' }];
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ locale: string }> }>) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    // The theme script sets data-theme on <html> before React hydrates it.
    <html lang={locale} dir={direction(locale)} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <LocaleProvider locale={locale}>
          {children}
          <InfoTipHost />
        </LocaleProvider>
      </body>
    </html>
  );
}
