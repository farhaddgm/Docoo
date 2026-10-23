'use client';

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { apiSend } from '../../api-client';
import { formatDateTime, formatNumber, type Locale, textDir } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { explainError, Notice, useAction } from '../use-action';
import { Badge, decisionTone, localToIso } from './knowledge-common';
import { knowledgeMessages } from './knowledge-messages';
import {
  criteria,
  MIN_OVERRIDE_REASON_LENGTH,
  type KnowledgeDetail,
  type Override,
} from './knowledge-types';
import { brainTone } from './review-panel';
import { FieldLabel, SectionTitle } from '../../info-tip';

type Decision = 'approve' | 'reject';
type Validity = 'version' | 'date';

/** The same rule the API applies: long enough and not one repeated character. */
function reasonProblem(reason: string): boolean {
  const trimmed = reason.trim();
  return (
    trimmed.length < MIN_OVERRIDE_REASON_LENGTH || new Set(trimmed.replace(/\s/gu, '')).size < 5
  );
}

const isActive = (override: Override): boolean =>
  override.expiresAt === null || Date.parse(override.expiresAt) > Date.now();

/**
 * KNO-004 and UX §8: the administrator can overrule the Brain. The panel shows the Brain's
 * decision and evidence, what the overruling would do, and asks for a reason and a duration;
 * the Brain's decision is never erased.
 */
export function OverridePanel({
  locale,
  workspaceId,
  knowledge,
  onChanged,
}: {
  locale: Locale;
  workspaceId: string;
  knowledge: KnowledgeDetail;
  onChanged: () => Promise<void>;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const version = knowledge.currentVersion;
  const review = version?.latestReview ?? null;
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.failed),
    [text],
  );
  const { busy, notice, setNotice, run } = useAction(explain);
  const [decision, setDecision] = useState<Decision>(
    review?.decision === 'approved' ? 'reject' : 'approve',
  );
  const [reason, setReason] = useState('');
  const [validity, setValidity] = useState<Validity>('version');
  const [until, setUntil] = useState('');
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const confirmHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (step === 'confirm') confirmHeading.current?.focus();
  }, [step]);

  // A new review (the version was audited again) starts the form over.
  const reviewId = review?.id;
  useEffect(() => {
    setStep('edit');
    setReason('');
    setValidity('version');
    setUntil('');
  }, [reviewId]);

  // Stale knowledge has to be renewed from its source first; an override cannot fix that.
  if (!version || !review || version.staleReason) return null;

  const active = version.overrides.find(isActive) ?? null;
  const untilIso = validity === 'date' ? localToIso(until) : undefined;
  const dateProblem = validity === 'date' && (!untilIso || Date.parse(untilIso) <= Date.now());
  const readyToReview = !reasonProblem(reason) && !dateProblem;
  const decisionName = decision === 'approve' ? text.approve : text.reject;
  const flags = review.criticalFlags.map((flag) => text.criticalFlags[flag] ?? flag);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (step === 'edit') {
      if (readyToReview) setStep('confirm');
      return;
    }
    if (busy || !review) return;
    const done = await run(async () => {
      await apiSend('POST', `/workspaces/${workspaceId}/audit-reviews/${review.id}/override`, {
        decision,
        reason: reason.trim(),
        ...(untilIso ? { expiresAt: untilIso } : {}),
      });
      await onChanged();
    }, '');
    setStep('edit');
    if (done) {
      setReason('');
      setValidity('version');
      setUntil('');
      setNotice({ ok: true, text: fill(text.overrideDone, { decision: decisionName }) });
    }
  }

  const effect = (
    <div className="stack" aria-live="polite">
      <h3>{text.effectHeading}</h3>
      <p>
        {fill(decision === 'approve' ? text.effectApprove : text.effectReject, {
          brain: text.brainDecisions[review.decision],
        })}
      </p>
      <p>
        {validity === 'date' && untilIso
          ? fill(text.effectUntilDate, { date: formatDateTime(locale, untilIso) })
          : text.effectUntilChange}
      </p>
      {decision === 'approve' && flags.length > 0 && (
        <p className="highlight" role="status">
          {fill(text.effectCritical, { flags: flags.join(locale === 'fa' ? '، ' : ', ') })}
        </p>
      )}
    </div>
  );

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <SectionTitle id={`${id}-heading`} help={text.overrideIntro}>
        {text.overrideHeading}
      </SectionTitle>
      <Notice notice={notice} />

      <dl className="facts">
        <div>
          <dt>{text.overrideBrain}</dt>
          <dd>
            <Badge tone={brainTone(review.decision)}>{text.brainDecisions[review.decision]}</Badge>{' '}
            {fill(text.overallValue, { n: formatNumber(locale, review.overall) })}
          </dd>
        </div>
        <div>
          <dt>{text.overrideCurrent}</dt>
          <dd>
            <Badge tone={decisionTone(version.effectiveDecision)}>
              {text.decisions[version.effectiveDecision]}
            </Badge>
          </dd>
        </div>
      </dl>
      <div>
        <strong>{text.overrideEvidence}</strong>
        <dl className="counts">
          {criteria.map((criterion) => (
            <div key={criterion}>
              <dt>{text.criteria[criterion]}</dt>
              <dd>{formatNumber(locale, review.scores[criterion])}</dd>
            </div>
          ))}
        </dl>
        {flags.length > 0 && (
          <ul className="output-list">
            {flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        )}
      </div>

      {active && (
        <p className="notice ok" role="status" dir={textDir(locale)}>
          <strong>{text.overrideActive}:</strong>{' '}
          {fill(text.overrideActiveText, {
            decision: active.decision === 'approve' ? text.approve : text.reject,
            date: formatDateTime(locale, active.createdAt),
            reason: active.reason,
          })}{' '}
          (
          {active.expiresAt
            ? fill(text.overrideExpiresOn, { date: formatDateTime(locale, active.expiresAt) })
            : text.overrideUntilChange}
          )
        </p>
      )}

      {step === 'edit' ? (
        <form className="field-stack" onSubmit={submit}>
          <fieldset className="mode-choice">
            <legend>{text.overrideDecision}</legend>
            {(['approve', 'reject'] as const).map((item) => (
              <label key={item} className="mode">
                <input
                  type="radio"
                  name={`${id}-decision`}
                  value={item}
                  checked={decision === item}
                  onChange={() => setDecision(item)}
                />{' '}
                {item === 'approve' ? text.approve : text.reject}
              </label>
            ))}
          </fieldset>

          <FieldLabel
            htmlFor={`${id}-reason`}
            help={text.overrideReasonHelp}
            helpId={`${id}-reason-help`}
          >
            {text.overrideReason}
          </FieldLabel>
          <textarea
            id={`${id}-reason`}
            dir={textDir(locale)}
            rows={4}
            value={reason}
            maxLength={2000}
            aria-describedby={`${id}-reason-help`}
            aria-invalid={reason.length > 0 && reasonProblem(reason)}
            onChange={(event) => setReason(event.target.value)}
          />
          <small className="muted">
            {fill(text.reasonCounter, { n: formatNumber(locale, reason.trim().length) })}
          </small>

          <fieldset className="mode-choice">
            <legend>{text.overrideValidity}</legend>
            {(['version', 'date'] as const).map((item) => (
              <label key={item} className="mode">
                <input
                  type="radio"
                  name={`${id}-validity`}
                  value={item}
                  checked={validity === item}
                  onChange={() => setValidity(item)}
                />{' '}
                {item === 'version' ? text.validityVersion : text.validityDate}
              </label>
            ))}
          </fieldset>
          {validity === 'date' && (
            <>
              <FieldLabel
                htmlFor={`${id}-until`}
                help={text.validityDateHelp}
                helpId={`${id}-until-help`}
              >
                {text.validityDateLabel}
              </FieldLabel>
              <input
                id={`${id}-until`}
                type="datetime-local"
                value={until}
                aria-describedby={`${id}-until-help`}
                aria-invalid={dateProblem}
                onChange={(event) => setUntil(event.target.value)}
              />
            </>
          )}

          {effect}

          <p>
            <button type="submit" className="primary-button" disabled={!readyToReview}>
              {text.overrideReview}
            </button>
          </p>
        </form>
      ) : (
        <form className="confirm-panel card field-stack" onSubmit={submit}>
          <h3 tabIndex={-1} ref={confirmHeading}>
            {text.overrideConfirmHeading}
          </h3>
          <p>
            <strong>{decisionName}</strong>
          </p>
          <p dir={textDir(locale)}>{reason.trim()}</p>
          {effect}
          <p>{text.overrideConfirmText}</p>
          <p className="toolbar">
            <button type="submit" className="primary-button" disabled={busy}>
              {text.overrideConfirm}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => setStep('edit')}
            >
              {text.overrideBack}
            </button>
          </p>
        </form>
      )}

      {version.overrides.length > 0 && (
        <div>
          <h3>{text.overrideHistory}</h3>
          <ul className="plain-list">
            {version.overrides.map((item) => (
              <li key={item.id} dir={textDir(locale)}>
                {fill(text.overrideRow, {
                  decision: item.decision === 'approve' ? text.approve : text.reject,
                  date: formatDateTime(locale, item.createdAt),
                  reason: item.reason,
                })}
                {item.expiresAt &&
                  ` (${fill(text.overrideRowExpires, { date: formatDateTime(locale, item.expiresAt) })})`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
