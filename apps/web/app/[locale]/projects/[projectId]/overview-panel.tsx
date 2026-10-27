'use client';
import { PatternSelection } from './pattern-selection';
import { useReadOnlyAccess } from '../../resource-access';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { apiGet, apiSend } from '../../../api-client';
import type { Locale } from '../../../i18n';
import { Notice, useAction } from '../../use-action';
import { explainProject } from '../explain';
import { projectMessages } from '../messages';
import { BusinessPicker } from '../business-picker';
import type { ContenterBusinessItem } from '../business-types';
import { ProjectForm, type ProjectValues } from '../project-form';
import { JourneyCard } from './journey-card';
import { projectPageMessages } from './messages';
import type { WorkflowFacts } from './project-health';
import { hasJourney } from './project-journey';
import { NextProjectCard, OriginNote } from './next-project';
import type { ProjectDetail } from './project-types';
import { textDir } from '../../../i18n';

/** The problem, description and prioritized topics, with editing while the project allows it. */
export function OverviewPanel({
  locale,
  workspaceId,
  project,
  facts,
  milestone,
  onChanged,
  startEditing,
  onEditStarted,
  onOpenTab,
  onCommand,
}: {
  locale: Locale;
  workspaceId: string;
  project: ProjectDetail;
  /** The latest workflow facts the journey is drawn from; null when they could not be read. */
  facts: WorkflowFacts | null;
  /** The progress card; it comes after the journey, which is the main guide of the page. */
  milestone: ReactNode;
  onChanged: (project: ProjectDetail) => void;
  /** The project card asked for the edit form. */
  startEditing: boolean;
  onEditStarted: () => void;
  onOpenTab: (tab: 'problem' | 'workflow' | 'solutions' | 'documents') => void;
  /** Runs one of the project's lifecycle buttons (activate, complete, resume). */
  onCommand: (command: string) => void;
}) {
  const accessReadOnly = useReadOnlyAccess();
  const text = projectPageMessages(locale);
  const formText = projectMessages(locale);
  const [editing, setEditing] = useState(false);
  const explain = useCallback((error: unknown) => explainProject(error, formText), [formText]);
  const { busy, notice, setNotice, run } = useAction(explain);
  const [business, setBusiness] = useState<ContenterBusinessItem | null>(null);
  const readOnly = accessReadOnly || project.status === 'archived' || project.status === 'deleted';

  useEffect(() => {
    if (startEditing && !readOnly) {
      setBusiness(null);
      setEditing(true);
    }
    if (startEditing) onEditStarted();
  }, [startEditing]);

  if (editing) {
    const initial: ProjectValues = {
      code: project.code,
      title: project.title,
      description: project.description,
      initialProblem: project.initialProblem,
      outputLanguage: project.outputLanguage,
      topics: project.topics.map((topic) => ({
        topicId: topic.topicId,
        conflictInstruction: topic.conflictInstruction ?? '',
        knowledgeSharing: topic.knowledgeSharing,
      })),
      sharedKnowledgeIds: project.sharedKnowledgeIds,
    };
    return (
      <div className="stack">
        <h2 tabIndex={-1}>{text.editTitle}</h2>
        <Notice notice={notice} />
        <section className="card" aria-labelledby="edit-business-title">
          <h3 id="edit-business-title">{text.business}</h3>
          <p className="muted">
            {project.business ? project.business.name : text.noBusiness}
            {business ? ` → ${business.name}` : ''}
          </p>
          <BusinessPicker
            locale={locale}
            workspaceId={workspaceId}
            value={business}
            onChange={setBusiness}
            disabled={busy}
          />
        </section>
        <ProjectForm
          locale={locale}
          workspaceId={workspaceId}
          projectId={project.id}
          mode="edit"
          initial={initial}
          known={project.topics.map((topic) => ({
            topicId: topic.topicId,
            code: topic.code,
            title: topic.title,
            archived: topic.topicStatus !== 'active',
          }))}
          problemLocked={project.status !== 'draft'}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={(changes, reason) => {
            if (Object.keys(changes).length === 0 && !business) {
              setNotice({ ok: true, text: formText.saved });
              setEditing(false);
              return;
            }
            const body = {
              ...changes,
              ...(changes.topics
                ? {
                    topics: changes.topics.map((topic) => ({
                      topicId: topic.topicId,
                      ...(topic.conflictInstruction
                        ? { conflictInstruction: topic.conflictInstruction }
                        : {}),
                      knowledgeSharing: topic.knowledgeSharing,
                    })),
                  }
                : {}),
              ...(reason ? { reason } : {}),
            };
            void run(async () => {
              const projectBase = `/workspaces/${workspaceId}/projects/${project.id}`;
              let saved = project;
              if (Object.keys(changes).length > 0) {
                saved = (
                  await apiSend<{ project: ProjectDetail }>('PATCH', projectBase, body, {
                    version: project.version,
                  })
                ).project;
              }
              if (business) {
                await apiSend('PUT', `${projectBase}/business`, {
                  externalBusinessId: business.id,
                  ...(reason ? { reason } : {}),
                });
                saved = (await apiGet<{ project: ProjectDetail }>(projectBase)).project;
                setBusiness(null);
              }
              onChanged(saved);
              setEditing(false);
            }, formText.saved);
          }}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <PatternSelection
        locale={locale}
        workspaceId={workspaceId}
        project={project}
        readOnly={readOnly}
        onChanged={onChanged}
      />

      <Notice notice={notice} />
      {hasJourney(project.status) && (
        <JourneyCard
          locale={locale}
          project={project}
          facts={facts}
          readOnly={readOnly}
          onEditProblem={() => setEditing(true)}
          onOpenTab={onOpenTab}
          onCommand={onCommand}
        />
      )}
      {milestone}
      <OriginNote locale={locale} project={project} />
      <section className="card" aria-labelledby="problem-title">
        <div className="toolbar spread">
          <h2 id="problem-title">{text.problem}</h2>
        </div>
        <p dir={textDir(locale)} style={{ whiteSpace: 'pre-wrap' }}>
          {project.initialProblem}
        </p>
        {project.description && (
          <>
            <h3>{text.description}</h3>
            <p dir={textDir(locale)} style={{ whiteSpace: 'pre-wrap' }}>
              {project.description}
            </p>
          </>
        )}
      </section>
      <section className="card" aria-labelledby="topics-title">
        <h2 id="topics-title">{text.topics}</h2>
        {project.topics.length === 0 ? (
          <p className="muted">{text.noTopics}</p>
        ) : (
          <ol className="plain-list">
            {project.topics.map((topic) => (
              <li key={topic.topicId}>
                <strong dir={textDir(locale)}>{topic.title}</strong>{' '}
                <small className="muted" dir="ltr">
                  {topic.code}
                </small>
                {topic.topicStatus !== 'active' && (
                  <span className="badge state-paused">{text.archivedTopic}</span>
                )}
                {topic.knowledgeSharing !== 'none' && (
                  <>
                    <br />
                    <span className="muted">
                      {formText.sharing}: {formText.sharingModes[topic.knowledgeSharing]}
                    </span>
                  </>
                )}
                {topic.conflictInstruction && (
                  <>
                    <br />
                    <span className="muted" dir={textDir(locale)}>
                      {topic.conflictInstruction}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      {project.status === 'completed' && !accessReadOnly && (
        <NextProjectCard locale={locale} workspaceId={workspaceId} project={project} />
      )}
    </div>
  );
}
