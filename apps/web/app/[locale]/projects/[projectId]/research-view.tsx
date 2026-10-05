import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatNumber, type Locale } from '../../../i18n';
import { fill } from '../../agents/agent-messages';
import { workflowMessages } from './workflow-messages';

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item),
      )
    : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h4>{title}</h4>
      {children}
    </section>
  );
}

/**
 * The research output (ADR-0017): every finding says whether approved knowledge supports it,
 * and each citation says whether its quote was found in that knowledge. Outputs written before
 * knowledge-backed research have no support or evidence and show the claim and its source only.
 */
export function ResearchView({ locale, data }: { locale: Locale; data: Record<string, unknown> }) {
  const text = workflowMessages(locale).out;
  const findings = records(data['findings']);
  const knowledge =
    typeof data['knowledge'] === 'object' && data['knowledge'] !== null
      ? (data['knowledge'] as Record<string, unknown>)
      : null;
  const verification =
    typeof data['verification'] === 'object' && data['verification'] !== null
      ? (data['verification'] as Record<string, unknown>)
      : null;
  const offered = knowledge ? records(knowledge['offered']) : [];
  const conflicts = records(data['conflicts']);
  const num = (value: unknown) => formatNumber(locale, typeof value === 'number' ? value : 0);

  return (
    <div className="output-view">
      {verification && (
        <p>
          {fill(text.verificationSummary, {
            findings: num(verification['findings']),
            supported: num(verification['supported']),
            unverified: num(verification['unverified']),
            verified: num(verification['verified']),
            citations: num(verification['citations']),
          })}
        </p>
      )}
      {knowledge && knowledge['retrieveTool'] === 'denied' && (
        <p className="notice" role="note">
          {text.knowledgeDenied}
        </p>
      )}
      {knowledge && knowledge['verifierTool'] === 'denied' && (
        <p className="notice" role="note">
          {text.verifierDenied}
        </p>
      )}

      <Block title={text.findings}>
        {findings.length === 0 ? (
          <p className="muted">{text.none}</p>
        ) : (
          <ol className="plain-list">
            {findings.map((finding, index) => {
              const support = asText(finding['support']);
              const evidence = records(finding['evidence']);
              return (
                <li key={index} className="stack">
                  <p dir="auto">
                    {asText(finding['claim'])}{' '}
                    <small className="muted">
                      ({text.source}: {asText(finding['source'])})
                    </small>
                    {support !== '' && (
                      <span className={`badge tone-${support === 'knowledge' ? 'ok' : 'warn'}`}>
                        {support === 'knowledge' ? text.supportKnowledge : text.supportUnverified}
                      </span>
                    )}
                  </p>
                  {evidence.length > 0 && (
                    <ul className="plain-list" aria-label={text.citationsHeading}>
                      {evidence.map((cite, citeIndex) => {
                        const verified = cite['verified'] === true;
                        const problem = asText(cite['problem']);
                        const knowledgeId = asText(cite['knowledgeId']);
                        const title = asText(cite['title']);
                        return (
                          <li key={citeIndex}>
                            <blockquote dir="auto">{asText(cite['quote'])}</blockquote>
                            <small>
                              <strong>{asText(cite['ref'])}</strong>
                              {knowledgeId && (
                                <>
                                  {' '}
                                  <Link href={`/${locale}/knowledge/${knowledgeId}` as Route}>
                                    {title || knowledgeId}
                                  </Link>
                                  {typeof cite['versionNo'] === 'number' &&
                                    ` (${fill(text.versionShort, { n: num(cite['versionNo']) })})`}
                                </>
                              )}
                              {' — '}
                              {verified
                                ? text.citationVerified
                                : fill(text.citationFailed, {
                                    reason: text.citationProblems[problem] ?? problem,
                                  })}
                            </small>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Block>

      {conflicts.length > 0 && (
        <Block title={text.conflictsHeading}>
          <ul>
            {conflicts.map((conflict, index) => (
              <li key={index} dir="auto">
                {asText(conflict['description'])}
                {strings(conflict['refs']).length > 0 && (
                  <small className="muted"> ({strings(conflict['refs']).join(', ')})</small>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title={text.gaps}>
        {strings(data['gaps']).length === 0 ? (
          <p className="muted">{text.none}</p>
        ) : (
          <ul>
            {strings(data['gaps']).map((gap, index) => (
              <li key={index} dir="auto">
                {gap}
              </li>
            ))}
          </ul>
        )}
      </Block>

      {knowledge && (
        <Block title={text.knowledgeHeading}>
          {offered.length === 0 ? (
            <p className="muted">{text.knowledgeNone}</p>
          ) : (
            <ul>
              {offered.map((item, index) => (
                <li key={index}>
                  <strong>{asText(item['ref'])}</strong>{' '}
                  <Link href={`/${locale}/knowledge/${asText(item['knowledgeId'])}` as Route}>
                    {asText(item['title'])}
                  </Link>{' '}
                  <small className="muted">
                    ({fill(text.versionShort, { n: num(item['versionNo']) })})
                  </small>{' '}
                  <span className={`badge tone-${item['cited'] === true ? 'ok' : 'neutral'}`}>
                    {item['cited'] === true ? text.cited : text.notCited}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {knowledge['excludedRestricted'] === true && (
            <p className="muted">{text.restrictedExcluded}</p>
          )}
        </Block>
      )}
    </div>
  );
}
