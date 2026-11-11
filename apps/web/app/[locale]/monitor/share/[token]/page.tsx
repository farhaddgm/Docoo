import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isLocale } from '../../../../i18n';
import { ShareWindow } from '../../../../monitor/share-window';

// The address is the secret of the link: no indexing and no referrer.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  if (!isLocale(locale) || !/^[A-Za-z0-9_-]{43}$/u.test(token)) notFound();

  return <ShareWindow locale={locale} token={token} />;
}
