import { notFound } from 'next/navigation';

import { isLocale } from '../../../i18n';
import { KnowledgeDetailPage } from '../knowledge-detail-page';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; knowledgeId: string }>;
}) {
  const { locale, knowledgeId } = await params;
  if (!isLocale(locale)) notFound();

  return <KnowledgeDetailPage locale={locale} knowledgeId={knowledgeId} />;
}
