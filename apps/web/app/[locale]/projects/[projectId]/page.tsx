import { notFound } from 'next/navigation';

import { isLocale } from '../../../i18n';
import { ProjectPage } from './project-page';

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string; projectId: string }>;
}) {
  const { locale, projectId } = await params;
  if (!isLocale(locale)) notFound();

  return <ProjectPage locale={locale} projectId={projectId} />;
}
