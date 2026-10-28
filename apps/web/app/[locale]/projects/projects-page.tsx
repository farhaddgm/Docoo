'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiSend, query } from '../../api-client';
import { formatDateTime, type Locale, textDir } from '../../i18n';
import { reportMessagesFor } from '../../report-messages';
import { canCreateProjects } from '../access';
import { useSessionIdentity } from '../signed-in';
import { WorkspacePage } from '../workspace-page';
import { Notice, useAction } from '../use-action';
import { ReasonBar } from '../reason-bar';
import { explainProject } from './explain';
import { projectMessages } from './messages';
import { projectPageMessages } from './[projectId]/messages';
import { ProjectRowMenu, type RowCommand } from './project-row-menu';
import { PagedRows } from '../../table-pager';

export interface ProjectSummary {
  id: string;
  code: string;
  title: string;
  status: string;
  version: number;
  availableCommands: string[];
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
}

const noFilters: Filters = { q: '', topicId: '', language: '', from: '', to: '' };

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

/** A single-line cell; what does not fit ends in an ellipsis and the whole text shows on hover. */
function ClippedCell({ value, dir }: { value: string; dir?: 'rtl' | 'ltr' | 'auto' }) {
  return (
    <td className="clipped-cell" title={value} {...(dir ? { dir } : {})}>
      {value}
    </td>
  );
}

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
  const identity = useSessionIdentity();
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
  const pageText = projectPageMessages(locale);
  const [pending, setPending] = useState<{
    project: ProjectSummary;
    command: RowCommand;
    reason: string;
  } | null>(null);
  const explain = useCallback((error: unknown) => explainProject(error, text), [text]);
  const { busy, notice, setNotice, run } = useAction(explain);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  // Delete is the platform administrator's; archive is offered with it, as on the project page.
  const isAdmin = identity?.user.role === 'super_admin';

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

  useEffect(() => {
    if (pending) confirmHeading.current?.focus();
  }, [pending?.project.id, pending?.command]);

  function execute(target: NonNullable<typeof pending>) {
    const reason = target.reason.trim();
    const body = { expectedVersion: target.project.version, ...(reason ? { reason } : {}) };
    const base = `/workspaces/${workspaceId}/projects/${target.project.id}`;
    void run(async () => {
      if (target.command === 'delete') await apiSend('DELETE', base, body);
      else await apiSend('POST', `${base}/${target.command}`, body);
      setPending(null);
      // The row leaves or changes in this view; the list is read again from its first page.
      await load(view, applied);
    }, pageText.done[target.command] ?? text.saved);
  }

  const filtered = JSON.stringify(applied) !== JSON.stringify(noFilters);

  return (
    <div className="stack">
      <section className="card" aria-labelledby="project-list-title">
        <div className="toolbar spread">
          <h2 id="project-list-title">{text.list}</h2>
          <div className="toolbar">
            {canCreateProjects(identity) && (
              <Link
                className="primary-button link-button"
                href={`/${locale}/projects/new` as Route}
              >
                {text.newProject}
              </Link>
            )}
          </div>
        </div>
        <form
          className="filter-grid filters-row project-filters"
          aria-label={text.filters}
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="field">
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
          </div>
          <div className="field">
            <label htmlFor="project-search">{text.searchLabel}</label>
            <input
              id="project-search"
              type="search"
              dir={textDir(locale)}
              value={filters.q}
              maxLength={100}
              onChange={(event) => setFilters({ ...filters, q: event.target.value })}
            />
          </div>
          <div className="field">
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
          </div>
          <div className="field">
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
          </div>
          <div className="field">
            <label htmlFor="project-from">{text.fromLabel}</label>
            <input
              id="project-from"
              type="date"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="project-to">{text.toLabel}</label>
            <input
              id="project-to"
              type="date"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </div>
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
        <Notice notice={notice} />
        {pending && (
          <form
            data-write-action
            className="card confirm-panel filter-form"
            aria-labelledby="row-command-title"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              execute(pending);
            }}
          >
            <h3 id="row-command-title" tabIndex={-1} ref={confirmHeading}>
              {pageText.commandTitle
                .replace('{command}', pageText.commands[pending.command] ?? pending.command)
                .replace('{title}', pending.project.title)}
            </h3>
            <p>{pageText.effects[pending.command] ?? ''}</p>
            <ReasonBar
              locale={locale}
              id="row-command-reason"
              label={pageText.reasonOptional}
              value={pending.reason}
              onChange={(reason) => setPending({ ...pending, reason })}
            >
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? pageText.working : pageText.confirm}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setPending(null)}
              >
                {pageText.cancel}
              </button>
            </ReasonBar>
          </form>
        )}
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
          <PagedRows rows={items}>
            {(pageRows) => (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-labelledby="project-list-title"
              >
                <table className="project-table">
                  <colgroup>
                    <col className="col-code" />
                    <col className="col-title" />
                    <col className="col-business" />
                    <col className="col-status" />
                    <col className="col-stage" />
                    <col className="col-owner" />
                    <col className="col-updated" />
                    {isAdmin && <col className="col-actions" />}
                  </colgroup>
                  <thead>
                    <tr>
                      <th scope="col">{text.code}</th>
                      <th scope="col">{text.projectTitle}</th>
                      <th scope="col">{text.business}</th>
                      <th scope="col">{text.status}</th>
                      <th scope="col">{text.stage}</th>
                      <th scope="col">{text.owner}</th>
                      <th scope="col">{text.updated}</th>
                      {isAdmin && (
                        <th scope="col">
                          <span className="sr-only">{text.rowActions}</span>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((project) => (
                      <tr key={project.id}>
                        <th scope="row" dir="ltr">
                          <Link href={`/${locale}/projects/${project.id}` as Route}>
                            {project.code}
                          </Link>
                        </th>
                        <ClippedCell dir={textDir(locale)} value={project.title} />
                        <ClippedCell dir={textDir(locale)} value={project.business?.name ?? '—'} />
                        <td>
                          <span className={`badge state-${project.status}`}>
                            {text.statuses[project.status] ?? project.status}
                          </span>
                        </td>
                        <td>{text.stages[project.currentStage] ?? project.currentStage}</td>
                        <ClippedCell
                          dir={textDir(locale)}
                          value={project.owner?.displayName ?? '—'}
                        />
                        <ClippedCell value={formatDateTime(locale, project.updatedAt)} />
                        {isAdmin && (
                          <td className="row-actions-cell">
                            <ProjectRowMenu
                              locale={locale}
                              label={text.rowActionsFor.replace('{code}', project.code)}
                              labels={pageText.commands}
                              disabled={busy}
                              commands={(['archive', 'delete'] as const).filter((command) =>
                                project.availableCommands.includes(command),
                              )}
                              onChoose={(command) => {
                                setNotice(null);
                                setPending({ project, command, reason: '' });
                              }}
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PagedRows>
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
