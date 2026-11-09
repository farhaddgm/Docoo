import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { isLocale } from '../../../i18n';
import { MonitorWindow } from '../../../monitor/monitor-window';

// A monitor window is a private page for a room screen: no indexing, no referrer.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <MonitorWindow locale={locale} kind="voice" />;
}
