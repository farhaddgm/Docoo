import { notFound } from 'next/navigation';

import { isLocale } from '../../i18n';
import { SettingsPage } from './settings-page';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <SettingsPage locale={locale} />;
}
