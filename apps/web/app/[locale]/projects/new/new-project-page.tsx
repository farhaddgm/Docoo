'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { Locale } from '../../../i18n';
import { WorkspacePage } from '../../workspace-page';
import { canCreateProjects } from '../../access';
import { useSessionIdentity } from '../../signed-in';
import { projectMessages } from '../messages';
import { ProjectWizard } from './project-wizard';

export function NewProjectPage({ locale }: { locale: Locale }) {
  const text = projectMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.newTitle} subtitle={text.newSubtitle}>
      {(workspaceId) => <NewProject locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

/** PRJ-001 (UX §5): create a draft project in steps; activation happens on its own page. */
function NewProject({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = projectMessages(locale);
  const router = useRouter();
  const identity = useSessionIdentity();
  if (!canCreateProjects(identity))
    return (
      <p role="alert">
        {identity?.user.role === 'viewer'
          ? locale === 'fa'
            ? 'نقش مشاهده‌گر اجازهٔ ساخت پروژه ندارد.'
            : 'Viewers cannot create projects.'
          : locale === 'fa'
            ? 'این حساب اجازهٔ ساخت پروژه ندارد. از مالک بخواهید آن را فعال کند.'
            : 'This account may not create projects. Ask the owner to allow it.'}
      </p>
    );

  return (
    <div className="stack">
      <p>
        <Link className="back-link" href={`/${locale}/projects` as Route}>
          {text.backToList}
        </Link>
      </p>
      <ProjectWizard
        key={workspaceId}
        locale={locale}
        workspaceId={workspaceId}
        onCreated={(projectId) => router.push(`/${locale}/projects/${projectId}` as Route)}
      />
    </div>
  );
}
