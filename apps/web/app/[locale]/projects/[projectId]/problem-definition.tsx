'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { apiSend, idempotencyKey } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { DefinitionView } from './definition-view';
import { problemMessages } from './problem-messages';
import type { Contradiction, Definition, DefinitionVersion } from './problem-types';

type Run = (action: () => Promise<void>, okText: string) => Promise<boolean>;

/**
 * The problem definition the analyst wrote (FR-ANL-005): readable, with assumptions and
 * unresolved points set apart (FR-ANL-006), and the administrator's decision. Approval and
 * rejection use the same stage review commands as the workflow section.
 */
export function DefinitionCard({
  locale,
  projectId,
  base,
  definition,
  versions,
  contradictions,
  readOnly,
  busy,
  run,
  onChanged,
}: {
  locale: Locale;
  projectId: string;
  base: string;
  definition: Definition;
  versions: DefinitionVersion[];
  contradictions: Contradiction[];
  readOnly: boolean;
  busy: boolean;
  run: Run;
  onChanged: () => Promise<void>;
}) {
  const text = problemMessages(locale);
  const [rejecting, setRejecting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const review = `${base}/stages/${definition.stageRunId}/outputs/${definition.outputId}`;
  const deciding = definition.status === 'awaiting_approval' && !readOnly;
  const openContradictions = contradictions.filter((item) => item.status === 'open');

  function approve() {
    void run(async () => {
      await apiSend(
        'POST',
        `${review}/approve`,
        {},
        { headers: { 'idempotency-key': idempotencyKey() } },
      );
      await onChanged();
    }, text.done.approved);
  }

  function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await apiSend(
        'POST',
        `${review}/reject`,
        { comment: feedback.trim() },
        { headers: { 'idempotency-key': idempotencyKey() } },
      );
      setRejecting(false);
      setFeedback('');
      await onChanged();
    }, text.done.rejected);
  }

  return (
    <section className="card stack" aria-labelledby="definition-heading">
      <h3 id="definition-heading">
        {text.definitionTitle}{' '}
        <span className="badge">
          {text.versionLabel.replace('{n}', formatNumber(locale, definition.versionNo))}
        </span>{' '}
        <span
          className={`badge state-${definition.status === 'awaiting_approval' ? 'pending' : definition.status}`}
        >
          {text.definitionStatuses[definition.status] ?? definition.status}
        </span>
      </h3>
      <p className="muted">
        {text.origins[definition.origin] ?? definition.origin} ·{' '}
        {formatDateTime(locale, definition.createdAt)}
        {definition.passedByDecision && <> · {text.passedByDecision}</>}
      </p>

      <DefinitionView locale={locale} content={definition.content} />

      <section className="highlight" aria-labelledby="unresolved-questions-heading">
        <h4 id="unresolved-questions-heading">{text.unresolvedQuestionsTitle}</h4>
        <p className="muted">{text.unresolvedQuestionsHelp}</p>
        {definition.unresolvedQuestions.length === 0 ? (
          <p>{text.unresolvedNone}</p>
        ) : (
          <ul>
            {definition.unresolvedQuestions.map((question) => (
              <li key={question.number}>
                <strong>{formatNumber(locale, question.number)}.</strong>{' '}
                <span dir="auto">{question.text}</span>{' '}
                <span className={`badge answer-${question.status}`}>
                  {text.modes[question.status] ?? question.status}
                </span>
                {question.note && (
                  <>
                    {' '}
                    <small className="muted" dir="auto">
                      {question.note}
                    </small>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {openContradictions.length > 0 && (
        <section className="highlight" aria-labelledby="open-contradictions-heading">
          <h4 id="open-contradictions-heading">{text.openContradictionsTitle}</h4>
          <ul>
            {openContradictions.map((item) => (
              <li key={item.id}>
                <strong>
                  {text.between
                    .replace('{a}', formatNumber(locale, item.questions[0]))
                    .replace('{b}', formatNumber(locale, item.questions[1]))}
                </strong>{' '}
                <span dir="auto">{item.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {definition.status === 'rejected' && definition.rejectionReason && (
        <p className="notice error" role="status">
          <span dir="auto">{definition.rejectionReason}</span>
        </p>
      )}

      {deciding && (
        <div className="stack">
          <div className="toolbar" role="group" aria-label={text.definitionTitle}>
            <button
              data-write-action
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={approve}
            >
              {text.approve}
            </button>
            <button
              className="secondary-button danger"
              type="button"
              disabled={busy}
              aria-expanded={rejecting}
              onClick={() => setRejecting((value) => !value)}
            >
              {text.reject}
            </button>
            <Link
              className="secondary-button"
              href={`/${locale}/projects/${projectId}?tab=workflow` as Route}
            >
              {text.editInWorkflow}
            </Link>
          </div>
          {rejecting && (
            <form data-write-action className="field-stack" aria-busy={busy} onSubmit={reject}>
              <label htmlFor="definition-feedback">{text.feedback}</label>
              <textarea
                id="definition-feedback"
                rows={4}
                dir="auto"
                value={feedback}
                minLength={3}
                maxLength={5000}
                required
                aria-describedby="definition-feedback-help"
                onChange={(event) => setFeedback(event.target.value)}
              />
              <small id="definition-feedback-help" className="muted">
                {text.feedbackHelp}
              </small>
              <div className="toolbar">
                <button className="primary-button" type="submit" disabled={busy}>
                  {busy ? text.working : text.confirmReject}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setRejecting(false)}
                >
                  {text.cancel}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {versions.length > 1 && (
        <details>
          <summary>{text.versionsTitle}</summary>
          <ul className="plain-list">
            {versions.map((version) => (
              <li key={version.outputId}>
                <strong>
                  {text.versionLabel.replace('{n}', formatNumber(locale, version.versionNo))}
                </strong>{' '}
                <span
                  className={`badge state-${version.status === 'awaiting_approval' ? 'pending' : version.status}`}
                >
                  {text.definitionStatuses[version.status] ?? version.status}
                </span>
                {version.approved && (
                  <span className="badge state-approved">{text.approvedMark}</span>
                )}{' '}
                <small className="muted">
                  {text.origins[version.origin] ?? version.origin} ·{' '}
                  {formatDateTime(locale, version.createdAt)}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
