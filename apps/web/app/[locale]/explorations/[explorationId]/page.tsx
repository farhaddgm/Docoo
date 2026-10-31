import { notFound } from 'next/navigation';

import { isLocale } from '../../../i18n';
import { ExplorationPage } from './exploration-page';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; explorationId: string }>;
}) {
  const { locale, explorationId } = await params;
  if (!isLocale(locale)) notFound();

  return <ExplorationPage locale={locale} explorationId={explorationId} />;
}
