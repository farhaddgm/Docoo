import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';

import '@fontsource-variable/vazirmatn/wght.css';

import '../globals.css';
import { direction, isLocale } from '../i18n';
import { themeInitScript } from '../theme';

export const metadata: Metadata = {
  title: 'Docoo Backoffice',
  description: 'Private AI-assisted product development workspace',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0f14' },
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
      <body>{children}</body>
    </html>
  );
}
