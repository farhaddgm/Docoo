import { notFound } from 'next/navigation';
import { ProblemPatternsScreen } from './problem-patterns-screen';

export default async function ProblemPatternsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceId: string }>;
}) {
  const { locale, workspaceId } = await params;
  if (
    (locale !== 'fa' && locale !== 'en') ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)
  )
    notFound();
  return <ProblemPatternsScreen locale={locale} workspaceId={workspaceId} />;
}
