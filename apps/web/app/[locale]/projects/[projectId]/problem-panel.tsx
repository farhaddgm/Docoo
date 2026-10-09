'use client';
import { useReadOnlyAccess } from '../../resource-access';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { apiGet, apiSend, idempotencyKey } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { reportMessagesFor } from '../../../report-messages';
import { explainError, Notice, useAction } from '../../use-action';
import { DefinitionCard } from './problem-definition';
import { QuestionQuality } from './question-quality';
import { problemMessages } from './problem-messages';
import {
  emptyDraft,
  type Analysis,
  type AnswerMode,
  type Attachment,
  type Batch,
  type DefinitionVersion,
  type Draft,
  type Question,
} from './problem-types';
import { draftOf, draftProblem, QuestionEditor } from './question-editor';
import { uploadProjectFile } from './upload-file';

const POLL_WORKING_MS = 4000;
const POLL_IDLE_MS = 20000;

const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);

/**
 * The analyst's questions and the administrator's answers (FR-ANL-001..006): progress,
 * coverage, the open batch, the "later" queue, contradictions and the problem definition.
 */
export function ProblemPanel({
  locale,
  workspaceId,
  projectId,
  projectStatus,
  refreshKey,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  projectStatus: string;
  refreshKey: number;
  /** Something the rest of the page shows may have changed (a stage was approved). */
  onChanged: () => void;
}) {
  const accessReadOnly = useReadOnlyAccess();
  const text = problemMessages(locale);
  const common = reportMessagesFor(locale);
  const workspaceBase = `/workspaces/${workspaceId}`;
  const base = `${workspaceBase}/projects/${projectId}`;
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [versions, setVersions] = useState<DefinitionVersion[]>([]);
  const [failed, setFailed] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [showProblems, setShowProblems] = useState(false);
  const [finishing, setFinishing] = useState<string | null>(null);
  const latestLoad = useRef(0);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, setNotice, run } = useAction(explain);

  const load = useCallback(async () => {
    const sequence = (latestLoad.current += 1);
    const [overview, listed, defined] = await Promise.all([
      apiGet<{ analysis: Analysis }>(`${base}/analysis`),
      apiGet<{ batches: Batch[] }>(`${base}/analysis/question-batches`),
      apiGet<{ definitions: DefinitionVersion[] }>(`${base}/problem-definitions`),
    ]);
    // A slow earlier read must not replace a newer one.
    if (sequence !== latestLoad.current) return;
    setAnalysis(overview.analysis);
    setBatches(
      listed.batches.map((batch) => ({
        ...batch,
        questions: [...batch.questions].sort(
          (a, b) => (b.priority?.score ?? 0) - (a.priority?.score ?? 0) || a.number - b.number,
        ),
      })),
    );
    setVersions(defined.definitions);
    setFailed(false);
  }, [base]);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load, refreshKey]);

  const phase = analysis?.phase;
  const interval =
    phase === 'analysing' || phase === 'not_started'
      ? POLL_WORKING_MS
      : phase === 'answering' || phase === 'awaiting_approval'
        ? POLL_IDLE_MS
        : null;
  useEffect(() => {
    if (interval === null) return;
    const timer = setInterval(() => {
      if (!document.hidden) load().catch(() => undefined);
    }, interval);
    return () => clearInterval(timer);
  }, [interval, load]);

  const afterChange = useCallback(async () => {
    await load().catch(() => setFailed(true));
    onChanged();
  }, [load, onChanged]);

  if (failed && !analysis) {
    return (
      <p className="notice error" role="alert">
        {common.loadFailed}
      </p>
    );
  }
  if (!analysis) return <p role="status">{common.loading}</p>;

  const readOnly = accessReadOnly || !['active', 'paused'].includes(projectStatus);
  const openBatch = batches.find((batch) => batch.id === analysis.openBatchId) ?? null;
  const closedBatches = batches.filter((batch) => batch.status === 'submitted');
  const answering = analysis.phase === 'answering' && !readOnly;
  const queueOpen = (analysis.phase === 'answering' || analysis.phase === 'analysing') && !readOnly;
  const progress = analysis.progress;
  // Questions of the open batch are answered in its form; the queue holds the closed ones.
  const followUps = analysis.followUps.filter((question) => question.batchId !== openBatch?.id);

  // ---------------------------------------------------------------- drafts

  const patchDraft = (question: Question, change: (draft: Draft) => Draft) =>
    setDrafts((current) => ({
      ...current,
      [question.id]: change(current[question.id] ?? draftOf(question)),
    }));
  const upload = async (file: File): Promise<Attachment> => {
    try {
      return await uploadProjectFile(workspaceBase, projectId, file);
    } catch (error) {
      setNotice({ ok: false, text: explain(error) });
      throw error;
    }
  };
  const forget = (ids: readonly string[]) =>
    setDrafts((current) => {
      const next = { ...current };
      for (const id of ids) delete next[id];
      return next;
    });

  const draftFor = (question: Question): Draft | undefined =>
    drafts[question.id] ?? (question.status === 'open' ? emptyDraft : undefined);

  const toAnswer = (question: Question, draft: Draft) => ({
    questionId: question.id,
    status: draft.mode as AnswerMode,
    ...(draft.text.trim() ? { text: draft.text.trim() } : {}),
    ...(draft.mode === 'answered' && draft.files.length > 0
      ? { attachments: draft.files.map((file) => ({ sourceId: file.sourceId })) }
      : {}),
  });

  function saveBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!openBatch) return;
    const pending = openBatch.questions.filter((question) => {
      const draft = drafts[question.id];
      return draft !== undefined && draft.mode !== null && !draft.uploading;
    });
    if (pending.length === 0) {
      setNotice({ ok: false, text: text.nothingToSave });
      return;
    }
    const invalid = pending.find((question) => draftProblem(drafts[question.id]!));
    if (invalid) {
      setShowProblems(true);
      document
        .getElementById(`batch-question-${invalid.number}`)
        ?.scrollIntoView({ block: 'center' });
      return;
    }
    setShowProblems(false);
    void run(async () => {
      const { result } = await apiSend<{ result: { saved: number; remainingOpen: number } }>(
        'POST',
        `${workspaceBase}/question-batches/${openBatch.id}/answers`,
        { answers: pending.map((question) => toAnswer(question, drafts[question.id]!)) },
        { headers: { 'idempotency-key': idempotencyKey() } },
      );
      forget(pending.map((question) => question.id));
      await afterChange();
      setNotice({
        ok: true,
        text:
          result.remainingOpen === 0
            ? text.saved.complete
            : fill(text.saved.partial, {
                saved: formatNumber(locale, result.saved),
                left: formatNumber(locale, result.remainingOpen),
              }),
      });
    }, '');
  }

  function saveOne(question: Question) {
    const draft = drafts[question.id];
    if (!draft || draft.mode === null) {
      setNotice({ ok: false, text: text.nothingToSave });
      return;
    }
    if (draftProblem(draft)) {
      setShowProblems(true);
      return;
    }
    setShowProblems(false);
    void run(async () => {
      await apiSend(
        'POST',
        `${workspaceBase}/question-batches/${question.batchId}/answers`,
        { answers: [toAnswer(question, draft)] },
        { headers: { 'idempotency-key': idempotencyKey() } },
      );
      forget([question.id]);
      await afterChange();
    }, text.saved.single);
  }

  function markRemaining(mode: Exclude<AnswerMode, 'answered'>) {
    if (!openBatch) return;
    setDrafts((current) => {
      const next = { ...current };
      for (const question of openBatch.questions) {
        const draft = current[question.id] ?? (question.status === 'open' ? emptyDraft : undefined);
        if (question.status === 'open' && (draft?.mode ?? null) === null) {
          next[question.id] = { ...(draft ?? emptyDraft), mode };
        }
      }
      return next;
    });
  }

  function requestFinish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (finishing === null) return;
    void run(async () => {
      await apiSend(
        'POST',
        `${base}/analysis/finish`,
        { reason: finishing.trim() },
        { headers: { 'idempotency-key': idempotencyKey() } },
      );
      setFinishing(null);
      await afterChange();
    }, text.finishRequested);
  }

  // ---------------------------------------------------------------- view

  const unmarked = openBatch
    ? openBatch.questions.filter(
        (question) => question.status === 'open' && (drafts[question.id]?.mode ?? null) === null,
      ).length
    : 0;
  const missing = Math.max(0, progress.minimum - progress.asked);
  const phaseText =
    analysis.phase === 'not_started' && projectStatus === 'active'
      ? text.phases['starting']
      : text.phases[analysis.phase];
  const gaps = analysis.coverageGaps.map((key) => text.categories[key] ?? key);

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="card stack" aria-labelledby="problem-heading">
        <h3 id="problem-heading">{text.title}</h3>
        <p className="muted">{text.intro}</p>
        <p role="status" aria-busy={analysis.phase === 'analysing'}>
          <strong>{text.phaseHeading}:</strong> {phaseText}
        </p>
        {projectStatus === 'paused' && <p className="notice">{text.pausedNote}</p>}
        {readOnly && <p className="notice">{text.readOnlyNote}</p>}
        {analysis.finish.requested && analysis.phase !== 'approved' && (
          <p className="notice" role="status">
            {text.finishRequested}
          </p>
        )}

        <h4 id="progress-heading">{text.progressTitle}</h4>
        <p>
          {fill(text.progressSummary, {
            asked: formatNumber(locale, progress.asked),
            max: formatNumber(locale, progress.maximum),
            answered: formatNumber(locale, progress.answered),
            min: formatNumber(locale, progress.minimum),
          })}
        </p>
        <meter
          className="progress-meter"
          min={0}
          max={progress.maximum}
          low={progress.minimum}
          value={progress.asked}
          aria-label={text.progressLabel}
        >
          {progress.asked}/{progress.maximum}
        </meter>
        <p className="muted">
          {progress.minimumReached
            ? text.minimumReached
            : fill(text.minimumMissing, { n: formatNumber(locale, missing) })}
        </p>
        <dl className="counts" aria-labelledby="progress-heading">
          {(['asked', 'answered', 'unanswered', 'irrelevant', 'later', 'open'] as const).map(
            (key) => (
              <div key={key}>
                <dt>{text.counts[key]}</dt>
                <dd>{formatNumber(locale, progress[key])}</dd>
              </div>
            ),
          )}
        </dl>
      </section>

      {analysis.progress.asked > 0 && <QuestionQuality locale={locale} base={base} />}

      {analysis.understanding && (
        <section className="card stack" aria-labelledby="understanding-heading">
          <h3 id="understanding-heading">{text.understandingTitle}</h3>
          <div>
            <h4>{text.understood}</h4>
            <p dir="auto">{analysis.understanding.understood}</p>
          </div>
          {analysis.understanding.nextAmbiguity && (
            <div>
              <h4>{text.nextAmbiguity}</h4>
              <p dir="auto">{analysis.understanding.nextAmbiguity}</p>
            </div>
          )}
        </section>
      )}

      {openBatch && (
        <form
          data-write-action
          className="card stack"
          aria-labelledby="batch-heading"
          aria-busy={busy}
          noValidate
          onSubmit={saveBatch}
        >
          <h3 id="batch-heading">
            {fill(text.batchTitle, { n: formatNumber(locale, openBatch.batchNo) })}
          </h3>
          <p className="muted">{text.batchHelp}</p>
          {openBatch.understood && (
            <p dir="auto">
              <strong>{text.understood}:</strong> {openBatch.understood}
            </p>
          )}
          {answering && (
            <div className="toolbar" role="group" aria-label={text.bulkTitle}>
              {(['later', 'irrelevant', 'unanswered'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="secondary-button"
                  disabled={busy || unmarked === 0}
                  onClick={() => markRemaining(mode)}
                >
                  {text.bulk[mode]}
                </button>
              ))}
            </div>
          )}
          <ol className="question-list">
            {openBatch.questions.map((question) => (
              <QuestionEditor
                key={question.id}
                locale={locale}
                anchor="batch"
                question={question}
                draft={draftFor(question)}
                showProblem={showProblems}
                disabled={!answering || busy}
                patch={(change) => patchDraft(question, change)}
                onEdit={() =>
                  setDrafts((current) => ({ ...current, [question.id]: draftOf(question) }))
                }
                onStopEditing={() => forget([question.id])}
                onUpload={upload}
              />
            ))}
          </ol>
          <p className="muted" role="status">
            {unmarked === 0
              ? text.allSet
              : fill(text.remaining, { n: formatNumber(locale, unmarked) })}
          </p>
          {answering && (
            <div className="toolbar">
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? text.saving : text.save}
              </button>
            </div>
          )}
        </form>
      )}

      <section className="card stack" aria-labelledby="coverage-heading">
        <h3 id="coverage-heading">{text.coverageTitle}</h3>
        <p className="muted">{text.coverageHelp}</p>
        {gaps.length > 0 && progress.asked > 0 && (
          <p className="notice" role="status">
            {fill(text.gapAlert, { list: gaps.join(locale === 'fa' ? '، ' : ', ') })}
          </p>
        )}
        <div className="table-scroll" tabIndex={0} role="region" aria-label={text.coverageTitle}>
          <table>
            <thead>
              <tr>
                <th scope="col">{text.dimension}</th>
                <th scope="col">{text.colAsked}</th>
                <th scope="col">{text.colAnswered}</th>
                <th scope="col">{text.colLeft}</th>
                <th scope="col">{text.colLevel}</th>
              </tr>
            </thead>
            <tbody>
              {analysis.coverage.map((row) => (
                <tr key={row.category}>
                  <th scope="row">
                    {text.categories[row.category] ?? row.category}{' '}
                    <small className="muted">
                      ({row.required ? text.required : text.optional})
                    </small>
                  </th>
                  <td>{formatNumber(locale, row.asked)}</td>
                  <td>{formatNumber(locale, row.answered)}</td>
                  <td>{formatNumber(locale, row.open + row.later + row.unanswered)}</td>
                  <td>
                    <span className={`badge level-${row.level}`}>
                      {text.levels[row.level] ?? row.level}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack" aria-labelledby="followups-heading">
        <h3 id="followups-heading">{text.followUpsTitle}</h3>
        <p className="muted">{text.followUpsHelp}</p>
        {followUps.length === 0 ? (
          <p>{text.followUpsNone}</p>
        ) : (
          <ol className="question-list">
            {followUps.map((question) => (
              <QuestionEditor
                key={question.id}
                locale={locale}
                anchor="later"
                question={question}
                draft={drafts[question.id]}
                showProblem={showProblems}
                disabled={!queueOpen || busy}
                patch={(change) => patchDraft(question, change)}
                onEdit={() =>
                  setDrafts((current) => ({
                    ...current,
                    [question.id]: { ...draftOf(question), mode: null },
                  }))
                }
                onStopEditing={() => forget([question.id])}
                onUpload={upload}
                footer={
                  drafts[question.id] ? (
                    <button
                      data-write-action
                      type="button"
                      className="primary-button"
                      disabled={busy || drafts[question.id]?.uploading === true}
                      onClick={() => saveOne(question)}
                    >
                      {text.saveOne}
                    </button>
                  ) : null
                }
              />
            ))}
          </ol>
        )}
      </section>

      <section className="card stack" aria-labelledby="contradictions-heading">
        <h3 id="contradictions-heading">{text.contradictionsTitle}</h3>
        {analysis.contradictions.length === 0 ? (
          <p>{text.contradictionsNone}</p>
        ) : (
          <ul className="plain-list">
            {analysis.contradictions.map((item) => (
              <li key={item.id}>
                <strong>
                  {fill(text.between, {
                    a: formatNumber(locale, item.questions[0]),
                    b: formatNumber(locale, item.questions[1]),
                  })}
                </strong>{' '}
                <span className={`badge state-${item.status === 'open' ? 'pending' : 'approved'}`}>
                  {text.contradictionStatus[item.status]}
                </span>
                <br />
                <span dir="auto">{item.description}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {analysis.finish.available && !readOnly && (
        <section className="card stack" aria-labelledby="finish-heading">
          <h3 id="finish-heading">{text.finishTitle}</h3>
          <p className="muted">{text.finishHelp}</p>
          {finishing === null ? (
            <div className="toolbar">
              <button
                className="secondary-button"
                type="button"
                disabled={busy}
                onClick={() => setFinishing('')}
              >
                {text.finishAction}
              </button>
            </div>
          ) : (
            <form
              data-write-action
              className="field-stack"
              aria-busy={busy}
              onSubmit={requestFinish}
            >
              <label htmlFor="finish-reason">{text.finishReason}</label>
              <input
                id="finish-reason"
                value={finishing}
                minLength={3}
                maxLength={1000}
                required
                autoComplete="off"
                onChange={(event) => setFinishing(event.target.value)}
              />
              <div className="toolbar">
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? text.working : text.finishConfirm}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setFinishing(null)}
                >
                  {text.cancel}
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {analysis.definition && (
        <DefinitionCard
          locale={locale}
          projectId={projectId}
          base={base}
          definition={analysis.definition}
          versions={versions}
          contradictions={analysis.contradictions}
          readOnly={readOnly}
          busy={busy}
          run={run}
          onChanged={afterChange}
        />
      )}

      <section className="card stack" aria-labelledby="history-heading">
        <h3 id="history-heading">{text.historyTitle}</h3>
        {closedBatches.length === 0 ? (
          <p>{text.historyNone}</p>
        ) : (
          closedBatches.map((batch) => (
            <details key={batch.id}>
              <summary>
                {fill(text.batchSummary, {
                  n: formatNumber(locale, batch.batchNo),
                  count: formatNumber(locale, batch.questions.length),
                  state: text.batchStates[batch.status] ?? batch.status,
                })}
                {batch.submittedAt && <> · {formatDateTime(locale, batch.submittedAt)}</>}
              </summary>
              {batch.understood && (
                <p dir="auto">
                  <strong>{text.understood}:</strong> {batch.understood}
                </p>
              )}
              <ol className="question-list history">
                {batch.questions.map((question) => (
                  <li key={question.id}>
                    <strong>{formatNumber(locale, question.number)}.</strong>{' '}
                    <span dir="auto">{question.text}</span>
                    <br />
                    <span className={`badge answer-${question.status}`}>
                      {text.modes[question.status] ?? question.status}
                    </span>{' '}
                    <span dir="auto">{question.answer?.text ?? ''}</span>
                    {question.answer?.attachments.map((file) => (
                      <small key={file.sourceId} className="muted" dir="auto">
                        {' '}
                        · {text.attachmentLabel}: {file.title}
                      </small>
                    ))}
                    {question.revisions > 1 && (
                      <small className="muted">
                        {' '}
                        ·{' '}
                        {fill(text.revisionsNote, {
                          n: formatNumber(locale, question.revisions - 1),
                        })}
                      </small>
                    )}
                  </li>
                ))}
              </ol>
            </details>
          ))
        )}
      </section>
    </div>
  );
}
