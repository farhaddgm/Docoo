import { notFound } from 'next/navigation';

import { isLocale } from '../../../i18n';
import { SmartErrorsPage } from './smart-errors-page';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <SmartErrorsPage locale={locale} />;
}
