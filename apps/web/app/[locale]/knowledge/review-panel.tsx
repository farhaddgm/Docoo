'use client';

import { useId } from 'react';

import { formatDateTime, formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { Badge } from './knowledge-common';
import { knowledgeMessages, type KnowledgeText } from './knowledge-messages';
import { criteria, rubrics, type BrainDecision, type Review } from './knowledge-types';
import { parseReason } from './reasons';

export const brainTone = (decision: BrainDecision) =>
  decision === 'approved' ? 'ok' : decision === 'rejected' ? 'danger' : 'warn';

/** One of the auditor's reasons, in the reader's language. */
export function reasonText(text: KnowledgeText, locale: Locale, raw: string): string {
  const reason = parseReason(raw);
  const r = text.reasons;
  switch (reason.kind) {
    case 'credibility':
      return fill(r.credibility, {
        type:
          text.sourceTypes[reason.sourceType as keyof typeof text.sourceTypes] ?? reason.sourceType,
        complete: reason.complete ? r.credibilityComplete : r.credibilityIncomplete,
        partial: reason.partial ? r.credibilityPartial : '',
      });
    case 'relevance':
      return fill(r.relevance, {
        matched: formatNumber(locale, reason.matched),
        terms: formatNumber(locale, reason.terms),
      });
    case 'evidence':
      return fill(r.evidence, {
        supported: formatNumber(locale, reason.supported),
        total: formatNumber(locale, reason.total),
      });
    case 'recency_ended':
      return r.recencyEnded;
    case 'recency_age':
      return fill(r.recencyAge, { years: formatNumber(locale, reason.years) });
    case 'recency_undated':
      return r.recencyUndated;
    case 'bias':
      return fill(r.bias, { count: formatNumber(locale, reason.count) });
    case 'conflict':
      return fill(r.conflict, { count: formatNumber(locale, reason.count) });
    case 'critical':
      return fill(r.critical, { flag: text.criticalFlags[reason.flag] ?? reason.flag });
    default:
      return reason.raw;
  }
}

/**
 * The Brain's audit of one version (FR-KNO-003..005): the overall score, the six criteria with
 * their weights, critical flaws and the reasons, so the decision can be judged, not just read.
 */
export function ReviewPanel({ locale, review }: { locale: Locale; review: Review | null }) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const rubric = review ? rubrics[review.rubricVersion] : undefined;

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.reviewHeading}</h2>
      {!review ? (
        <p className="muted" role="status">
          {text.reviewNone}
        </p>
      ) : (
        <>
          <p>
            <Badge tone={brainTone(review.decision)}>{text.brainDecisions[review.decision]}</Badge>{' '}
            <span className="muted" dir="auto">
              {fill(text.reviewMeta, {
                auditor: review.auditor,
                rubric: review.rubricVersion,
                date: formatDateTime(locale, review.createdAt),
              })}
            </span>
          </p>

          <div>
            <strong id={`${id}-overall`}>{text.overallLabel}</strong>{' '}
            <span>{fill(text.overallValue, { n: formatNumber(locale, review.overall) })}</span>
            <meter
              className="progress-meter"
              min={0}
              max={100}
              value={review.overall}
              aria-labelledby={`${id}-overall`}
              aria-valuetext={fill(text.overallValue, { n: formatNumber(locale, review.overall) })}
            >
              {review.overall}
            </meter>
          </div>
          {rubric && (
            <p className="muted">
              {fill(text.thresholds, {
                overall: formatNumber(locale, rubric.approveOverall),
                min: formatNumber(locale, rubric.approveCredibility),
                revise: formatNumber(locale, rubric.reviseOverall),
              })}
            </p>
          )}

          <ul className="criteria-list">
            {criteria.map((criterion) => {
              const score = review.scores[criterion];
              const name = text.criteria[criterion];
              return (
                <li key={criterion}>
                  <div className="toolbar spread">
                    <strong>{name}</strong>
                    <span>
                      {fill(text.overallValue, { n: formatNumber(locale, score) })}
                      {rubric && (
                        <small className="muted">
                          {' · '}
                          {fill(text.criterionWeight, {
                            n: formatNumber(locale, rubric.weights[criterion]),
                          })}
                        </small>
                      )}
                    </span>
                  </div>
                  <meter
                    className="progress-meter"
                    min={0}
                    max={100}
                    value={score}
                    aria-label={fill(text.scoreMeterLabel, {
                      name,
                      score: formatNumber(locale, score),
                    })}
                  >
                    {score}
                  </meter>
                  <small className="muted">{text.criteriaHelp[criterion]}</small>
                </li>
              );
            })}
          </ul>

          {review.criticalFlags.length > 0 && (
            <div className="highlight" role="status">
              <h3>{text.criticalHeading}</h3>
              <p>{text.criticalHelp}</p>
              <ul>
                {review.criticalFlags.map((flag) => (
                  <li key={flag}>{text.criticalFlags[flag] ?? flag}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3>{text.reasonsHeading}</h3>
            <ul className="output-list">
              {review.reasons.map((reason, index) => (
                <li key={`${index}-${reason}`} dir="auto">
                  {reasonText(text, locale, reason)}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
