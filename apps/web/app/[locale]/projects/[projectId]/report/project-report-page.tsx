'use client';

import { ProjectAccessBoundary } from '../../../resource-access';
import { WorkspacePage } from '../../../workspace-page';
import type { Locale } from '../../../../i18n';
import { projectReportMessages } from './report-messages';
import { ProjectReportScreen } from './project-report-screen';

export function ProjectReportPage({ locale, projectId }: { locale: Locale; projectId: string }) {
  const text = projectReportMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => (
        <ProjectAccessBoundary projectId={projectId} workspaceId={workspaceId}>
          <ProjectReportScreen locale={locale} projectId={projectId} workspaceId={workspaceId} />
        </ProjectAccessBoundary>
      )}
    </WorkspacePage>
  );
}
