'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';

import { apiSend } from '../../../api-client';
import type { Locale } from '../../../i18n';
import { Notice, useAction } from '../../use-action';
import { WorkspacePage } from '../../workspace-page';
import { explainProject } from '../explain';
import { projectMessages } from '../messages';
import { emptyProject, ProjectForm } from '../project-form';

export function NewProjectPage({ locale }: { locale: Locale }) {
  const text = projectMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.newTitle} subtitle={text.newSubtitle}>
      {(workspaceId) => <NewProject locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

/** PRJ-001: create a draft project; activation happens on its own page. */
function NewProject({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = projectMessages(locale);
  const router = useRouter();
  const explain = useCallback((error: unknown) => explainProject(error, text), [text]);
  const { busy, notice, run } = useAction(explain);

  return (
    <div className="stack">
      <p>
        <Link href={`/${locale}/projects` as Route}>{text.backToList}</Link>
      </p>
      <Notice notice={notice} />
      <ProjectForm
        locale={locale}
        workspaceId={workspaceId}
        mode="create"
        initial={emptyProject(locale)}
        busy={busy}
        onCreate={(values) =>
          void run(async () => {
            const body = {
              code: values.code,
              title: values.title,
              description: values.description,
              initialProblem: values.initialProblem,
              outputLanguage: values.outputLanguage,
              topics: values.topics.map((topic) => ({
                topicId: topic.topicId,
                ...(topic.conflictInstruction
                  ? { conflictInstruction: topic.conflictInstruction }
                  : {}),
              })),
            };
            const { project } = await apiSend<{ project: { id: string } }>(
              'POST',
              `/workspaces/${workspaceId}/projects`,
              body,
            );
            router.push(`/${locale}/projects/${project.id}` as Route);
          }, text.created)
        }
      />
    </div>
  );
}
