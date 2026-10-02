import { notFound } from 'next/navigation';

import { isLocale } from '../i18n';
import { AuthShell } from './auth-shell';

export default async function Dashboard({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <AuthShell locale={locale} />;
}
