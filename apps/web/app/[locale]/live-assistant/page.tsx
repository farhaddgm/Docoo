import { notFound } from 'next/navigation';

import { isLocale } from '../../i18n';
import { LiveAssistantPage } from './live-assistant-page';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <LiveAssistantPage locale={locale} />;
}
