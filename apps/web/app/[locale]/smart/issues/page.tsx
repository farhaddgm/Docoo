import { notFound } from 'next/navigation';

import { isLocale } from '../../../i18n';
import { SmartIssuesPage } from './smart-issues-page';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <SmartIssuesPage locale={locale} />;
}
