import { notFound } from 'next/navigation';

import { isLocale } from '../../i18n';
import { ProjectsPage } from '../projects/projects-page';

// The explorations are the projects of kind exploration (ADR-0045 step F).
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <ProjectsPage locale={locale} kind="exploration" />;
}
