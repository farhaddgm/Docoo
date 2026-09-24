import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import '../globals.css';

export const metadata: Metadata = {
  title: 'Docoo Backoffice',
  description: 'Private AI-assisted product development workspace',
};

export function generateStaticParams() {
  return [{ locale: 'fa' }, { locale: 'en' }];
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  if (locale !== 'fa' && locale !== 'en') notFound();

  return (
    <html lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <body>{children}</body>
    </html>
  );
}
