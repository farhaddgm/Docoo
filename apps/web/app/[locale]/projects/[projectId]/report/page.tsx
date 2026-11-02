import { notFound } from 'next/navigation';

import { isLocale } from '../../../../i18n';
import { ProjectReportPage } from './project-report-page';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  if (!isLocale(locale)) notFound();
  return <ProjectReportPage locale={locale} projectId={projectId} />;
}
