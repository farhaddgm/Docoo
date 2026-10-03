import { notFound } from 'next/navigation';

import { isLocale } from '../../i18n';
import { CostReport } from './cost-report';

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <CostReport locale={locale} />;
}
