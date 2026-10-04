'use client';

import { useId } from 'react';

import { formatDate, formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { Badge, joinList, safeHref } from './knowledge-common';
import { knowledgeMessages, type KnowledgeText } from './knowledge-messages';
import type { Citation, Claim, Review } from './knowledge-types';
import { claimReasonKey } from './reasons';

/** Where in the original a claim comes from, in words (ING-003, ING-008). */
export function locationText(
  text: KnowledgeText,
  locale: Locale,
  locator: Claim['locator'],
): string {
  if (!locator) return '';
  const n = (value: string | number) =>
    typeof value === 'number' ? formatNumber(locale, value) : value;
  const parts: string[] = [];
  const add = (key: string, template: string, param = 'n') => {
    const value = locator[key];
    if (value !== undefined) parts.push(fill(template, { [param]: n(value) }));
  };
  add('page', text.locationPage);
  add('slide', text.locationSlide);
  add('sheet', text.locationSheet);
  add('table', text.locationTable);
  add('paragraph', text.locationParagraph);
  add('row', text.locationRow);
  add('range', text.locationCells);
  add('line', text.locationLine);
  add('path', text.locationPath);
  add('footnote', text.locationFootnote);
  if (locator['notes'] !== undefined) parts.push(text.locationNotes);
  if (typeof locator['startMs'] === 'number' && typeof locator['endMs'] === 'number') {
    parts.push(
      fill(text.locationTime, {
        from: formatNumber(locale, Math.round(locator['startMs'] / 1000)),
        to: formatNumber(locale, Math.round(locator['endMs'] / 1000)),
      }),
    );
  }
  if (typeof locator['start'] === 'number' && typeof locator['end'] === 'number') {
    parts.push(
      fill(text.locationRange, {
        start: formatNumber(locale, locator['start']),
        end: formatNumber(locale, locator['end']),
      }),
    );
  }
  if (parts.length === 0 && locator['provided'] !== undefined) parts.push(text.locationProvided);
  return parts.join(' · ');
}

function CitationView({
  text,
  locale,
  citation,
}: {
  text: KnowledgeText;
  locale: Locale;
  citation: Citation;
}) {
  const href = safeHref(citation.sourceRef);
  const missing = citation.missingFields.map((field) => text.missingFields[field] ?? field);
  return (
    <li className="citation">
      <p>
        <Badge tone={citation.complete ? 'ok' : 'warn'}>
          {citation.complete ? text.citationComplete : text.citationIncomplete}
        </Badge>{' '}
        <strong dir="auto">{citation.title ?? citation.sourceRef ?? '—'}</strong>
      </p>
      {!citation.complete && missing.length > 0 && (
        <p className="muted">{fill(text.citationMissing, { fields: joinList(locale, missing) })}</p>
      )}
      <dl className="facts">
        {citation.sourceRef && (
          <div>
            <dt>{text.factSource}</dt>
            <dd dir="ltr">
              {href ? (
                <a href={href} rel="noopener noreferrer">
                  {citation.sourceRef}
                </a>
              ) : (
                citation.sourceRef
              )}
            </dd>
          </div>
        )}
        {citation.publisher && (
          <div>
            <dt>{text.citationPublisher}</dt>
            <dd dir="auto">{citation.publisher}</dd>
          </div>
        )}
        {citation.author && (
          <div>
            <dt>{text.citationAuthor}</dt>
            <dd dir="auto">{citation.author}</dd>
          </div>
        )}
        {citation.publishedAt && (
          <div>
            <dt>{text.citationPublished}</dt>
            <dd>{formatDate(locale, citation.publishedAt)}</dd>
          </div>
        )}
        {citation.accessedAt && (
          <div>
            <dt>{text.citationAccessed}</dt>
            <dd>{formatDate(locale, citation.accessedAt)}</dd>
          </div>
        )}
        {citation.locator && (
          <div>
            <dt>{text.citationLocator}</dt>
            <dd dir="auto">{citation.locator}</dd>
          </div>
        )}
        {citation.quoteDigest && (
          <div>
            <dt>{text.citationDigest}</dt>
            <dd dir="ltr">
              <code>{citation.quoteDigest.slice(0, 16)}…</code>
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}

/**
 * The claims of a version with the Brain's verdict on each, its citations and the open
 * conflicts it is part of (UX §8 claim view, FR-KNO-010).
 */
export function ClaimsPanel({
  locale,
  claims,
  review,
  conflictCounts,
}: {
  locale: Locale;
  claims: readonly Claim[];
  review: Review | null;
  /** Open conflicts per claim id. */
  conflictCounts: ReadonlyMap<string, number>;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const results = new Map((review?.claimResults ?? []).map((result) => [result.claimId, result]));

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.claimsHeading}</h2>
      <p className="muted">{text.claimsHelp}</p>
      {claims.length === 0 && (
        <p className="muted" role="status">
          {text.claimsNone}
        </p>
      )}
      <ol className="question-list">
        {claims.map((claim) => {
          const result = results.get(claim.id);
          const reasonKey = result ? claimReasonKey(result.reason) : null;
          const where = locationText(text, locale, claim.locator);
          const conflicts = conflictCounts.get(claim.id) ?? 0;
          return (
            <li key={claim.id} className="question">
              <p className="question-text" dir="auto">
                {claim.text}
              </p>
              <p>
                <Badge tone="neutral">{text.claimKinds[claim.kind] ?? claim.kind}</Badge>
                {result ? (
                  <Badge tone={result.supported ? 'ok' : 'danger'}>
                    {result.supported ? text.supported : text.notSupported}
                  </Badge>
                ) : (
                  <Badge tone="neutral">{text.notAudited}</Badge>
                )}
                {conflicts > 0 && (
                  <Badge tone="danger">
                    {fill(text.claimConflicts, { n: formatNumber(locale, conflicts) })}
                  </Badge>
                )}
              </p>
              {result && (
                <p className="muted" dir="auto">
                  {reasonKey ? text.claimReasons[reasonKey] : result.reason}
                </p>
              )}
              {where && (
                <p className="muted">
                  {text.location}: {where}
                </p>
              )}
              {claim.citations.length > 0 ? (
                <div>
                  <strong>{text.citationsHeading}</strong>
                  <ul className="plain-list">
                    {claim.citations.map((citation) => (
                      <CitationView
                        key={citation.id}
                        text={text}
                        locale={locale}
                        citation={citation}
                      />
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="muted">{text.noCitations}</p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
