import { notFound } from 'next/navigation';
import { EvaluationLabPageShell } from './evaluation-lab-screen';
import './evaluation-lab.css';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function EvaluationLabPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const [{ locale, projectId }, { workspaceId }] = await Promise.all([params, searchParams]);
  if (
    (locale !== 'fa' && locale !== 'en') ||
    !uuid.test(projectId) ||
    typeof workspaceId !== 'string' ||
    !uuid.test(workspaceId)
  )
    notFound();
  return <EvaluationLabPageShell locale={locale} projectId={projectId} workspaceId={workspaceId} />;
}
