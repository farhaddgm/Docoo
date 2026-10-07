'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiSend, ApiError } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { Notice, useAction } from '../../use-action';
import { ProjectAccessBoundary, useReadOnlyAccess } from '../../resource-access';
import { useSessionIdentity } from '../../signed-in';
import { WorkspacePage } from '../../workspace-page';
import { explainProject } from '../explain';
import { projectMessages } from '../messages';
import { projectPageMessages } from './messages';
import { healthMessages } from './health-messages';
import { HealthBadge, HealthReasons, MilestoneCard } from './health-view';
import { projectHealth, projectMilestone, type WorkflowFacts } from './project-health';
import { AgentsPanel } from './agents-panel';
import { BusinessPanel } from './business-panel';
import { DocumentsPanel } from './documents-panel';
import { KnowledgePanel } from './knowledge-panel';
import { OverviewPanel } from './overview-panel';
import { ProblemPanel } from './problem-panel';
import type { ProjectDetail } from './project-types';
import { SolutionsPanel } from './solutions-panel';
import { TimelinePanel } from './timeline-panel';
import { WorkflowPanel } from './workflow-panel';
import { ProjectSettingsPanel } from './settings-panel';

const tabs = [
  'overview',
  'business',
  'problem',
  'workflow',
  'solutions',
  'documents',
  'knowledge',
  'agents',
  'settings',
  'timeline',
] as const;
type Tab = (typeof tabs)[number];

const isTab = (value: string | null): value is Tab => tabs.some((tab) => tab === value);

export function ProjectPage({ locale, projectId }: { locale: Locale; projectId: string }) {
  const text = projectPageMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.pageTitle} subtitle={text.pageSubtitle}>
      {(workspaceId) => (
        <ProjectAccessBoundary projectId={projectId} workspaceId={workspaceId}>
          <ProjectView locale={locale} workspaceId={workspaceId} projectId={projectId} />
        </ProjectAccessBoundary>
      )}
    </WorkspacePage>
  );
}

type Load = 'loading' | 'ready' | 'missing' | 'failed';

/** One project: status bar, lifecycle actions and its sections (PRJ-001, WF-001..006). */
function ProjectView({
  locale,
  workspaceId,
  projectId,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
}) {
  const text = projectPageMessages(locale);
  const accessReadOnly = useReadOnlyAccess();
  const common = reportMessagesFor(locale);
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [load, setLoad] = useState<Load>('loading');
  const [tab, setTab] = useState<Tab>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  // What the header's health and the overview's milestone are drawn from; null if unreadable.
  const [facts, setFacts] = useState<WorkflowFacts | null>(null);

  const reload = useCallback(async () => {
    try {
      const [{ project: loaded }, flow] = await Promise.all([
        apiGet<{ project: ProjectDetail }>(base),
        apiGet<{ workflow: WorkflowFacts }>(`${base}/workflow`).then(
          (result) => result.workflow,
          () => null,
        ),
      ]);
      setProject(loaded);
      setFacts(flow);
      setLoad('ready');
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        setLoad('missing');
      } else {
        setLoad((current) => (current === 'ready' ? current : 'failed'));
      }
    }
  }, [base]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // The requested section survives a reload and can be linked to (`?tab=workflow`).
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('tab');
    if (isTab(requested)) setTab(requested);
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(location.href);
    url.searchParams.set('tab', next);
    history.replaceState(null, '', url);
  }

  /** Called when something else on the page may have changed the project or its workflow. */
  const changed = useCallback(() => {
    void reload();
    setRefreshKey((key) => key + 1);
  }, [reload]);

  if (load === 'loading') return <p role="status">{common.loading}</p>;
  if (load === 'failed') {
    return (
      <p className="notice error" role="alert">
        {common.loadFailed}
      </p>
    );
  }
  if (load === 'missing' || !project) {
    return (
      <div className="stack">
        <p className="notice error" role="alert">
          {text.notFound}
        </p>
        <p>
          <Link href={`/${locale}/projects` as Route}>{text.backToList}</Link>
        </p>
      </div>
    );
  }

  const health = projectHealth(project, facts);
  const milestone = projectMilestone(project.status, facts);

  return (
    <div className={accessReadOnly ? 'stack resource-view-only' : 'stack'}>
      <p>
        <Link href={`/${locale}/projects` as Route}>{text.backToList}</Link>
      </p>

      <section className="card" aria-labelledby="project-heading">
        <h2 id="project-heading" dir="auto">
          <span dir="ltr">{project.code}</span> — {project.title}
        </h2>
        <dl className="facts">
          <div>
            <dt>{text.status}</dt>
            <dd>
              <span className={`badge state-${project.status}`}>
                {text.statuses[project.status] ?? project.status}
              </span>
            </dd>
          </div>
          <div>
            <dt>{healthMessages(locale).label}</dt>
            <dd>
              <HealthBadge locale={locale} health={health} />
            </dd>
          </div>
          <div>
            <dt>{text.business}</dt>
            <dd dir="auto">
              {project.business ? (
                <button type="button" className="link-button" onClick={() => choose('business')}>
                  {project.business.name}
                </button>
              ) : (
                text.noBusiness
              )}
            </dd>
          </div>
          <div>
            <dt>{text.stage}</dt>
            <dd>{text.stages[project.currentStage] ?? project.currentStage}</dd>
          </div>
          <div>
            <dt>{text.language}</dt>
            <dd>{text.languages[project.outputLanguage] ?? project.outputLanguage}</dd>
          </div>
          <div>
            <dt>{text.version}</dt>
            <dd>{formatNumber(locale, project.version)}</dd>
          </div>
          <div>
            <dt>{text.updated}</dt>
            <dd>{formatDateTime(locale, project.updatedAt)}</dd>
          </div>
          {project.status === 'deleted' && project.purgeAfter && (
            <div>
              <dt>{text.deletedUntil}</dt>
              <dd>{formatDateTime(locale, project.purgeAfter)}</dd>
            </div>
          )}
        </dl>
        <p>
          <strong>{text.nextAction}:</strong> {text.nextActions[project.nextAction] ?? ''}
        </p>
        {project.pauseReason && (
          <p className="notice error" role="status">
            <strong>{text.pauseReason}:</strong> <span dir="auto">{project.pauseReason}</span>
          </p>
        )}
        {health.reasons.some((reason) => reason.code !== 'paused') && (
          <HealthReasons
            locale={locale}
            health={{
              ...health,
              // The pause itself is already written out above, with its reason.
              reasons: health.reasons.filter((reason) => reason.code !== 'paused'),
            }}
            onOpenWorkflow={() => choose('workflow')}
          />
        )}
        {!accessReadOnly && (
          <Lifecycle
            locale={locale}
            base={base}
            project={project}
            onChanged={(next) => {
              setProject(next);
              changed();
            }}
          />
        )}
      </section>

      <nav className="section-nav" aria-label={text.sections}>
        <ul>
          {tabs.map((item) => (
            <li key={item}>
              <button
                type="button"
                aria-current={tab === item ? 'page' : undefined}
                onClick={() => choose(item)}
              >
                {text.tabs[item]}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'overview' && (
        <MilestoneCard locale={locale} milestone={milestone} stages={facts?.stages ?? []} />
      )}
      {tab === 'overview' && (
        <OverviewPanel
          locale={locale}
          workspaceId={workspaceId}
          project={project}
          onChanged={(next) => {
            setProject(next);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}
      {tab === 'business' && (
        <BusinessPanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          readOnly={accessReadOnly || project.status === 'archived' || project.status === 'deleted'}
          refreshKey={refreshKey}
          onChanged={reload}
        />
      )}
      {tab === 'problem' && (
        <ProblemPanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          projectStatus={project.status}
          refreshKey={refreshKey}
          onChanged={changed}
        />
      )}
      {tab === 'workflow' && (
        <WorkflowPanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          projectStatus={project.status}
          refreshKey={refreshKey}
          onProjectRefresh={reload}
        />
      )}
      {tab === 'solutions' && (
        <SolutionsPanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          readOnly={accessReadOnly || project.status === 'archived' || project.status === 'deleted'}
          onChanged={changed}
        />
      )}
      {tab === 'documents' && (
        <DocumentsPanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'knowledge' && (
        <KnowledgePanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          readOnly={accessReadOnly || project.status === 'archived' || project.status === 'deleted'}
        />
      )}
      {tab === 'agents' && (
        <AgentsPanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          readOnly={accessReadOnly || project.status === 'archived' || project.status === 'deleted'}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'settings' && (
        <ProjectSettingsPanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          readOnly={accessReadOnly || project.status === 'archived' || project.status === 'deleted'}
        />
      )}
      {tab === 'timeline' && (
        <TimelinePanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          refreshKey={refreshKey}
        />
      )}
    </div>
  );
}

/** Commands that need a reason, or a visible confirmation of their effect, before they run. */
const reasonRequired = new Set(['pause', 'complete', 'reopen']);
const needsConfirmation = new Set(['pause', 'complete', 'reopen', 'archive', 'delete']);
const destructive = new Set(['archive', 'delete']);

function Lifecycle({
  locale,
  base,
  project,
  onChanged,
}: {
  locale: Locale;
  base: string;
  project: ProjectDetail;
  onChanged: (project: ProjectDetail) => void;
}) {
  const text = projectPageMessages(locale);
  const formText = projectMessages(locale);
  const [pending, setPending] = useState<{ command: string; reason: string } | null>(null);
  const explain = useCallback((error: unknown) => explainProject(error, formText), [formText]);
  const { busy, notice, setNotice, run } = useAction(explain);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (pending) heading.current?.focus();
  }, [pending?.command]);

  function execute(command: string, reason: string) {
    const body = {
      expectedVersion: project.version,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    void run(async () => {
      const result =
        command === 'delete'
          ? await apiSend<{ project: ProjectDetail }>('DELETE', base, body)
          : await apiSend<{ project: ProjectDetail }>('POST', `${base}/${command}`, body);
      setPending(null);
      onChanged(result.project);
    }, text.done[command] ?? formText.saved);
  }

  function choose(command: string) {
    setNotice(null);
    if (needsConfirmation.has(command)) setPending({ command, reason: '' });
    else execute(command, '');
  }

  const identity = useSessionIdentity();
  const commands = project.availableCommands.filter(
    (command) => command !== 'delete' || identity?.user.role === 'super_admin',
  );
  if (commands.length === 0) return <Notice notice={notice} />;

  return (
    <div className="stack">
      <Notice notice={notice} />
      <div className="toolbar" role="group" aria-label={text.lifecycle}>
        {commands.map((command) => (
          <button
            key={command}
            className={
              command === 'activate' || command === 'resume' || command === 'restore'
                ? 'primary-button'
                : destructive.has(command)
                  ? 'secondary-button danger'
                  : 'secondary-button'
            }
            type="button"
            disabled={busy}
            aria-expanded={
              needsConfirmation.has(command) ? pending?.command === command : undefined
            }
            onClick={() => choose(command)}
          >
            {text.commands[command] ?? command}
          </button>
        ))}
      </div>
      {pending && (
        <form
          data-write-action
          className="card confirm-panel filter-form"
          aria-labelledby="command-title"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            execute(pending.command, pending.reason);
          }}
        >
          <h3 id="command-title" tabIndex={-1} ref={heading}>
            {text.commandTitle
              .replace('{command}', text.commands[pending.command] ?? pending.command)
              .replace('{title}', project.title)}
          </h3>
          <p>{text.effects[pending.command] ?? ''}</p>
          <div className="filter-grid">
            <label htmlFor="command-reason">
              {reasonRequired.has(pending.command) ? text.reasonRequired : text.reasonOptional}
            </label>
            <input
              id="command-reason"
              value={pending.reason}
              maxLength={1000}
              onChange={(event) => setPending({ ...pending, reason: event.target.value })}
              required={reasonRequired.has(pending.command)}
              autoComplete="off"
            />
          </div>
          <div className="toolbar">
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? text.working : text.confirm}
            </button>
            <button
              data-write-action
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              {text.cancel}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
