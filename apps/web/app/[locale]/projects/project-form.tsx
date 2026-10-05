'use client';

import { useState, type FormEvent } from 'react';

import type { Locale } from '../../i18n';
import { projectMessages } from './messages';
import { BasicsFields, TopicsSection, type KnownTopic, type ProjectValues } from './project-fields';

export {
  emptyProject,
  type KnownTopic,
  type ProjectValues,
  type TopicChoice,
} from './project-fields';

/**
 * Shared by project creation and editing: basics, the problem and the prioritized topics.
 * Edit mode reports only what changed so an edit never rewrites other fields.
 */
export function ProjectForm({
  locale,
  workspaceId,
  mode,
  initial,
  known = [],
  problemLocked = false,
  busy,
  onCreate,
  onSave,
  onCancel,
}: {
  locale: Locale;
  workspaceId: string;
  mode: 'create' | 'edit';
  initial: ProjectValues;
  known?: KnownTopic[];
  problemLocked?: boolean;
  busy: boolean;
  /** Create mode: receives the complete project. */
  onCreate?: (values: ProjectValues) => void;
  /** Edit mode: receives only the fields that changed. */
  onSave?: (changes: Partial<ProjectValues>, reason: string) => void;
  onCancel?: () => void;
}) {
  const text = projectMessages(locale);
  const [values, setValues] = useState<ProjectValues>(initial);
  const [reason, setReason] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const clean: ProjectValues = {
      ...values,
      code: values.code.trim(),
      title: values.title.trim(),
      description: values.description.trim(),
      initialProblem: values.initialProblem.trim(),
      topics: values.topics.map((topic) => ({
        topicId: topic.topicId,
        conflictInstruction: topic.conflictInstruction.trim(),
      })),
    };
    if (mode === 'create') {
      onCreate?.(clean);
      return;
    }
    const changes: Partial<ProjectValues> = {};
    if (clean.code !== initial.code) changes.code = clean.code;
    if (clean.title !== initial.title) changes.title = clean.title;
    if (clean.description !== initial.description) changes.description = clean.description;
    if (clean.initialProblem !== initial.initialProblem)
      changes.initialProblem = clean.initialProblem;
    if (clean.outputLanguage !== initial.outputLanguage)
      changes.outputLanguage = clean.outputLanguage;
    if (JSON.stringify(clean.topics) !== JSON.stringify(initial.topics))
      changes.topics = clean.topics;
    onSave?.(changes, reason.trim());
  }

  return (
    <form className="stack" onSubmit={submit} aria-busy={busy}>
      <BasicsFields
        locale={locale}
        values={values}
        onChange={setValues}
        problemLocked={problemLocked}
      />
      <TopicsSection
        locale={locale}
        workspaceId={workspaceId}
        values={values}
        onChange={setValues}
        known={known}
      />

      {mode === 'edit' && (
        <section className="card filter-form">
          <div className="filter-grid">
            <label htmlFor="project-reason">{text.reason}</label>
            <input
              id="project-reason"
              value={reason}
              maxLength={1000}
              onChange={(event) => setReason(event.target.value)}
              autoComplete="off"
            />
          </div>
        </section>
      )}

      <div className="toolbar">
        <button className="primary-button" type="submit" disabled={busy}>
          {mode === 'create' ? (busy ? text.creating : text.createSubmit) : text.saveChanges}
        </button>
        {onCancel && (
          <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>
            {text.cancel}
          </button>
        )}
      </div>
    </form>
  );
}
