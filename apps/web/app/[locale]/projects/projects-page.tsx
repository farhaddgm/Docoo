'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { apiGet, query } from '../../api-client';
import { formatDateTime, type Locale } from '../../i18n';
import { reportMessagesFor } from '../../report-messages';
import { WorkspacePage } from '../workspace-page';
import { projectMessages } from './messages';

export interface ProjectSummary {
  id: string;
  code: string;
  title: string;
  status: string;
  currentStage: string;
  updatedAt: string;
  topics: { topicId: string; title: string; priority: number }[];
}

const viewOrder = [
  'current',
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
  'deleted',
  'all',
] as const;
type View = (typeof viewOrder)[number];

export function ProjectsPage({ locale }: { locale: Locale }) {
  const text = projectMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <Projects locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

/** PRJ-001 in the backoffice: every project of the workspace with its status and stage. */
function Projects({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = projectMessages(locale);
  const common = reportMessagesFor(locale);
  const base = `/workspaces/${workspaceId}/projects`;
  const [view, setView] = useState<View>('current');
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (status: View, cursor?: string) => {
      const page = await apiGet<{ items: ProjectSummary[]; nextCursor: string | null }>(
        `${base}${query({ status, limit: '50', cursor })}`,
      );
      setItems((current) => (cursor && current ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    },
    [base],
  );

  useEffect(() => {
    setItems(null);
    setFailed(false);
    load(view).catch(() => setFailed(true));
  }, [view, load]);

  return (
    <div className="stack">
      <section className="card" aria-labelledby="project-list-title">
        <div className="toolbar spread">
          <h2 id="project-list-title">{text.list}</h2>
          <div className="toolbar">
            <label htmlFor="project-view">{text.view}</label>
            <select
              id="project-view"
              value={view}
              onChange={(event) => setView(event.target.value as View)}
            >
              {viewOrder.map((item) => (
                <option key={item} value={item}>
                  {text.views[item]}
                </option>
              ))}
            </select>
            <Link className="primary-button link-button" href={`/${locale}/projects/new` as Route}>
              {text.newProject}
            </Link>
          </div>
        </div>
        {failed ? (
          <p className="notice error" role="alert">
            {common.loadFailed}
          </p>
        ) : items === null ? (
          <p role="status">{common.loading}</p>
        ) : items.length === 0 ? (
          <>
            <p className="muted">{text.empty}</p>
            <p className="muted">{text.emptyHint}</p>
          </>
        ) : (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-labelledby="project-list-title"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">{text.code}</th>
                  <th scope="col">{text.projectTitle}</th>
                  <th scope="col">{text.topics}</th>
                  <th scope="col">{text.status}</th>
                  <th scope="col">{text.stage}</th>
                  <th scope="col">{text.updated}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((project) => (
                  <tr key={project.id}>
                    <th scope="row" dir="ltr">
                      <Link href={`/${locale}/projects/${project.id}` as Route}>
                        {project.code}
                      </Link>
                    </th>
                    <td dir="auto">{project.title}</td>
                    <td dir="auto">
                      {project.topics.length === 0
                        ? '—'
                        : project.topics.map((topic) => topic.title).join('، ')}
                    </td>
                    <td>
                      <span className={`badge state-${project.status}`}>
                        {text.statuses[project.status] ?? project.status}
                      </span>
                    </td>
                    <td>{text.stages[project.currentStage] ?? project.currentStage}</td>
                    <td>{formatDateTime(locale, project.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor && (
          <div className="toolbar">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void load(view, nextCursor).catch(() => setFailed(true))}
            >
              {text.loadMore}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
