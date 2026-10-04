'use client';

import { useCallback, useState } from 'react';

import { apiSend } from '../../../api-client';
import type { Locale } from '../../../i18n';
import { Notice, useAction } from '../../use-action';
import { explainProject } from '../explain';
import { projectMessages } from '../messages';
import { ProjectForm, type ProjectValues } from '../project-form';
import { projectPageMessages } from './messages';
import type { ProjectDetail } from './project-types';

/** The problem, description and prioritized topics, with editing while the project allows it. */
export function OverviewPanel({
  locale,
  workspaceId,
  project,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  project: ProjectDetail;
  onChanged: (project: ProjectDetail) => void;
}) {
  const text = projectPageMessages(locale);
  const formText = projectMessages(locale);
  const [editing, setEditing] = useState(false);
  const explain = useCallback((error: unknown) => explainProject(error, formText), [formText]);
  const { busy, notice, setNotice, run } = useAction(explain);
  const readOnly = project.status === 'archived' || project.status === 'deleted';

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
      })),
    };
    return (
      <div className="stack">
        <h2 tabIndex={-1}>{text.editTitle}</h2>
        <Notice notice={notice} />
        <ProjectForm
          locale={locale}
          workspaceId={workspaceId}
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
            if (Object.keys(changes).length === 0) {
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
                    })),
                  }
                : {}),
              ...(reason ? { reason } : {}),
            };
            void run(async () => {
              const result = await apiSend<{ project: ProjectDetail }>(
                'PATCH',
                `/workspaces/${workspaceId}/projects/${project.id}`,
                body,
                { version: project.version },
              );
              onChanged(result.project);
              setEditing(false);
            }, formText.saved);
          }}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      <Notice notice={notice} />
      <section className="card" aria-labelledby="problem-title">
        <div className="toolbar spread">
          <h2 id="problem-title">{text.problem}</h2>
          {!readOnly && (
            <button className="secondary-button" type="button" onClick={() => setEditing(true)}>
              {text.edit}
            </button>
          )}
        </div>
        <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
          {project.initialProblem}
        </p>
        {project.description && (
          <>
            <h3>{text.description}</h3>
            <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
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
                <strong dir="auto">{topic.title}</strong>{' '}
                <small className="muted" dir="ltr">
                  {topic.code}
                </small>
                {topic.topicStatus !== 'active' && (
                  <span className="badge state-paused">{text.archivedTopic}</span>
                )}
                {topic.conflictInstruction && (
                  <>
                    <br />
                    <span className="muted" dir="auto">
                      {topic.conflictInstruction}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
