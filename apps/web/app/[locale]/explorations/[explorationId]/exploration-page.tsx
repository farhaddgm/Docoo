'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { apiGet, apiSend } from '../../../api-client';
import { formatDateTime, formatNumber, textDir, type Locale } from '../../../i18n';
import { aiEnabled, canCreateProjects } from '../../access';
import { useSessionIdentity } from '../../signed-in';
import { explainError, Notice, useAction } from '../../use-action';
import { WorkspacePage } from '../../workspace-page';
import {
  CANDIDATE_FILTERS,
  composerState,
  countByState,
  canMakeProject,
  filterCandidates,
  newProjectHref,
  offeredDecisions,
  proposeState,
  type Candidate,
  type CandidateDecision,
  type CandidateFilter,
  type ExplorationDetail,
} from '../exploration-model';
import { explorationMessages, fill } from '../messages';

export function ExplorationPage({
  locale,
  explorationId,
}: {
  locale: Locale;
  explorationId: string;
}) {
  const text = explorationMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => (
        <Exploration locale={locale} workspaceId={workspaceId} explorationId={explorationId} />
      )}
    </WorkspacePage>
  );
}

type Pending = 'message' | 'propose' | null;

/** One exploration: the event, the conversation with the analyst and the candidate problems (ADR-0044). */
function Exploration({
  locale,
  workspaceId,
  explorationId,
}: {
  locale: Locale;
  workspaceId: string;
  explorationId: string;
}) {
  const text = explorationMessages(locale);
  const identity = useSessionIdentity();
  const readOnly = identity?.user.role === 'viewer';
  const aiOn = aiEnabled(identity);
  const mayCreateProjects = canCreateProjects(identity);
  const base = `/workspaces/${workspaceId}/explorations/${explorationId}`;
  const [detail, setDetail] = useState<ExplorationDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [editingEvent, setEditingEvent] = useState(false);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, run } = useAction(explain);

  const load = useCallback(async () => {
    setDetail(await apiGet<ExplorationDetail>(base));
  }, [base]);

  useEffect(() => {
    setLoadFailed(false);
    load().catch(() => setLoadFailed(true));
  }, [load]);

  if (loadFailed) {
    return (
      <p className="notice error" role="alert">
        {text.loadFailed}
      </p>
    );
  }
  if (!detail) return <p role="status">…</p>;

  const { exploration } = detail;
  const archived = exploration.status === 'archived';
  // A mutation answers with the whole exploration; the screen shows exactly that.
  const mutate = (
    action: () => Promise<ExplorationDetail>,
    okText: string,
    during: Pending = null,
  ) =>
    run(async () => {
      setPending(during);
      try {
        setDetail(await action());
      } finally {
        setPending(null);
      }
    }, okText);

  return (
    <div className="stack">
      <p>
        <Link href={`/${locale}/explorations` as Route}>{text.back}</Link>
      </p>
      <Notice notice={notice} />
      {readOnly && (
        <p className="notice" role="status">
          {text.readOnly}
        </p>
      )}
      {archived && (
        <p className="notice warn" role="status">
          {text.archivedNote}
        </p>
      )}

      <section className="card stack" aria-labelledby="exploration-head">
        <div className="toolbar spread">
          <h2 id="exploration-head" dir={textDir(locale)}>
            {exploration.title}
            <span className="badge">{text.status[exploration.status]}</span>
          </h2>
          {!readOnly && (
            <div className="toolbar compact">
              <button
                type="button"
                className="secondary-button"
                disabled={busy || archived}
                onClick={() => setEditingEvent((value) => !value)}
              >
                {text.editEvent}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    () =>
                      apiSend<ExplorationDetail>(
                        'POST',
                        `${base}/${archived ? 'reopen' : 'archive'}`,
                        { expectedVersion: exploration.version },
                      ),
                    archived ? text.reopenedDone : text.archivedDone,
                  )
                }
              >
                {archived ? text.reopen : text.archive}
              </button>
            </div>
          )}
        </div>
        <p className="muted">
          {text.updated}: {formatDateTime(locale, exploration.updatedAt)}
        </p>
        {editingEvent && !archived ? (
          <EventForm
            locale={locale}
            title={exploration.title}
            eventText={exploration.eventText}
            busy={busy}
            onCancel={() => setEditingEvent(false)}
            onSave={(next) =>
              void mutate(
                () =>
                  apiSend<ExplorationDetail>('PATCH', base, {
                    expectedVersion: exploration.version,
                    ...next,
                  }),
                text.saved,
              ).then((ok) => {
                if (ok) setEditingEvent(false);
              })
            }
          />
        ) : (
          <>
            <h3>{text.eventHeading}</h3>
            <p dir={textDir(locale)} style={{ whiteSpace: 'pre-wrap' }}>
              {exploration.eventText}
            </p>
          </>
        )}
      </section>

      <Conversation
        locale={locale}
        detail={detail}
        readOnly={readOnly}
        aiOn={aiOn}
        busy={busy}
        pending={pending}
        onSend={(content) =>
          void run(async () => {
            setPending('message');
            try {
              await apiSend('POST', `${base}/messages`, { content });
            } finally {
              // The answer, or the failure of the model, is part of the conversation either way.
              await load().catch(() => undefined);
              setPending(null);
            }
          }, '')
        }
      />

      <Candidates
        locale={locale}
        detail={detail}
        readOnly={readOnly}
        mayCreateProjects={mayCreateProjects}
        aiOn={aiOn}
        busy={busy}
        pending={pending}
        onPropose={() =>
          void mutate(
            () => apiSend<ExplorationDetail>('POST', `${base}/propose`),
            text.proposed,
            'propose',
          )
        }
        onAdd={(candidate) =>
          mutate(
            () => apiSend<ExplorationDetail>('POST', `${base}/candidates`, candidate),
            text.added,
          )
        }
        onEdit={(candidate, next) =>
          mutate(
            () =>
              apiSend<ExplorationDetail>('PATCH', `${base}/candidates/${candidate.candidateKey}`, {
                basedOnVersionNo: candidate.versionNo,
                candidate: next,
              }),
            text.edited,
          )
        }
        onDecide={(candidate, decision, reason) =>
          mutate(
            () =>
              apiSend<ExplorationDetail>(
                'POST',
                `${base}/candidates/${candidate.candidateKey}/decision`,
                { decision, reason },
              ),
            text.decided,
          )
        }
      />
    </div>
  );
}

function EventForm({
  locale,
  title,
  eventText,
  busy,
  onSave,
  onCancel,
}: {
  locale: Locale;
  title: string;
  eventText: string;
  busy: boolean;
  onSave: (next: { title: string; eventText: string }) => void;
  onCancel: () => void;
}) {
  const text = explorationMessages(locale);
  const [form, setForm] = useState({ title, eventText });
  return (
    <form
      className="filter-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ title: form.title.trim(), eventText: form.eventText.trim() });
      }}
    >
      <div className="filter-grid">
        <label htmlFor="exploration-edit-title">{text.titleLabel}</label>
        <input
          id="exploration-edit-title"
          dir={textDir(locale)}
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          minLength={2}
          maxLength={200}
          required
        />
        <label htmlFor="exploration-edit-event">{text.eventLabel}</label>
        <textarea
          id="exploration-edit-event"
          dir={textDir(locale)}
          rows={6}
          value={form.eventText}
          onChange={(event) => setForm({ ...form, eventText: event.target.value })}
          maxLength={5000}
          required
        />
      </div>
      <div className="toolbar">
        <button className="primary-button" type="submit" disabled={busy}>
          {text.saveEvent}
        </button>
        <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>
          {text.cancel}
        </button>
      </div>
    </form>
  );
}

function Conversation({
  locale,
  detail,
  readOnly,
  aiOn,
  busy,
  pending,
  onSend,
}: {
  locale: Locale;
  detail: ExplorationDetail;
  readOnly: boolean;
  aiOn: boolean;
  busy: boolean;
  pending: Pending;
  onSend: (content: string) => void;
}) {
  const text = explorationMessages(locale);
  const id = useId();
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const { messages, limits, exploration } = detail;
  const state = composerState({
    status: exploration.status,
    usedMessages: limits.usedMessages,
    maxMessages: limits.maxMessages,
    readOnly,
    aiEnabled: aiOn,
  });

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages.length]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !state.canSend || busy) return;
    setDraft('');
    onSend(content);
  }

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{text.conversation}</h2>
      <p className="muted">{text.conversationHelp}</p>
      {messages.length === 0 ? (
        <p className="muted">{text.noMessages}</p>
      ) : (
        <ol className="plain-list" aria-label={text.conversation}>
          {messages.map((message) => (
            <li key={message.id}>
              <p>
                <strong>{message.role === 'admin' ? text.you : text.analyst}</strong>{' '}
                <small className="muted">{formatDateTime(locale, message.createdAt)}</small>
              </p>
              {message.status === 'failed' ? (
                <p className="notice error">{fill(text.answerFailed, { code: message.content })}</p>
              ) : (
                <p dir={textDir(locale)} style={{ whiteSpace: 'pre-wrap' }}>
                  {message.content}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
      <div ref={end} />
      {pending === 'message' && (
        <p role="status" className="muted">
          {text.sending}
        </p>
      )}
      <form className="filter-form" onSubmit={submit} aria-busy={pending === 'message'}>
        <label htmlFor={`${id}-message`}>{text.messageLabel}</label>
        <textarea
          id={`${id}-message`}
          dir={textDir(locale)}
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={limits.textMax.message}
          disabled={!state.canSend || busy}
        />
        <div className="toolbar">
          <button
            className="primary-button"
            type="submit"
            disabled={!state.canSend || busy || draft.trim() === ''}
          >
            {pending === 'message' ? text.sending : text.send}
          </button>
          <small className="muted">
            {fill(text.messageCount, {
              used: formatNumber(locale, limits.usedMessages),
              max: formatNumber(locale, limits.maxMessages),
            })}
          </small>
        </div>
        {state.blocked && <p className="muted">{text.blocked[state.blocked]}</p>}
      </form>
    </section>
  );
}

interface CandidateFields {
  title: string;
  problemDraft: string;
  why: string;
  assumptions: string;
  expectedOutput: string;
}
const emptyFields: CandidateFields = {
  title: '',
  problemDraft: '',
  why: '',
  assumptions: '',
  expectedOutput: '',
};

function Candidates({
  locale,
  detail,
  readOnly,
  mayCreateProjects,
  aiOn,
  busy,
  pending,
  onPropose,
  onAdd,
  onEdit,
  onDecide,
}: {
  locale: Locale;
  detail: ExplorationDetail;
  readOnly: boolean;
  mayCreateProjects: boolean;
  aiOn: boolean;
  busy: boolean;
  pending: Pending;
  onPropose: () => void;
  onAdd: (fields: CandidateFields) => Promise<boolean>;
  onEdit: (candidate: Candidate, fields: CandidateFields) => Promise<boolean>;
  onDecide: (candidate: Candidate, decision: CandidateDecision, reason: string) => Promise<boolean>;
}) {
  const text = explorationMessages(locale);
  const id = useId();
  const [filter, setFilter] = useState<CandidateFilter>('all');
  const [adding, setAdding] = useState(false);
  const { candidates, limits, exploration } = detail;
  const counts = countByState(candidates);
  const shown = filterCandidates(candidates, filter);
  const proposing = proposeState({
    status: exploration.status,
    usedCandidates: limits.usedCandidates,
    maxCandidates: limits.maxCandidates,
    readOnly,
    aiEnabled: aiOn,
  });
  const canAddByHand =
    !readOnly && exploration.status === 'open' && limits.usedCandidates < limits.maxCandidates;

  return (
    <section className="card stack" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{text.candidatesHeading}</h2>
      <p className="muted">{text.candidatesHelp}</p>
      <div className="toolbar spread">
        <div className="toolbar compact">
          <button
            type="button"
            className="primary-button"
            disabled={!proposing.canSend || busy}
            onClick={onPropose}
          >
            {pending === 'propose' ? text.proposing : text.propose}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!canAddByHand || busy}
            aria-expanded={adding}
            onClick={() => setAdding((value) => !value)}
          >
            {text.addByHand}
          </button>
        </div>
        <small className="muted">
          {fill(text.candidateCount, {
            used: formatNumber(locale, limits.usedCandidates),
            max: formatNumber(locale, limits.maxCandidates),
          })}
        </small>
      </div>
      {pending === 'propose' && (
        <p role="status" className="muted">
          {text.proposing}
        </p>
      )}
      {proposing.blocked && <p className="muted">{text.blockedPropose[proposing.blocked]}</p>}

      {adding && canAddByHand && (
        <CandidateForm
          locale={locale}
          initial={emptyFields}
          busy={busy}
          submitLabel={text.addSubmit}
          onCancel={() => setAdding(false)}
          onSubmit={async (fields) => {
            if (await onAdd(fields)) setAdding(false);
          }}
        />
      )}

      <div className="toolbar compact" role="group" aria-label={text.candidatesHeading}>
        {CANDIDATE_FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            className={item === filter ? 'primary-button' : 'secondary-button'}
            aria-pressed={item === filter}
            onClick={() => setFilter(item)}
          >
            {text.filters[item]} ({formatNumber(locale, counts[item])})
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted">{text.noneInFilter}</p>
      ) : (
        <ul className="plain-list">
          {shown.map((candidate) => (
            <CandidateCard
              key={candidate.candidateKey}
              locale={locale}
              candidate={candidate}
              explorationId={detail.exploration.id}
              readOnly={readOnly}
              mayCreateProjects={mayCreateProjects}
              busy={busy}
              onEdit={onEdit}
              onDecide={onDecide}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CandidateCard({
  locale,
  candidate,
  explorationId,
  readOnly,
  mayCreateProjects,
  busy,
  onEdit,
  onDecide,
}: {
  locale: Locale;
  candidate: Candidate;
  explorationId: string;
  readOnly: boolean;
  mayCreateProjects: boolean;
  busy: boolean;
  onEdit: (candidate: Candidate, fields: CandidateFields) => Promise<boolean>;
  onDecide: (candidate: Candidate, decision: CandidateDecision, reason: string) => Promise<boolean>;
}) {
  const text = explorationMessages(locale);
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const decisions = offeredDecisions(candidate.state);
  const rows: [string, string][] = [
    [text.problemDraft, candidate.problemDraft],
    [text.why, candidate.why],
    [text.assumptions, candidate.assumptions],
    [text.expectedOutput, candidate.expectedOutput],
  ];

  return (
    <li aria-labelledby={`${id}-title`}>
      <p>
        <strong id={`${id}-title`} dir={textDir(locale)}>
          {candidate.title}
        </strong>
        <span className={`badge state-${candidate.state}`}>{text.states[candidate.state]}</span>
        <span className="badge">{candidate.source === 'ai' ? text.fromAi : text.fromAdmin}</span>
        <small className="muted">
          {' '}
          {fill(text.version, { n: formatNumber(locale, candidate.versionNo) })}
        </small>
      </p>
      {editing ? (
        <CandidateForm
          locale={locale}
          initial={{
            title: candidate.title,
            problemDraft: candidate.problemDraft,
            why: candidate.why,
            assumptions: candidate.assumptions,
            expectedOutput: candidate.expectedOutput,
          }}
          busy={busy}
          submitLabel={text.editSave}
          onCancel={() => setEditing(false)}
          onSubmit={async (fields) => {
            if (await onEdit(candidate, fields)) setEditing(false);
          }}
        />
      ) : (
        <dl className="facts">
          {rows
            .filter(([, value]) => value !== '')
            .map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd dir={textDir(locale)} style={{ whiteSpace: 'pre-wrap' }}>
                  {value}
                </dd>
              </div>
            ))}
        </dl>
      )}
      {candidate.projects.length > 0 && (
        <div>
          <p className="muted">
            {candidate.state === 'promoted' ? text.promotedNote : text.madeProjects}
          </p>
          <ul className="plain-list">
            {candidate.projects.map((project) => (
              <li key={project.id}>
                <Link href={`/${locale}/projects/${project.id}` as Route}>
                  <span dir={textDir(locale)}>{project.title}</span>
                </Link>{' '}
                <small className="muted" dir="ltr">
                  {project.code}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
      {candidate.reason && candidate.state !== 'proposed' && (
        <p className="muted" dir={textDir(locale)}>
          {candidate.reason}
        </p>
      )}
      {!readOnly && !editing && (
        <div className="toolbar compact">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            {text.edit}
          </button>
          {canMakeProject({ state: candidate.state, readOnly, mayCreateProjects }) && (
            <Link
              className="primary-button"
              href={newProjectHref(locale, explorationId, candidate.candidateKey) as Route}
            >
              {text.makeProject}
            </Link>
          )}
          {decisions.length > 0 && (
            <>
              <label htmlFor={`${id}-reason`} className="visually-hidden">
                {text.reasonLabel}
              </label>
              <input
                id={`${id}-reason`}
                dir={textDir(locale)}
                value={reason}
                placeholder={text.reasonLabel}
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
              />
              {decisions.map((decision) => (
                <button
                  key={decision}
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() =>
                    void onDecide(candidate, decision, reason.trim()).then((ok) => {
                      if (ok) setReason('');
                    })
                  }
                >
                  {text.decisions[decision]}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function CandidateForm({
  locale,
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  locale: Locale;
  initial: CandidateFields;
  busy: boolean;
  submitLabel: string;
  onSubmit: (fields: CandidateFields) => Promise<void>;
  onCancel: () => void;
}) {
  const text = explorationMessages(locale);
  const id = useId();
  const [form, setForm] = useState(initial);
  const set = (key: keyof CandidateFields) => (value: string) => setForm({ ...form, [key]: value });
  return (
    <form
      className="filter-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({
          title: form.title.trim(),
          problemDraft: form.problemDraft.trim(),
          why: form.why.trim(),
          assumptions: form.assumptions.trim(),
          expectedOutput: form.expectedOutput.trim(),
        });
      }}
    >
      <div className="filter-grid">
        <label htmlFor={`${id}-title`}>{text.candidateTitle}</label>
        <input
          id={`${id}-title`}
          dir={textDir(locale)}
          value={form.title}
          onChange={(event) => set('title')(event.target.value)}
          minLength={2}
          maxLength={200}
          required
        />
        <label htmlFor={`${id}-problem`}>{text.problemDraft}</label>
        <textarea
          id={`${id}-problem`}
          dir={textDir(locale)}
          rows={4}
          value={form.problemDraft}
          onChange={(event) => set('problemDraft')(event.target.value)}
          maxLength={5000}
          required
        />
        <label htmlFor={`${id}-why`}>{text.why}</label>
        <textarea
          id={`${id}-why`}
          dir={textDir(locale)}
          rows={2}
          value={form.why}
          onChange={(event) => set('why')(event.target.value)}
          maxLength={2000}
        />
        <label htmlFor={`${id}-assumptions`}>{text.assumptions}</label>
        <textarea
          id={`${id}-assumptions`}
          dir={textDir(locale)}
          rows={2}
          value={form.assumptions}
          onChange={(event) => set('assumptions')(event.target.value)}
          maxLength={2000}
        />
        <label htmlFor={`${id}-output`}>{text.expectedOutput}</label>
        <textarea
          id={`${id}-output`}
          dir={textDir(locale)}
          rows={2}
          value={form.expectedOutput}
          onChange={(event) => set('expectedOutput')(event.target.value)}
          maxLength={2000}
        />
      </div>
      <div className="toolbar">
        <button className="primary-button" type="submit" disabled={busy}>
          {submitLabel}
        </button>
        <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>
          {text.cancel}
        </button>
      </div>
    </form>
  );
}
