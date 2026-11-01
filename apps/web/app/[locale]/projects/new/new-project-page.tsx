'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { apiGet } from '../../../api-client';
import type { Locale } from '../../../i18n';
import { WorkspacePage } from '../../workspace-page';
import { canCreateProjects } from '../../access';
import { useSessionIdentity } from '../../signed-in';
import { projectMessages } from '../messages';
import { ProjectWizard } from './project-wizard';
import { dimensionSeed, type CandidateSeed } from './wizard-model';
import { wizardMessages } from './wizard-messages';

export function NewProjectPage({ locale }: { locale: Locale }) {
  const text = projectMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.newTitle} subtitle={text.newSubtitle}>
      {(workspaceId) => (
        // The address may name the candidate problem the project is made from, which needs the
        // search parameters; reading them is what the boundary is for.
        <Suspense fallback={<p role="status">…</p>}>
          <NewProject locale={locale} workspaceId={workspaceId} />
        </Suspense>
      )}
    </WorkspacePage>
  );
}

type SeedState =
  | { status: 'loading' }
  | {
      status: 'ready';
      seed: CandidateSeed | null;
      problem: 'failed' | 'missing' | 'unselected' | null;
    };

/**
 * `?dimensionProject=…&dimension=…` makes the project from a selected dimension of an exploration
 * (ADR-0045): its title and draft problem statement fill the first step. If it cannot be read or
 * is not selected, the page says so and the wizard works as it always did.
 */
function useDimensionSeed(workspaceId: string): SeedState {
  const params = useSearchParams();
  const dimensionProject = params.get('dimensionProject');
  const dimensionId = params.get('dimension');
  const wanted = Boolean(dimensionProject && dimensionId);
  const [state, setState] = useState<SeedState>(
    wanted ? { status: 'loading' } : { status: 'ready', seed: null, problem: null },
  );

  useEffect(() => {
    if (dimensionProject && dimensionId) {
      let current = true;
      setState({ status: 'loading' });
      Promise.all([
        apiGet<{ project: { id: string; title: string; outputLanguage: 'fa' | 'en' } }>(
          `/workspaces/${workspaceId}/projects/${dimensionProject}`,
        ),
        apiGet<{
          solutionSet: {
            items: {
              id: string;
              title: string;
              summary: string;
              selectedPriority: number | null;
            }[];
          } | null;
        }>(`/workspaces/${workspaceId}/projects/${dimensionProject}/solutions`),
      ])
        .then(([project, solutions]) => {
          if (!current) return;
          const { seed, reason } = dimensionSeed(
            project.project,
            solutions.solutionSet?.items ?? [],
            dimensionId,
          );
          setState({ status: 'ready', seed, problem: reason });
        })
        .catch(() => {
          if (current) setState({ status: 'ready', seed: null, problem: 'failed' });
        });
      return () => {
        current = false;
      };
    }
    setState({ status: 'ready', seed: null, problem: null });
    return undefined;
  }, [workspaceId, dimensionProject, dimensionId]);

  return state;
}

/** PRJ-001 (UX §5): create a draft project in steps; activation happens on its own page. */
function NewProject({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = projectMessages(locale);
  const wizard = wizardMessages(locale);
  const router = useRouter();
  const identity = useSessionIdentity();
  const seedState = useDimensionSeed(workspaceId);
  const params = useSearchParams();
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

  if (seedState.status === 'loading') return <p role="status">{wizard.seedLoading}</p>;

  return (
    <div className="stack">
      <p>
        <Link className="back-link" href={`/${locale}/projects` as Route}>
          {text.backToList}
        </Link>
      </p>
      {seedState.problem && (
        <p className="notice warn" role="status">
          {seedState.problem === 'unselected'
            ? wizard.seedUnselected
            : seedState.problem === 'missing'
              ? wizard.seedMissing
              : wizard.seedFailed}
        </p>
      )}
      <ProjectWizard
        // A different candidate is a different start, not an edit of this one.
        key={`${workspaceId}:${seedState.seed?.candidateKey ?? ''}:${params.get('kind') ?? ''}`}
        locale={locale}
        workspaceId={workspaceId}
        seed={seedState.seed}
        kind={params.get('kind') === 'exploration' ? 'exploration' : 'standard'}
        onCreated={(projectId) => router.push(`/${locale}/projects/${projectId}` as Route)}
      />
    </div>
  );
}
