'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useState } from 'react';

import { apiGet, apiSend } from '../../../api-client';
import { formatDateTime, formatNumber, type Locale } from '../../../i18n';
import { explainError, Notice, useAction } from '../../use-action';
import { questionQualityMessages } from './question-quality-messages';

interface Finding {
  kind: 'strength' | 'weakness';
  criterion: string;
  severity: string;
  detail: string;
  recommendation: string | null;
  questions: { ref: string; id: string; number: number }[];
}

interface Review {
  id: string;
  criteria: string[];
  questionCount: number;
  status: 'completed' | 'failed';
  reason: string | null;
  score: number | null;
  summary: string | null;
  findings: Finding[];
  discarded: number;
  createdAt: string;
}

const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, value), template);

/** ADR-0024: the Brain's judgement of the analyst's questions, with the questions as evidence. */
export function QuestionQuality({
  locale,
  base,
}: {
  locale: Locale;
  /** `/workspaces/{id}/projects/{id}` */
  base: string;
}) {
  const text = questionQualityMessages(locale);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const explain = useCallback(
    (error: unknown) => explainError(error, text.errors, text.generic),
    [text],
  );
  const { busy, notice, run } = useAction(explain);

  const load = useCallback(async () => {
    const { reviews: items } = await apiGet<{ reviews: Review[] }>(
      `${base}/analysis/question-quality`,
    );
    setReviews(items);
    setLoadFailed(false);
  }, [base]);

  useEffect(() => {
    load().catch(() => setLoadFailed(true));
  }, [load]);

  function evaluate() {
    void run(async () => {
      await apiSend('POST', `${base}/analysis/question-quality`, {});
      await load();
    }, text.done);
  }

  const latest = reviews?.[0] ?? null;
  const earlier = reviews?.slice(1) ?? [];
  const weaknesses = latest?.findings.filter((finding) => finding.kind === 'weakness') ?? [];
  const strengths = latest?.findings.filter((finding) => finding.kind === 'strength') ?? [];

  const list = (items: Finding[], title: string, id: string) =>
    items.length > 0 && (
      <div>
        <h5 id={id}>{title}</h5>
        <ul className="plain-list" aria-labelledby={id}>
          {items.map((finding, index) => (
            <li key={`${finding.criterion}-${index}`}>
              <strong>{text.criteria[finding.criterion] ?? finding.criterion}</strong>
              {finding.kind === 'weakness' && (
                <>
                  {' '}
                  <span className="badge">
                    {text.severity}: {text.severities[finding.severity] ?? finding.severity}
                  </span>
                </>
              )}
              <br />
              <span dir="auto">{finding.detail}</span>
              {finding.recommendation && (
                <>
                  <br />
                  <small className="muted">
                    {text.recommendation}: <span dir="auto">{finding.recommendation}</span>
                  </small>
                </>
              )}
              <br />
              <small className="muted">
                {text.questions}:{' '}
                {finding.questions
                  .map((question) => formatNumber(locale, question.number))
                  .join('، ')}
              </small>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <section className="card stack" aria-labelledby="quality-heading" aria-busy={busy}>
      <h3 id="quality-heading">{text.title}</h3>
      <p className="muted">{text.intro}</p>
      <p className="muted">
        {text.criteriaNote}{' '}
        <Link href={`/${locale}/settings` as Route}>
          {locale === 'fa' ? 'تنظیمات' : 'Settings'}
        </Link>
      </p>
      <Notice notice={notice} />
      <div className="toolbar">
        <button className="primary-button" type="button" disabled={busy} onClick={evaluate}>
          {busy ? text.running : text.run}
        </button>
      </div>
      {loadFailed && (
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
      )}
      {reviews && !latest && <p className="muted">{text.none}</p>}
      {latest && (
        <div className="stack">
          <h4>
            {text.latest}{' '}
            <small className="muted">· {formatDateTime(locale, latest.createdAt)}</small>
          </h4>
          {latest.status === 'failed' ? (
            <p className="notice error" role="status">
              {text.failed[latest.reason ?? ''] ?? text.generic}
            </p>
          ) : (
            <>
              <p>
                <strong>
                  {fill(text.scoreOf, { n: formatNumber(locale, latest.score ?? 0) })}
                </strong>{' '}
                <span className="muted">
                  · {fill(text.questionsJudged, { n: formatNumber(locale, latest.questionCount) })}
                </span>
              </p>
              <p dir="auto">{latest.summary}</p>
              <p className="muted">
                {text.criteriaHeading}:{' '}
                {latest.criteria
                  .map((criterion) => text.criteria[criterion] ?? criterion)
                  .join('، ')}
              </p>
              {list(weaknesses, text.weaknesses, 'quality-weaknesses')}
              {list(strengths, text.strengths, 'quality-strengths')}
              {latest.findings.length === 0 && <p className="muted">{text.noFindings}</p>}
              {latest.discarded > 0 && (
                <p className="muted">
                  {fill(text.discarded, { n: formatNumber(locale, latest.discarded) })}
                </p>
              )}
            </>
          )}
        </div>
      )}
      {earlier.length > 0 && (
        <details>
          <summary>{text.earlier}</summary>
          <ul className="plain-list">
            {earlier.map((review) => (
              <li key={review.id}>
                {formatDateTime(locale, review.createdAt)} ·{' '}
                {review.status === 'completed'
                  ? fill(text.scoreOf, { n: formatNumber(locale, review.score ?? 0) })
                  : (text.failed[review.reason ?? ''] ?? text.generic)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
