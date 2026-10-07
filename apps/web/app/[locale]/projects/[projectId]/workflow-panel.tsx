'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { apiGet, apiSend, idempotencyKey } from '../../../api-client';
import { formatDateTime, formatNumber, messagesFor, type Locale } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { explainError, Notice, useAction } from '../../use-action';
import { StageOutput } from './stage-output';
import { workflowMessages } from './workflow-messages';

interface Run {
  id: string;
  runNo: number;
  status: string;
  currentStage: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

interface StageItem {
  id: string | null;
  stage: string;
  sequence: number;
  status: string;
  gateMode?: string;
  attemptLimit?: number;
  attemptsUsed?: number;
  passedByDecision?: boolean;
  pendingGateOutputId?: string | null;
}

interface HumanTask {
  id: string;
  stageRunId: string | null;
  kind: string;
  title: string;
  createdAt: string;
}

/** What the provider said the last time it refused a call of this project (needs provider.read). */
interface Refusal {
  model: string;
  errorCode: string | null;
  errorDetail: string | null;
}

interface AgentQuestion {
  id: string;
  stageRunId: string;
  role: string;
  question: string;
  reason: string;
  status: 'open' | 'answered' | 'dismissed';
  answer: string | null;
  createdAt: string;
}

interface Overview {
  run: Run | null;
  stages: StageItem[];
  humanTasks: HumanTask[];
  agentQuestions: AgentQuestion[];
}

interface StageOutputRow {
  id: string;
  versionNo: number;
  content: unknown;
  origin: string;
  current: boolean;
  createdAt: string;
}

interface StageDetail {
  id: string;
  stage: string;
  outputs: StageOutputRow[];
  reviews: {
    id: string;
    outputId: string;
    action: string;
    comment: string | null;
    createdAt: string;
  }[];
}

/** The parent's `useAction().run`: one action at a time, outcome shown in the page notice. */
type RunAction = (action: () => Promise<void>, okText: string) => Promise<boolean>;

const LIVE = ['starting', 'running', 'paused', 'waiting_for_human'];
// A running stage changes within seconds; a run waiting for you or paused changes only when you act.
const POLL_ACTIVE_MS = 5000;
const POLL_IDLE_MS = 15000;
const ACTED_WINDOW_MS = 60000;

export function WorkflowPanel({
  locale,
  workspaceId,
  projectId,
  projectStatus,
  refreshKey,
  onProjectRefresh,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  projectStatus: string;
  refreshKey: number;
  onProjectRefresh: () => void;
}) {
  const text = workflowMessages(locale);
  const common = reportMessagesFor(locale);
  const base = `/workspaces/${workspaceId}/projects/${projectId}`;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const signature = useRef('');
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, common.loadFailed),
    [text, common],
  );
  const { busy, notice, run } = useAction(explain);

  const load = useCallback(async () => {
    const { workflow } = await apiGet<{ workflow: Overview }>(`${base}/workflow`);
    setOverview(workflow);
    setFailed(false);
    setTick((value) => value + 1);
    // A paused project says why: the provider's own reason for its latest refusal.
    if (workflow.humanTasks.some((task) => task.kind === 'provider_failure')) {
      apiGet<{ items: (Refusal & { status: string })[] }>(
        `/workspaces/${workspaceId}/model-invocations?projectId=${projectId}&limit=20`,
      )
        .then(({ items }) =>
          setRefusal(
            items.find(
              (item) => item.status !== 'succeeded' && (item.errorDetail || item.errorCode),
            ) ?? null,
          ),
        )
        .catch(() => setRefusal(null));
    } else {
      setRefusal(null);
    }
    // A change of run or stage can change the project too (a blocked run pauses it).
    const next = `${workflow.run?.status}:${workflow.run?.currentStage}:${workflow.humanTasks.length}`;
    if (signature.current && signature.current !== next) onProjectRefresh();
    signature.current = next;
  }, [base, workspaceId, projectId, onProjectRefresh]);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load, refreshKey]);

  const live = overview?.run ? LIVE.includes(overview.run.status) : false;
  // After the administrator acts, the next stage starts within seconds: poll quickly for a while.
  const [recentlyActed, setRecentlyActed] = useState(false);
  const actedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => (actedTimer.current ? clearTimeout(actedTimer.current) : undefined), []);
  const interval =
    recentlyActed || overview?.run?.status === 'starting' || overview?.run?.status === 'running'
      ? POLL_ACTIVE_MS
      : POLL_IDLE_MS;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (!document.hidden) load().catch(() => undefined);
    }, interval);
    return () => clearInterval(timer);
  }, [live, interval, load]);

  const afterChange = useCallback(async () => {
    setRecentlyActed(true);
    if (actedTimer.current) clearTimeout(actedTimer.current);
    actedTimer.current = setTimeout(() => setRecentlyActed(false), ACTED_WINDOW_MS);
    await load().catch(() => setFailed(true));
    onProjectRefresh();
  }, [load, onProjectRefresh]);

  function start(kind: 'start' | 'sync') {
    void run(
      async () => {
        await apiSend('POST', `${base}/workflow/${kind}`);
        await afterChange();
      },
      kind === 'start' ? text.done.started : text.done.synced,
    );
  }

  function cancelRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await apiSend('POST', `${base}/workflow/cancel`, { reason: cancelReason.trim() });
      setCancelling(false);
      setCancelReason('');
      await afterChange();
    }, text.done.cancelled);
  }

  if (failed && !overview) {
    return (
      <p className="notice error" role="alert">
        {common.loadFailed}
      </p>
    );
  }
  if (!overview) return <p role="status">{common.loading}</p>;

  const current = overview.run;
  const stageLabel = (stage: string) => text.stages[stage] ?? stage;
  const reviewStages = overview.stages.filter((stage) => stage.id && stage.pendingGateOutputId);
  const decisionTasks = overview.humanTasks.filter(
    (task) => task.kind === 'attempt_limit' && task.stageRunId,
  );
  const running = overview.stages.find((stage) => stage.stage === current?.currentStage);

  return (
    <div className="stack">
      <Notice notice={notice} />
      <p className="visually-hidden" role="status">
        {running
          ? text.liveStatus
              .replace('{stage}', stageLabel(running.stage))
              .replace('{status}', text.stageStatuses[running.status] ?? running.status)
          : ''}
      </p>

      <section className="card" aria-labelledby="workflow-title">
        <div className="toolbar spread">
          <h2 id="workflow-title">{text.title}</h2>
          <div className="toolbar">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void load().catch(() => setFailed(true))}
            >
              {text.refresh}
            </button>
            {live && (
              <button
                data-write-action
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => start('sync')}
              >
                {text.sync}
              </button>
            )}
            {live && (
              <button
                data-write-action
                className="secondary-button danger"
                type="button"
                disabled={busy}
                aria-expanded={cancelling}
                onClick={() => setCancelling((open) => !open)}
              >
                {text.cancelRun}
              </button>
            )}
            {!live && projectStatus === 'active' && (
              <button
                data-write-action
                className="primary-button"
                type="button"
                disabled={busy}
                onClick={() => start('start')}
              >
                {text.start}
              </button>
            )}
          </div>
        </div>
        {current ? (
          <p>
            {text.runNo.replace('{n}', formatNumber(locale, current.runNo))}{' '}
            <span className={`badge state-${current.status}`}>
              {text.runStatuses[current.status] ?? current.status}
            </span>
            {current.startedAt && (
              <small className="muted"> · {formatDateTime(locale, current.startedAt)}</small>
            )}
          </p>
        ) : (
          <p className="muted">
            {projectStatus === 'active'
              ? text.noRunActive
              : projectStatus === 'draft'
                ? text.noRunDraft
                : text.noRun}
          </p>
        )}
        {live && <p className="muted">{text.syncHelp}</p>}
        {cancelling && (
          <form data-write-action className="filter-form" onSubmit={cancelRun}>
            <p className="muted">{text.cancelHelp}</p>
            <div className="filter-grid">
              <label htmlFor="cancel-reason">{text.cancelReason}</label>
              <input
                id="cancel-reason"
                value={cancelReason}
                minLength={3}
                maxLength={1000}
                onChange={(event) => setCancelReason(event.target.value)}
                autoComplete="off"
                required
              />
            </div>
            <div className="toolbar">
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? text.working : text.cancelConfirm}
              </button>
              <button
                data-write-action
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setCancelling(false)}
              >
                {text.cancel}
              </button>
            </div>
          </form>
        )}
        <h3>{text.stagesTitle}</h3>
        <ol className="stage-list">
          {overview.stages.map((stage) => (
            <li
              key={stage.stage}
              aria-current={stage.stage === current?.currentStage ? 'step' : undefined}
            >
              <span className="stage-name">{stageLabel(stage.stage)}</span>
              <span className={`badge state-${stage.status}`}>
                {text.stageStatuses[stage.status] ?? stage.status}
              </span>
              {stage.attemptsUsed !== undefined && stage.attemptLimit !== undefined && (
                <span className="muted">
                  {text.attempts
                    .replace('{used}', formatNumber(locale, stage.attemptsUsed))
                    .replace('{limit}', formatNumber(locale, stage.attemptLimit))}
                </span>
              )}
              {stage.gateMode && (
                <span className="muted">
                  {stage.gateMode === 'manual' ? text.gateManual : text.gateAutomatic}
                </span>
              )}
              {stage.passedByDecision && <span className="muted">{text.passedByDecision}</span>}
            </li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="tasks-title">
        <h2 id="tasks-title">
          {text.tasks}{' '}
          <span className="badge">{formatNumber(locale, overview.humanTasks.length)}</span>
        </h2>
        {overview.humanTasks.length === 0 ? (
          <p className="muted">{text.tasksEmpty}</p>
        ) : (
          <ul className="plain-list">
            {overview.humanTasks.map((task) => (
              <li key={task.id}>
                <strong>{text.taskKinds[task.kind] ?? task.title}</strong>
                <small className="muted"> · {formatDateTime(locale, task.createdAt)}</small>
                <br />
                <span className="muted">{text.taskHelp[task.kind] ?? ''}</span>
                {task.kind === 'provider_failure' && refusal && (
                  <>
                    <br />
                    <span>
                      {text.providerSaid}:{' '}
                      <span dir="auto" lang="en">
                        {[refusal.errorCode, refusal.errorDetail].filter(Boolean).join(' · ')}
                      </span>{' '}
                      <small className="muted" dir="ltr">
                        ({refusal.model})
                      </small>
                    </span>
                  </>
                )}
                {(task.kind === 'configuration' || task.kind === 'provider_failure') && (
                  <>
                    {' '}
                    <Link href={`/${locale}/providers` as Route}>{text.openProviders}</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {decisionTasks.map((task) => {
        const stage = overview.stages.find((item) => item.id === task.stageRunId);
        return stage ? (
          <AttemptDecision
            key={task.id}
            locale={locale}
            base={base}
            stage={stage}
            busy={busy}
            run={run}
            onChanged={afterChange}
          />
        ) : null;
      })}

      {overview.agentQuestions
        .filter((question) => question.status === 'open')
        .map((question) => (
          <AgentQuestionForm
            key={question.id}
            locale={locale}
            base={base}
            question={question}
            busy={busy}
            run={run}
            onChanged={afterChange}
          />
        ))}

      {overview.agentQuestions.some((question) => question.status !== 'open') && (
        <section className="card" aria-labelledby="agent-questions-title">
          <h2 id="agent-questions-title">{text.questionHistory}</h2>
          <ul className="plain-list">
            {overview.agentQuestions
              .filter((question) => question.status !== 'open')
              .map((question) => (
                <li key={question.id}>
                  <strong dir="auto">{question.question}</strong>
                  <small className="muted">
                    {' '}
                    · {text.roles[question.role] ?? question.role} ·{' '}
                    {question.status === 'answered' ? text.questionAnswered : text.questionDeclined}
                  </small>
                  {question.answer && (
                    <>
                      <br />
                      <span dir="auto">{question.answer}</span>
                    </>
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}

      {reviewStages.map((stage) => (
        <ReviewPanel
          key={`${stage.id}-${stage.pendingGateOutputId}`}
          locale={locale}
          base={base}
          stage={stage}
          tick={tick}
          busy={busy}
          run={run}
          onChanged={afterChange}
        />
      ))}
    </div>
  );
}

/** ADR-0023: an agent asked something mid-stage; the stage goes on with the answer (or without). */
function AgentQuestionForm({
  locale,
  base,
  question,
  busy,
  run,
  onChanged,
}: {
  locale: Locale;
  base: string;
  question: AgentQuestion;
  busy: boolean;
  run: RunAction;
  onChanged: () => Promise<void>;
}) {
  const text = workflowMessages(locale);
  const [answer, setAnswer] = useState('');

  function send(body: { answer: string | null }) {
    void run(async () => {
      await apiSend('POST', `${base}/agent-questions/${question.id}/answer`, body, {
        headers: { 'idempotency-key': idempotencyKey() },
      });
      setAnswer('');
      await onChanged();
    }, text.done.questionAnswered);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send({ answer: answer.trim() });
  }

  return (
    <form
      className="card filter-form"
      onSubmit={submit}
      aria-labelledby={`question-title-${question.id}`}
      aria-busy={busy}
    >
      <h2 id={`question-title-${question.id}`}>
        {text.questionTitle.replace('{role}', text.roles[question.role] ?? question.role)}
      </h2>
      <p>{text.questionHelp}</p>
      <p>
        <strong dir="auto">{question.question}</strong>
      </p>
      {question.reason && (
        <p className="muted">
          {text.questionWhy}: <span dir="auto">{question.reason}</span>
        </p>
      )}
      <div className="filter-grid">
        <label htmlFor={`question-answer-${question.id}`}>{text.questionAnswer}</label>
        <textarea
          id={`question-answer-${question.id}`}
          value={answer}
          maxLength={4000}
          rows={4}
          onChange={(event) => setAnswer(event.target.value)}
          required
        />
      </div>
      <div className="toolbar">
        <button className="primary-button" type="submit" disabled={busy || answer.trim() === ''}>
          {busy ? text.working : text.questionSend}
        </button>
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          aria-describedby={`question-decline-help-${question.id}`}
          onClick={() => send({ answer: null })}
        >
          {text.questionDecline}
        </button>
      </div>
      <small id={`question-decline-help-${question.id}`} className="muted">
        {text.questionDeclineHelp}
      </small>
    </form>
  );
}

/** WF-006: approve, reject with feedback, comment or edit the output waiting at a gate. */
function ReviewPanel({
  locale,
  base,
  stage,
  tick,
  busy,
  run,
  onChanged,
}: {
  locale: Locale;
  base: string;
  stage: StageItem;
  /** Changes whenever the workflow was read again; a failed load is retried then. */
  tick: number;
  busy: boolean;
  run: RunAction;
  onChanged: () => Promise<void>;
}) {
  const text = workflowMessages(locale);
  const common = reportMessagesFor(locale);
  const [detail, setDetail] = useState<StageDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [invalidJson, setInvalidJson] = useState(false);
  const stageBase = `${base}/stages/${stage.id}`;
  const outputId = stage.pendingGateOutputId ?? '';

  const load = useCallback(async () => {
    const { stage: loaded } = await apiGet<{ stage: StageDetail }>(stageBase);
    setDetail(loaded);
  }, [stageBase]);

  useEffect(() => {
    if (detail && !failed) return;
    load()
      .then(() => setFailed(false))
      .catch(() => setFailed(true));
  }, [load, tick]);

  const output = detail?.outputs.find((item) => item.id === outputId);
  const history = (detail?.reviews ?? []).filter((review) => review.outputId === outputId);

  function decide(action: 'approve' | 'reject' | 'comment') {
    const trimmed = comment.trim();
    const done =
      action === 'approve'
        ? text.done.approved
        : action === 'reject'
          ? text.done.rejected
          : text.done.commented;
    void run(async () => {
      await apiSend(
        'POST',
        `${stageBase}/outputs/${outputId}/${action}`,
        trimmed ? { comment: trimmed } : {},
        { headers: { 'idempotency-key': idempotencyKey() } },
      );
      setComment('');
      await onChanged();
      await load().catch(() => undefined);
    }, done);
  }

  function startEdit() {
    setDraft(JSON.stringify(output?.content ?? {}, null, 2));
    setReason('');
    setInvalidJson(false);
    setEditing(true);
  }

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let content: unknown;
    try {
      content = JSON.parse(draft);
    } catch {
      setInvalidJson(true);
      return;
    }
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
      setInvalidJson(true);
      return;
    }
    setInvalidJson(false);
    void run(async () => {
      await apiSend(
        'POST',
        `${stageBase}/outputs/${outputId}/edit`,
        { content, reason: reason.trim() },
        { headers: { 'idempotency-key': idempotencyKey() } },
      );
      setEditing(false);
      await onChanged();
    }, text.done.edited);
  }

  const heading = text.reviewTitle.replace('{stage}', text.stages[stage.stage] ?? stage.stage);
  const headingId = `review-title-${stage.stage}`;

  return (
    <section className="card" aria-labelledby={headingId}>
      <h2 id={headingId}>{heading}</h2>
      {failed && !detail ? (
        <div className="stack">
          <p className="notice error" role="alert">
            {common.loadFailed}
          </p>
          <div className="toolbar">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                void load()
                  .then(() => setFailed(false))
                  .catch(() => setFailed(true))
              }
            >
              {messagesFor(locale).retry}
            </button>
          </div>
        </div>
      ) : !detail ? (
        <p role="status">{common.loading}</p>
      ) : !output ? (
        <p className="muted">{text.noPendingOutput}</p>
      ) : (
        <>
          <p className="muted">
            {text.outputVersion.replace('{n}', formatNumber(locale, output.versionNo))} ·{' '}
            {text.outputOrigin[output.origin] ?? output.origin} ·{' '}
            {formatDateTime(locale, output.createdAt)}
          </p>
          <StageOutput locale={locale} stage={stage.stage} content={output.content} />
          <details>
            <summary>{text.rawView}</summary>
            <pre className="json-block" dir="ltr">
              {JSON.stringify(output.content, null, 2)}
            </pre>
          </details>

          {editing ? (
            <form data-write-action className="stack" onSubmit={saveEdit} aria-busy={busy}>
              <p className="muted">{text.editHelp}</p>
              <div className="field-stack">
                <label htmlFor={`edit-content-${stage.stage}`}>{text.editContent}</label>
                <textarea
                  id={`edit-content-${stage.stage}`}
                  dir="ltr"
                  rows={14}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  aria-invalid={invalidJson ? true : undefined}
                  aria-describedby={invalidJson ? `edit-invalid-${stage.stage}` : undefined}
                  required
                />
                {invalidJson && (
                  <p id={`edit-invalid-${stage.stage}`} className="notice error" role="alert">
                    {text.editInvalid}
                  </p>
                )}
                <label htmlFor={`edit-reason-${stage.stage}`}>{text.editReason}</label>
                <input
                  id={`edit-reason-${stage.stage}`}
                  value={reason}
                  minLength={3}
                  maxLength={1000}
                  onChange={(event) => setReason(event.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
              <div className="toolbar">
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? text.working : text.editSave}
                </button>
                <button
                  data-write-action
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  {text.cancel}
                </button>
              </div>
            </form>
          ) : (
            <div className="stack">
              <div className="field-stack">
                <label htmlFor={`review-comment-${stage.stage}`}>{text.commentLabel}</label>
                <textarea
                  id={`review-comment-${stage.stage}`}
                  dir="auto"
                  rows={3}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={5000}
                  aria-describedby={`review-help-${stage.stage}`}
                />
                <p id={`review-help-${stage.stage}`} className="muted">
                  {text.commentHelp}
                </p>
              </div>
              <div className="toolbar">
                <button
                  data-write-action
                  className="primary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => decide('approve')}
                >
                  {text.approve}
                </button>
                <button
                  data-write-action
                  className="secondary-button danger"
                  type="button"
                  disabled={busy || comment.trim().length < 3}
                  onClick={() => decide('reject')}
                >
                  {text.reject}
                </button>
                <button
                  data-write-action
                  className="secondary-button"
                  type="button"
                  disabled={busy || comment.trim().length < 3}
                  onClick={() => decide('comment')}
                >
                  {text.comment}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={startEdit}
                >
                  {text.editToggle}
                </button>
              </div>
            </div>
          )}

          <h3>{text.history}</h3>
          {history.length === 0 ? (
            <p className="muted">{text.historyEmpty}</p>
          ) : (
            <ul className="plain-list">
              {history.map((review) => (
                <li key={review.id}>
                  <strong>{text.reviewActions[review.action] ?? review.action}</strong>
                  <small className="muted"> · {formatDateTime(locale, review.createdAt)}</small>
                  {review.comment && <span dir="auto"> — {review.comment}</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** WF-005: past the attempt limit only a recorded decision with a reason lets the run go on. */
function AttemptDecision({
  locale,
  base,
  stage,
  busy,
  run,
  onChanged,
}: {
  locale: Locale;
  base: string;
  stage: StageItem;
  busy: boolean;
  run: RunAction;
  onChanged: () => Promise<void>;
}) {
  const text = workflowMessages(locale);
  const [decision, setDecision] = useState<'extend' | 'pass'>('extend');
  const [reason, setReason] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await apiSend(
        'POST',
        `${base}/stages/${stage.id}/attempt-decision`,
        { decision, reason: reason.trim() },
        { headers: { 'idempotency-key': idempotencyKey() } },
      );
      setReason('');
      await onChanged();
    }, text.done.decided);
  }

  return (
    <form
      data-write-action
      className="card filter-form"
      onSubmit={submit}
      aria-labelledby={`decision-title-${stage.stage}`}
      aria-busy={busy}
    >
      <h2 id={`decision-title-${stage.stage}`}>
        {text.decisionTitle.replace('{stage}', text.stages[stage.stage] ?? stage.stage)}
      </h2>
      <p>{text.decisionHelp}</p>
      <div className="filter-grid">
        <label htmlFor={`decision-${stage.stage}`}>{text.decisionChoice}</label>
        <select
          id={`decision-${stage.stage}`}
          value={decision}
          onChange={(event) => setDecision(event.target.value as 'extend' | 'pass')}
        >
          <option value="extend">{text.decisionExtend}</option>
          <option value="pass">{text.decisionPass}</option>
        </select>
        <label htmlFor={`decision-reason-${stage.stage}`}>{text.decisionReason}</label>
        <input
          id={`decision-reason-${stage.stage}`}
          value={reason}
          minLength={10}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          autoComplete="off"
          required
        />
      </div>
      <div className="toolbar">
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? text.working : text.decisionSubmit}
        </button>
      </div>
    </form>
  );
}
