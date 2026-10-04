'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import { apiGet, query } from '../../api-client';
import { formatDate, formatDateTime, formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { Badge, statusTone } from './knowledge-common';
import { knowledgeMessages } from './knowledge-messages';
import type { KnowledgeVersion, ListedReview } from './knowledge-types';
import { brainTone } from './review-panel';

/** The versions of a knowledge item and every audit it went through (KNO-002). */
export function HistoryPanel({
  locale,
  workspaceId,
  knowledgeId,
  currentVersionId,
  refreshKey,
}: {
  locale: Locale;
  workspaceId: string;
  knowledgeId: string;
  currentVersionId: string | null;
  /** Changes whenever the item was saved or audited, so the lists are read again. */
  refreshKey: string;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}`;
  const [versions, setVersions] = useState<KnowledgeVersion[] | null>(null);
  const [reviews, setReviews] = useState<ListedReview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState<{ id: string; content: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiGet<{ items: KnowledgeVersion[] }>(`${base}/knowledge/${knowledgeId}/versions`),
      apiGet<{ items: ListedReview[] }>(
        `${base}/audit-reviews${query({ knowledgeId, limit: '50' })}`,
      ),
    ])
      .then(([v, r]) => {
        if (!active) return;
        setVersions(v.items);
        setReviews(r.items);
        setFailed(false);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [base, knowledgeId, refreshKey]);

  const toggle = useCallback(
    async (versionId: string) => {
      if (shown?.id === versionId) {
        setShown(null);
        return;
      }
      setShown({ id: versionId, content: null });
      try {
        const result = await apiGet<{ version: KnowledgeVersion }>(
          `${base}/knowledge/${knowledgeId}/versions/${versionId}`,
        );
        setShown((current) =>
          current?.id === versionId
            ? { id: versionId, content: result.version.content ?? '' }
            : current,
        );
      } catch {
        setShown(null);
      }
    },
    [base, knowledgeId, shown?.id],
  );

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.versionsHeading}</h2>
      <p className="muted">{text.versionsHelp}</p>
      {failed && (
        <p className="notice error" role="alert">
          {text.failed}
        </p>
      )}
      {!failed && versions === null && <p role="status">{text.loading}</p>}
      {versions && (
        <ol className="version-list">
          {versions.map((item) => {
            const reason = item.provenance['reason'];
            const open = shown?.id === item.id;
            return (
              <li key={item.id} className="version-row">
                <strong>
                  {fill(text.versionLabel, { n: formatNumber(locale, item.versionNo) })}
                </strong>{' '}
                <Badge tone={statusTone(item.status)}>{text.statuses[item.status]}</Badge>
                {item.id === currentVersionId && (
                  <Badge tone="neutral">{text.versionCurrent}</Badge>
                )}{' '}
                <span className="muted">{formatDateTime(locale, item.createdAt)}</span>
                {typeof reason === 'string' && reason && (
                  <p dir="auto">{fill(text.versionReason, { reason })}</p>
                )}
                {(item.validFrom || item.validUntil) && (
                  <p className="muted">
                    {item.validFrom &&
                      `${text.factValidFrom}: ${formatDate(locale, item.validFrom)} `}
                    {item.validUntil &&
                      `${text.factValidUntil}: ${formatDate(locale, item.validUntil)}`}
                  </p>
                )}
                <p>
                  <button
                    type="button"
                    className="secondary-button"
                    aria-expanded={open}
                    aria-label={fill(text.viewVersionLabel, {
                      n: formatNumber(locale, item.versionNo),
                    })}
                    onClick={() => void toggle(item.id)}
                  >
                    {open ? text.hideVersion : text.viewVersion}
                  </button>
                </p>
                {open &&
                  (shown.content === null ? (
                    <p role="status">{text.versionLoading}</p>
                  ) : (
                    <pre className="json-block" dir="auto" tabIndex={0}>
                      {shown.content}
                    </pre>
                  ))}
              </li>
            );
          })}
        </ol>
      )}

      {reviews && reviews.length > 0 && (
        <div>
          <h3>{text.reviewHistory}</h3>
          <ul className="plain-list">
            {reviews.map((review) => (
              <li key={review.id}>
                <Badge tone={brainTone(review.decision)}>
                  {text.brainDecisions[review.decision]}
                </Badge>{' '}
                {fill(text.reviewHistoryRow, {
                  score: formatNumber(locale, review.overall),
                  date: formatDateTime(locale, review.createdAt),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
