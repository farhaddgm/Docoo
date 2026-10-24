'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiSend, ApiError } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale, textDir } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { Notice, useAction } from '../../use-action';
import { ProjectAccessBoundary, useReadOnlyAccess } from '../../resource-access';
import { useSessionIdentity } from '../../signed-in';
import { WorkspacePage } from '../../workspace-page';
import { explainProject } from '../explain';
import { quickDraftMessages } from '../quick-draft-messages';
import { projectMessages } from '../messages';
import { ReasonBar } from '../../reason-bar';
import { projectPageMessages } from './messages';
import { healthMessages } from './health-messages';
import { HealthBadge, HealthReasons, MilestoneCard } from './health-view';
import { projectHealth, projectMilestone, type WorkflowFacts } from './project-health';
import { AgentsPanel } from './agents-panel';
import { BusinessPanel } from './business-panel';
import { EvaluationPanel } from './evaluation-panel';
import { StageAgentChat } from './stage-chat';
import { DocumentsPanel } from './documents-panel';
import { KnowledgePanel } from './knowledge-panel';
import { OverviewPanel } from './overview-panel';
import { ProblemPanel } from './problem-panel';
import { RequirementsPanel } from './requirements-panel';
import { ResearchPanel } from './research-panel';
import type { ProjectDetail } from './project-types';
import { SolutionsPanel } from './solutions-panel';
import { TimelinePanel } from './timeline-panel';
import { WorkflowPanel } from './workflow-panel';
import { ProjectSettingsPanel } from './settings-panel';

const tabs = [
  'overview',
  'business',
  'knowledge',
  'agents',
  'settings',
  'workflow',
  'problem',
  'research',
  'solutions',
  'documents',
  'evaluation',
  'requirements',
  'timeline',
] as const;
type Tab = (typeof tabs)[number];

/** The tab that shows the output of each workflow stage. */
const STAGE_TAB: Record<string, Tab> = {
  analysis: 'problem',
  research: 'research',
  ideation: 'solutions',
  documentation: 'documents',
  evaluation: 'evaluation',
};

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
  // The card's edit button opens the overview's edit form.
  const [editRequested, setEditRequested] = useState(false);
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

  function startEdit() {
    setEditRequested(true);
    choose('overview');
  }

  /** The journey card presses one of the lifecycle buttons, so its confirmation stays the same. */
  function runCommand(command: string) {
    const button = document.querySelector<HTMLButtonElement>(`[data-command="${command}"]`);
    if (!button) return;
    button.click();
    button.scrollIntoView?.({ block: 'center' });
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
          <Link className="back-link" href={`/${locale}/projects` as Route}>
            {text.backToList}
          </Link>
        </p>
      </div>
    );
  }

  const intelligenceLink = (
    <Link href={`/${locale}/projects/${projectId}/intelligence` as Route}>
      {locale === 'fa' ? 'شواهد و تصمیم' : 'Evidence and decisions'}
    </Link>
  );
  const canEdit = !accessReadOnly && project.status !== 'archived' && project.status !== 'deleted';
  const health = projectHealth(project, facts);
  const milestone = projectMilestone(project.status, facts);

  return (
    <div className={accessReadOnly ? 'stack resource-view-only' : 'stack'}>
      <p>
        <Link className="back-link" href={`/${locale}/projects` as Route}>
          {text.backToList}
        </Link>
      </p>

      <section className="card" aria-labelledby="project-heading">
        <h2 id="project-heading" dir={textDir(locale)}>
          <span dir="ltr">{project.code}</span> — {project.title}
        </h2>
        {project.analysisProfile === 'quick' && (
          <p className="notice" role="status">
            {quickDraftMessages(locale).warning}
          </p>
        )}
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
            <dd dir={textDir(locale)}>
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
            <dt>{text.topicsShort}</dt>
            <dd dir={textDir(locale)}>
              {project.topics.length > 0 ? (
                <ul className="chip-list">
                  {project.topics.map((topic) => (
                    <li key={topic.topicId}>
                      <span className="badge">{topic.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                text.noTopicsShort
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
        {project.pauseReason && (
          <p className="notice error" role="status">
            <strong>{text.pauseReason}:</strong>{' '}
            <span dir={textDir(locale)}>{project.pauseReason}</span>
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
            onOpenWorkflow={project.status === 'active' ? undefined : () => choose('workflow')}
          />
        )}
        {!accessReadOnly && (
          <Lifecycle
            onEdit={canEdit ? startEdit : undefined}
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

      <p className="toolbar">
        {intelligenceLink}
        <a href={`/${locale}/projects/${projectId}/evaluation-lab?workspaceId=${workspaceId}`}>
          {locale === 'fa' ? 'مقایسهٔ کیفیت ایجنت‌ها' : 'Compare agent quality'}
        </a>
      </p>
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
        <OverviewPanel
          locale={locale}
          workspaceId={workspaceId}
          project={project}
          facts={facts}
          milestone={
            <MilestoneCard locale={locale} milestone={milestone} stages={facts?.stages ?? []} />
          }
          onChanged={(next) => {
            setProject(next);
            setRefreshKey((key) => key + 1);
          }}
          startEditing={editRequested}
          onEditStarted={() => setEditRequested(false)}
          onOpenTab={choose}
          onCommand={runCommand}
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
      {tab === 'problem' && (
        <StageAgentChat
          locale={locale}
          base={base}
          stage="analysis"
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
          onOpenStage={(stage) => choose(STAGE_TAB[stage] ?? 'workflow')}
        />
      )}
      {tab === 'research' && (
        <ResearchPanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          refreshKey={refreshKey}
          onOpenWorkflow={() => choose('workflow')}
          onChanged={changed}
        />
      )}
      {tab === 'research' && (
        <StageAgentChat
          locale={locale}
          base={base}
          stage="research"
          refreshKey={refreshKey}
          onChanged={changed}
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
      {tab === 'solutions' && (
        <StageAgentChat
          locale={locale}
          base={base}
          stage="ideation"
          refreshKey={refreshKey}
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
      {tab === 'documents' && (
        <StageAgentChat
          locale={locale}
          base={base}
          stage="documentation"
          refreshKey={refreshKey}
          onChanged={changed}
        />
      )}
      {tab === 'evaluation' && (
        <EvaluationPanel
          locale={locale}
          workspaceId={workspaceId}
          projectId={projectId}
          refreshKey={refreshKey}
          onOpenWorkflow={() => choose('workflow')}
          onOpenSettings={() => choose('settings')}
          onChanged={changed}
        />
      )}
      {tab === 'requirements' && (
        <RequirementsPanel
          locale={locale}
          base={base}
          refreshKey={refreshKey}
          onOpenStage={(stage) => choose(STAGE_TAB[stage] ?? 'workflow')}
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
const reasonRequired = new Set(['pause', 'complete', 'reopen', 'analysis/continue']);
const needsConfirmation = new Set([
  'pause',
  'complete',
  'reopen',
  'archive',
  'delete',
  'analysis/continue',
]);
const destructive = new Set(['archive', 'delete']);

function Lifecycle({
  locale,
  base,
  project,
  onChanged,
  onEdit,
}: {
  locale: Locale;
  base: string;
  project: ProjectDetail;
  onChanged: (project: ProjectDetail) => void;
  onEdit?: (() => void) | undefined;
}) {
  const text = projectPageMessages(locale);
  const formText = projectMessages(locale);
  const quick = quickDraftMessages(locale);
  const labels: Record<string, string> = { ...text.commands, 'analysis/continue': quick.continue };
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
    void run(
      async () => {
        const result =
          command === 'delete'
            ? await apiSend<{ project: ProjectDetail }>('DELETE', base, body)
            : await apiSend<{ project: ProjectDetail }>('POST', `${base}/${command}`, body);
        setPending(null);
        onChanged(result.project);
      },
      command === 'analysis/continue' ? quick.continued : (text.done[command] ?? formText.saved),
    );
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
  if (project.analysisProfile === 'quick' && project.status === 'completed')
    commands.unshift('analysis/continue');
  if (commands.length === 0 && !onEdit) return <Notice notice={notice} />;

  const editButton = onEdit ? (
    <button type="button" data-write-action className="secondary-button" onClick={onEdit}>
      {text.edit}
    </button>
  ) : null;

  return (
    <div className="stack">
      <Notice notice={notice} />
      <div className="toolbar" role="group" aria-label={text.lifecycle}>
        {onEdit && !commands.includes('pause') && editButton}
        {commands.map((command) => (
          <Fragment key={command}>
            {command === 'pause' && editButton}
            <button
              className={
                command === 'activate' || command === 'resume' || command === 'restore'
                  ? 'primary-button'
                  : destructive.has(command)
                    ? 'secondary-button danger'
                    : 'secondary-button'
              }
              type="button"
              data-command={command}
              disabled={busy}
              aria-expanded={
                needsConfirmation.has(command) ? pending?.command === command : undefined
              }
              onClick={() => choose(command)}
            >
              {labels[command] ?? command}
            </button>
          </Fragment>
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
              .replace('{command}', labels[pending.command] ?? pending.command)
              .replace('{title}', project.title)}
          </h3>
          <p>
            {pending.command === 'analysis/continue'
              ? quick.effect
              : (text.effects[pending.command] ?? '')}
          </p>
          <ReasonBar
            locale={locale}
            id="command-reason"
            label={reasonRequired.has(pending.command) ? text.reasonRequired : text.reasonOptional}
            value={pending.reason}
            required={reasonRequired.has(pending.command)}
            onChange={(reason) => setPending({ ...pending, reason })}
          >
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
          </ReasonBar>
        </form>
      )}
    </div>
  );
}
