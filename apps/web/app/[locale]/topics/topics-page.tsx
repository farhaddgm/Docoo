'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';

import { apiGet, apiSend, query } from '../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { reportMessagesFor } from '../../report-messages';
import { explainError, Notice, useAction } from '../use-action';
import { WorkspacePage } from '../workspace-page';
import { topicMessages } from './messages';

type TopicStatus = 'active' | 'archived' | 'deleted';
type TopicLanguage = 'fa' | 'en';

interface Topic {
  id: string;
  code: string;
  title: string;
  description: string;
  language: TopicLanguage;
  status: TopicStatus;
  version: number;
  purgeAfter: string | null;
  updatedAt: string;
}

interface Dependency {
  projectId: string;
  code: string;
  title: string;
  status: string;
}

interface Confirmation {
  kind: 'archive' | 'delete';
  topic: Topic;
  dependencies: Dependency[] | null;
  reason: string;
}

const views: TopicStatus[] = ['active', 'archived', 'deleted'];

export function TopicsPage({ locale }: { locale: Locale }) {
  const text = topicMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <Topics locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

/** TOP-001 in the backoffice: list, create, edit with versions, archive, restore and delete. */
function Topics({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = topicMessages(locale);
  const common = reportMessagesFor(locale);
  const base = `/workspaces/${workspaceId}/topics`;
  const [view, setView] = useState<TopicStatus>('active');
  const [items, setItems] = useState<Topic[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [confirming, setConfirming] = useState<Confirmation | null>(null);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, setNotice, run } = useAction(explain);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    async (status: TopicStatus, cursor?: string) => {
      const page = await apiGet<{ items: Topic[]; nextCursor: string | null }>(
        `${base}${query({ status, limit: '50', cursor })}`,
      );
      setItems((current) => (cursor && current ? [...current, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    },
    [base],
  );

  useEffect(() => {
    setItems(null);
    setLoadFailed(false);
    load(view).catch(() => setLoadFailed(true));
  }, [view, load]);

  useEffect(() => {
    if (confirming) confirmHeading.current?.focus();
  }, [confirming?.topic.id, confirming?.kind]);
  useEffect(() => {
    if (editing) editHeading.current?.focus();
  }, [editing?.id]);

  const [form, setForm] = useState({ code: '', title: '', description: '', language: locale });

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await apiSend('POST', base, {
        code: form.code.trim(),
        title: form.title.trim(),
        description: form.description.trim(),
        language: form.language,
      });
      setForm({ code: '', title: '', description: '', language: locale });
      if (view === 'active') await load('active');
      else setView('active');
    }, text.created);
  }

  async function askConfirmation(kind: Confirmation['kind'], topic: Topic) {
    setEditing(null);
    setNotice(null);
    setConfirming({ kind, topic, dependencies: null, reason: '' });
    try {
      const { items: dependencies } = await apiGet<{ items: Dependency[] }>(
        `${base}/${topic.id}/dependencies`,
      );
      setConfirming((current) =>
        current?.topic.id === topic.id ? { ...current, dependencies } : current,
      );
    } catch (error) {
      setNotice({ ok: false, text: explain(error) });
      setConfirming(null);
    }
  }

  function confirm() {
    if (!confirming) return;
    const { kind, topic, reason } = confirming;
    const body = {
      expectedVersion: topic.version,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    };
    void run(
      async () => {
        if (kind === 'archive') await apiSend('POST', `${base}/${topic.id}/archive`, body);
        else await apiSend('DELETE', `${base}/${topic.id}`, body);
        setConfirming(null);
        await load(view);
      },
      kind === 'archive' ? text.archived : text.deleted,
    );
  }

  function restore(topic: Topic) {
    setConfirming(null);
    void run(async () => {
      await apiSend('POST', `${base}/${topic.id}/restore`, { expectedVersion: topic.version });
      await load(view);
    }, text.restored);
  }

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="card" aria-labelledby="topic-list-title">
        <div className="toolbar spread">
          <h2 id="topic-list-title">{text.list}</h2>
          <div className="toolbar">
            <label htmlFor="topic-view">{text.view}</label>
            <select
              id="topic-view"
              value={view}
              onChange={(event) => {
                setConfirming(null);
                setEditing(null);
                setView(event.target.value as TopicStatus);
              }}
            >
              {views.map((item) => (
                <option key={item} value={item}>
                  {text.views[item]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {loadFailed ? (
          <p className="notice error" role="alert">
            {common.loadFailed}
          </p>
        ) : items === null ? (
          <p role="status">{common.loading}</p>
        ) : items.length === 0 ? (
          <p className="muted">{text.empty}</p>
        ) : (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-labelledby="topic-list-title"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">{text.code}</th>
                  <th scope="col">{text.topicTitle}</th>
                  <th scope="col">{text.language}</th>
                  <th scope="col">{text.version}</th>
                  <th scope="col">{view === 'deleted' ? text.purgeAfter : text.updated}</th>
                  <th scope="col">
                    <span className="visually-hidden">{text.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((topic) => (
                  <tr key={topic.id}>
                    <th scope="row" dir="ltr">
                      {topic.code}
                    </th>
                    <td dir="auto">{topic.title}</td>
                    <td>{text.languages[topic.language]}</td>
                    <td>{formatNumber(locale, topic.version)}</td>
                    <td>
                      {formatDateTime(
                        locale,
                        view === 'deleted' && topic.purgeAfter ? topic.purgeAfter : topic.updatedAt,
                      )}
                    </td>
                    <td>
                      <div className="toolbar">
                        {view === 'active' && (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={busy}
                            aria-label={`${text.edit}: ${topic.title}`}
                            onClick={() => {
                              setConfirming(null);
                              setNotice(null);
                              setEditing(topic);
                            }}
                          >
                            {text.edit}
                          </button>
                        )}
                        {view === 'active' && (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={busy}
                            aria-label={`${text.archive}: ${topic.title}`}
                            onClick={() => void askConfirmation('archive', topic)}
                          >
                            {text.archive}
                          </button>
                        )}
                        {view !== 'active' && (
                          <button
                            className="secondary-button"
                            type="button"
                            disabled={busy}
                            aria-label={`${text.restore}: ${topic.title}`}
                            onClick={() => restore(topic)}
                          >
                            {text.restore}
                          </button>
                        )}
                        {view !== 'deleted' && (
                          <button
                            className="secondary-button danger"
                            type="button"
                            disabled={busy}
                            aria-label={`${text.remove}: ${topic.title}`}
                            onClick={() => void askConfirmation('delete', topic)}
                          >
                            {text.remove}
                          </button>
                        )}
                      </div>
                    </td>
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
              disabled={busy}
              onClick={() => void load(view, nextCursor).catch(() => setLoadFailed(true))}
            >
              {text.loadMore}
            </button>
          </div>
        )}
      </section>

      {confirming && (
        <section className="card confirm-panel" aria-labelledby="confirm-title">
          <h2 id="confirm-title" tabIndex={-1} ref={confirmHeading}>
            {(confirming.kind === 'archive' ? text.archiveTitle : text.deleteTitle).replace(
              '{title}',
              confirming.topic.title,
            )}
          </h2>
          <p>{confirming.kind === 'archive' ? text.archiveEffect : text.deleteEffect}</p>
          <h3>{text.usedBy}</h3>
          {confirming.dependencies === null ? (
            <p role="status">{common.loading}</p>
          ) : confirming.dependencies.length === 0 ? (
            <p className="muted">{text.notUsed}</p>
          ) : (
            <ul className="plain-list">
              {confirming.dependencies.map((item) => (
                <li key={item.projectId}>
                  <span dir="ltr">{item.code}</span> — {item.title}{' '}
                  <span className="badge">{item.status}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="filter-grid">
            <label htmlFor="confirm-reason">{text.reason}</label>
            <input
              id="confirm-reason"
              value={confirming.reason}
              maxLength={1000}
              onChange={(event) => setConfirming({ ...confirming, reason: event.target.value })}
              autoComplete="off"
            />
          </div>
          <div className="toolbar">
            <button
              className="primary-button"
              type="button"
              disabled={busy || confirming.dependencies === null}
              onClick={confirm}
            >
              {busy ? text.working : text.confirm}
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setConfirming(null)}
            >
              {text.cancel}
            </button>
          </div>
        </section>
      )}

      {editing && (
        <EditTopic
          key={`${editing.id}-${editing.version}`}
          locale={locale}
          topic={editing}
          busy={busy}
          heading={editHeading}
          onCancel={() => setEditing(null)}
          onSave={(changes, reason) =>
            run(async () => {
              await apiSend(
                'PATCH',
                `${base}/${editing.id}`,
                { ...changes, ...(reason ? { reason } : {}) },
                { version: editing.version },
              );
              setEditing(null);
              await load(view);
            }, text.updatedDone)
          }
          onUnchanged={() => setNotice({ ok: true, text: text.noChange })}
        />
      )}

      <form
        className="card filter-form"
        onSubmit={create}
        aria-labelledby="topic-create-title"
        aria-busy={busy}
      >
        <h2 id="topic-create-title">{text.create}</h2>
        <div className="filter-grid">
          <label htmlFor="topic-code">{text.code}</label>
          <input
            id="topic-code"
            dir="ltr"
            value={form.code}
            onChange={(event) => setForm({ ...form, code: event.target.value })}
            pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}"
            aria-describedby="topic-code-help"
            autoComplete="off"
            required
          />
          <span />
          <p id="topic-code-help" className="muted">
            {text.codeHelp}
          </p>
          <label htmlFor="topic-title">{text.topicTitle}</label>
          <input
            id="topic-title"
            dir="auto"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            maxLength={200}
            autoComplete="off"
            required
          />
          <label htmlFor="topic-description">{text.description}</label>
          <textarea
            id="topic-description"
            dir="auto"
            rows={3}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            maxLength={10000}
          />
          <label htmlFor="topic-language">{text.language}</label>
          <select
            id="topic-language"
            value={form.language}
            onChange={(event) => setForm({ ...form, language: event.target.value as Locale })}
          >
            <option value="fa">{text.languages.fa}</option>
            <option value="en">{text.languages.en}</option>
          </select>
        </div>
        <div className="toolbar">
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? text.creating : text.createSubmit}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditTopic({
  locale,
  topic,
  busy,
  heading,
  onCancel,
  onSave,
  onUnchanged,
}: {
  locale: Locale;
  topic: Topic;
  busy: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  onCancel: () => void;
  onSave: (
    changes: Partial<Pick<Topic, 'code' | 'title' | 'description' | 'language'>>,
    reason: string,
  ) => Promise<boolean>;
  onUnchanged: () => void;
}) {
  const text = topicMessages(locale);
  const [fields, setFields] = useState({
    code: topic.code,
    title: topic.title,
    description: topic.description,
    language: topic.language,
  });
  const [reason, setReason] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = {
      code: fields.code.trim(),
      title: fields.title.trim(),
      description: fields.description.trim(),
      language: fields.language,
    };
    const changes: Partial<typeof trimmed> = {};
    if (trimmed.code !== topic.code) changes.code = trimmed.code;
    if (trimmed.title !== topic.title) changes.title = trimmed.title;
    if (trimmed.description !== topic.description) changes.description = trimmed.description;
    if (trimmed.language !== topic.language) changes.language = trimmed.language;
    if (Object.keys(changes).length === 0) {
      onUnchanged();
      return;
    }
    void onSave(changes, reason.trim());
  }

  return (
    <form
      className="card filter-form"
      onSubmit={submit}
      aria-labelledby="topic-edit-title"
      aria-busy={busy}
    >
      <h2 id="topic-edit-title" tabIndex={-1} ref={heading}>
        {text.editTitle.replace('{code}', topic.code)}
      </h2>
      <div className="filter-grid">
        <label htmlFor="edit-code">{text.code}</label>
        <input
          id="edit-code"
          dir="ltr"
          value={fields.code}
          onChange={(event) => setFields({ ...fields, code: event.target.value })}
          pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]{0,63}"
          autoComplete="off"
          required
        />
        <label htmlFor="edit-title">{text.topicTitle}</label>
        <input
          id="edit-title"
          dir="auto"
          value={fields.title}
          onChange={(event) => setFields({ ...fields, title: event.target.value })}
          maxLength={200}
          autoComplete="off"
          required
        />
        <label htmlFor="edit-description">{text.description}</label>
        <textarea
          id="edit-description"
          dir="auto"
          rows={3}
          value={fields.description}
          onChange={(event) => setFields({ ...fields, description: event.target.value })}
          maxLength={10000}
        />
        <label htmlFor="edit-language">{text.language}</label>
        <select
          id="edit-language"
          value={fields.language}
          onChange={(event) =>
            setFields({ ...fields, language: event.target.value as TopicLanguage })
          }
        >
          <option value="fa">{text.languages.fa}</option>
          <option value="en">{text.languages.en}</option>
        </select>
        <label htmlFor="edit-reason">{text.reason}</label>
        <input
          id="edit-reason"
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="toolbar">
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? text.working : text.save}
        </button>
        <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>
          {text.cancel}
        </button>
      </div>
    </form>
  );
}
