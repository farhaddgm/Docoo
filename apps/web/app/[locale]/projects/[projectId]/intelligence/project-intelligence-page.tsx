'use client';
import { WorkspacePage } from '../../../workspace-page';
import { ProjectAccessBoundary } from '../../../resource-access';
import { ProjectIntelligenceScreen } from './project-intelligence-screen';
export function ProjectIntelligencePage({
  locale,
  projectId,
}: {
  locale: 'fa' | 'en';
  projectId: string;
}) {
  return (
    <WorkspacePage
      locale={locale}
      title={locale === 'fa' ? 'شواهد و تصمیم' : 'Evidence and decisions'}
      subtitle={
        locale === 'fa'
          ? 'شواهد، تعارض‌ها و پژوهش پروژه'
          : 'Project evidence, conflicts and research'
      }
    >
      {(workspaceId) => (
        <ProjectAccessBoundary projectId={projectId} workspaceId={workspaceId}>
          <ProjectIntelligenceScreen
            locale={locale}
            projectId={projectId}
            workspaceId={workspaceId}
          />
        </ProjectAccessBoundary>
      )}
    </WorkspacePage>
  );
}
