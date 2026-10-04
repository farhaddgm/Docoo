'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { apiGet } from '../../api-client';
import type { Locale } from '../../i18n';
import { reportMessagesFor } from '../../report-messages';
import { projectMessages } from './messages';

export interface TopicChoice {
  topicId: string;
  conflictInstruction: string;
}

export interface ProjectValues {
  code: string;
  title: string;
  description: string;
  initialProblem: string;
  outputLanguage: 'fa' | 'en';
  topics: TopicChoice[];
}

/** Topics a project already links to, so an archived one can still be shown and removed. */
export interface KnownTopic {
  topicId: string;
  code: string;
  title: string;
  archived?: boolean;
}

interface ActiveTopic {
  id: string;
  code: string;
  title: string;
}

export const emptyProject = (locale: Locale): ProjectValues => ({
  code: '',
  title: '',
  description: '',
  initialProblem: '',
  outputLanguage: locale,
  topics: [],
});

const MAX_TOPICS = 20;

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
  const common = reportMessagesFor(locale);
  const [values, setValues] = useState<ProjectValues>(initial);
  const [reason, setReason] = useState('');
  const [available, setAvailable] = useState<ActiveTopic[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [toAdd, setToAdd] = useState('');

  useEffect(() => {
    apiGet<{ items: ActiveTopic[] }>(`/workspaces/${workspaceId}/topics?status=active&limit=100`)
      .then((page) => setAvailable(page.items))
      .catch(() => setLoadFailed(true));
  }, [workspaceId]);

  const catalog = useMemo(() => {
    const map = new Map<string, KnownTopic>();
    for (const topic of known) map.set(topic.topicId, topic);
    for (const topic of available ?? []) {
      map.set(topic.id, { topicId: topic.id, code: topic.code, title: topic.title });
    }
    return map;
  }, [available, known]);

  const selectedIds = new Set(values.topics.map((topic) => topic.topicId));
  const addable = (available ?? []).filter((topic) => !selectedIds.has(topic.id));

  function setTopics(topics: TopicChoice[]) {
    setValues({ ...values, topics });
  }

  function move(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= values.topics.length) return;
    const next = [...values.topics];
    const [item] = next.splice(index, 1);
    if (item) next.splice(target, 0, item);
    setTopics(next);
  }

  function add() {
    if (!toAdd || selectedIds.has(toAdd) || values.topics.length >= MAX_TOPICS) return;
    setTopics([...values.topics, { topicId: toAdd, conflictInstruction: '' }]);
    setToAdd('');
  }

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
      <section className="card filter-form" aria-labelledby="project-basics-title">
        <h2 id="project-basics-title">{text.basics}</h2>
        <div className="filter-grid">
          <label htmlFor="project-code">{text.codeLabel}</label>
          <input
            id="project-code"
            dir="ltr"
            value={values.code}
            onChange={(event) => setValues({ ...values, code: event.target.value })}
            pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}"
            aria-describedby="project-code-help"
            autoComplete="off"
            required
          />
          <span />
          <p id="project-code-help" className="muted">
            {text.codeHelp}
          </p>
          <label htmlFor="project-title">{text.titleLabel}</label>
          <input
            id="project-title"
            dir="auto"
            value={values.title}
            onChange={(event) => setValues({ ...values, title: event.target.value })}
            maxLength={200}
            autoComplete="off"
            required
          />
          <label htmlFor="project-description">{text.descriptionLabel}</label>
          <textarea
            id="project-description"
            dir="auto"
            rows={2}
            value={values.description}
            onChange={(event) => setValues({ ...values, description: event.target.value })}
            maxLength={10000}
          />
          <label htmlFor="project-problem">{text.problemLabel}</label>
          <textarea
            id="project-problem"
            dir="auto"
            rows={8}
            value={values.initialProblem}
            onChange={(event) => setValues({ ...values, initialProblem: event.target.value })}
            maxLength={50000}
            aria-describedby="project-problem-help"
            disabled={problemLocked}
            required
          />
          <span />
          <p id="project-problem-help" className="muted">
            {text.problemHelp}
          </p>
          <label htmlFor="project-language">{text.outputLanguage}</label>
          <select
            id="project-language"
            value={values.outputLanguage}
            onChange={(event) =>
              setValues({ ...values, outputLanguage: event.target.value as 'fa' | 'en' })
            }
          >
            <option value="fa">{text.languages.fa}</option>
            <option value="en">{text.languages.en}</option>
          </select>
        </div>
      </section>

      <section className="card" aria-labelledby="project-topics-title">
        <h2 id="project-topics-title">{text.topicsSection}</h2>
        <p className="muted">{text.topicsHelp}</p>
        {loadFailed && (
          <p className="notice error" role="alert">
            {common.loadFailed}
          </p>
        )}
        {values.topics.length === 0 ? (
          <p className="muted">{text.noTopicsSelected}</p>
        ) : (
          <ol className="priority-list">
            {values.topics.map((choice, index) => {
              const topic = catalog.get(choice.topicId);
              const name = topic ? topic.title : choice.topicId;
              return (
                <li key={choice.topicId}>
                  <span className="badge" aria-label={`${text.priority} ${index + 1}`}>
                    {index + 1}
                  </span>
                  <span className="grow" dir="auto">
                    <strong>{name}</strong>
                    {topic && (
                      <small className="muted" dir="ltr">
                        {' '}
                        {topic.code}
                      </small>
                    )}
                  </span>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={index === 0}
                    aria-label={`${text.moveUp}: ${name}`}
                    onClick={() => move(index, -1)}
                  >
                    {text.moveUp}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={index === values.topics.length - 1}
                    aria-label={`${text.moveDown}: ${name}`}
                    onClick={() => move(index, 1)}
                  >
                    {text.moveDown}
                  </button>
                  <button
                    className="secondary-button danger"
                    type="button"
                    aria-label={`${text.removeTopic}: ${name}`}
                    onClick={() =>
                      setTopics(values.topics.filter((item) => item.topicId !== choice.topicId))
                    }
                  >
                    {text.removeTopic}
                  </button>
                  <div className="field-stack" style={{ flexBasis: '100%' }}>
                    <label htmlFor={`conflict-${choice.topicId}`}>{text.conflictInstruction}</label>
                    <input
                      id={`conflict-${choice.topicId}`}
                      dir="auto"
                      value={choice.conflictInstruction}
                      maxLength={2000}
                      onChange={(event) =>
                        setTopics(
                          values.topics.map((item) =>
                            item.topicId === choice.topicId
                              ? { ...item, conflictInstruction: event.target.value }
                              : item,
                          ),
                        )
                      }
                      autoComplete="off"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {available !== null && available.length === 0 && values.topics.length === 0 ? (
          <p>
            {text.noTopicsAvailable}{' '}
            <Link href={`/${locale}/topics` as Route}>{text.createTopicFirst}</Link>
          </p>
        ) : (
          <div className="toolbar">
            <label htmlFor="project-add-topic">{text.addTopic}</label>
            <select
              id="project-add-topic"
              value={toAdd}
              onChange={(event) => setToAdd(event.target.value)}
              disabled={addable.length === 0 || values.topics.length >= MAX_TOPICS}
            >
              <option value="">{text.chooseTopic}</option>
              {addable.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.title} ({topic.code})
                </option>
              ))}
            </select>
            <button className="secondary-button" type="button" disabled={!toAdd} onClick={add}>
              {text.addTopic}
            </button>
          </div>
        )}
      </section>

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
