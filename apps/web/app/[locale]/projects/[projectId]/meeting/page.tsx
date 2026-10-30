import { notFound } from 'next/navigation';
import { ProjectAccessBoundary } from '../../../resource-access';
import { MeetingScreen } from './meeting-screen';
export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; projectId: string }>;
  searchParams: Promise<{ workspaceId?: string }>;
}) {
  const [{ locale, projectId }, { workspaceId }] = await Promise.all([params, searchParams]);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    (locale !== 'fa' && locale !== 'en') ||
    !uuid.test(projectId) ||
    !workspaceId ||
    !uuid.test(workspaceId)
  )
    notFound();
  return (
    <ProjectAccessBoundary projectId={projectId} workspaceId={workspaceId}>
      <MeetingScreen locale={locale} projectId={projectId} workspaceId={workspaceId} />
    </ProjectAccessBoundary>
  );
}
