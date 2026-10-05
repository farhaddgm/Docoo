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
  outputLanguage: 'fa' | 'en';
  updatedAt: string;
  topics: { topicId: string; title: string; priority: number }[];
  owner: { id: string; displayName: string } | null;
  business?: { externalBusinessId: string; name: string } | null;
  waiting: { kind: string; stage: string | null } | null;
}

interface Filters {
  q: string;
  topicId: string;
  language: string;
  from: string;
  to: string;
  waiting: boolean;
}

const noFilters: Filters = { q: '', topicId: '', language: '', from: '', to: '', waiting: false };

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
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [applied, setApplied] = useState<Filters>(noFilters);
  const [topics, setTopics] = useState<{ id: string; title: string }[]>([]);
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (status: View, filter: Filters, cursor?: string) => {
      const page = await apiGet<{ items: ProjectSummary[]; nextCursor: string | null }>(
        `${base}${query({
          status,
          limit: '50',
          cursor,
          q: filter.q.trim() || undefined,
          topicId: filter.topicId || undefined,
          language: filter.language || undefined,
          updatedFrom: filter.from || undefined,
          updatedTo: filter.to || undefined,
          waiting: filter.waiting ? 'true' : undefined,
        })}`,
      );
      setItems((current) => (cursor && current ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    },
    [base],
  );

  useEffect(() => {
    setItems(null);
    setFailed(false);
    load(view, applied).catch(() => setFailed(true));
  }, [view, applied, load]);

  useEffect(() => {
    apiGet<{ items: { id: string; title: string }[] }>(
      `/workspaces/${workspaceId}/topics?limit=100`,
    )
      .then((result) => setTopics(result.items))
      .catch(() => undefined);
  }, [workspaceId]);

  // Typing in the search box waits for a pause; the other filters apply at once.
  useEffect(() => {
    const handle = setTimeout(() => setApplied(filters), filters.q === applied.q ? 0 : 400);
    return () => clearTimeout(handle);
  }, [filters, applied.q]);

  const filtered = JSON.stringify(applied) !== JSON.stringify(noFilters);

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
        <form
          className="filter-grid project-filters"
          aria-label={text.filters}
          onSubmit={(event) => event.preventDefault()}
        >
          <label htmlFor="project-search">{text.searchLabel}</label>
          <input
            id="project-search"
            type="search"
            dir="auto"
            value={filters.q}
            maxLength={100}
            onChange={(event) => setFilters({ ...filters, q: event.target.value })}
          />
          <label htmlFor="project-topic">{text.topicFilter}</label>
          <select
            id="project-topic"
            value={filters.topicId}
            onChange={(event) => setFilters({ ...filters, topicId: event.target.value })}
          >
            <option value="">{text.anyTopic}</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.title}
              </option>
            ))}
          </select>
          <label htmlFor="project-language">{text.languageFilter}</label>
          <select
            id="project-language"
            value={filters.language}
            onChange={(event) => setFilters({ ...filters, language: event.target.value })}
          >
            <option value="">{text.anyLanguage}</option>
            <option value="fa">{text.languages.fa}</option>
            <option value="en">{text.languages.en}</option>
          </select>
          <label htmlFor="project-from">{text.fromLabel}</label>
          <input
            id="project-from"
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={(event) => setFilters({ ...filters, from: event.target.value })}
          />
          <label htmlFor="project-to">{text.toLabel}</label>
          <input
            id="project-to"
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={(event) => setFilters({ ...filters, to: event.target.value })}
          />
          <span />
          <label className="checkbox" htmlFor="project-waiting">
            <input
              id="project-waiting"
              type="checkbox"
              checked={filters.waiting}
              onChange={(event) => setFilters({ ...filters, waiting: event.target.checked })}
            />{' '}
            {text.waitingOnly}
          </label>
          {filtered && (
            <>
              <span />
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setFilters(noFilters);
                  setApplied(noFilters);
                }}
              >
                {text.clearFilters}
              </button>
            </>
          )}
        </form>
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
                  <th scope="col">{text.business}</th>
                  <th scope="col">{text.status}</th>
                  <th scope="col">{text.stage}</th>
                  <th scope="col">{text.waiting}</th>
                  <th scope="col">{text.language}</th>
                  <th scope="col">{text.owner}</th>
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
                    <td dir="auto">{project.business?.name ?? '—'}</td>
                    <td>
                      <span className={`badge state-${project.status}`}>
                        {text.statuses[project.status] ?? project.status}
                      </span>
                    </td>
                    <td>{text.stages[project.currentStage] ?? project.currentStage}</td>
                    <td>
                      {project.waiting ? (
                        <span className="badge state-waiting_for_human">
                          {text.waitingKinds[project.waiting.kind] ?? text.waitingOther}
                        </span>
                      ) : (
                        text.noneWaiting
                      )}
                    </td>
                    <td>{text.languages[project.outputLanguage]}</td>
                    <td dir="auto">{project.owner?.displayName ?? '—'}</td>
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
              onClick={() => void load(view, applied, nextCursor).catch(() => setFailed(true))}
            >
              {text.loadMore}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
