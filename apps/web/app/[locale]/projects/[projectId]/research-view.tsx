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

/** Only http(s) addresses become links; a provider's page address is data, not trusted markup. */
function safeUrl(value: unknown): string | null {
  const raw = asText(value);
  return /^https?:\/\//iu.test(raw) ? raw : null;
}

/** What the web search did in this attempt: used, found nothing, failed, refused or switched off. */
function WebBlock({
  text,
  web,
  num,
}: {
  text: ReturnType<typeof workflowMessages>['out'];
  web: Record<string, unknown> | null;
  num: (value: unknown) => string;
}) {
  const status = asText(web?.['status']);
  const pages = records(web?.['sources']);
  const queries = strings(web?.['queries']);
  if (status === 'used') {
    return (
      <Block title={text.webHeading}>
        <p>{fill(text.webUsed, { queries: num(queries.length), pages: num(pages.length) })}</p>
        {queries.length > 0 && (
          <>
            <h5>{text.webQueries}</h5>
            <ul>
              {queries.map((query, index) => (
                <li key={index} dir="auto">
                  {query}
                </li>
              ))}
            </ul>
          </>
        )}
        <h5>{text.webPages}</h5>
        <ul>
          {pages.map((page, index) => {
            const url = safeUrl(page['url']);
            return (
              <li key={index}>
                <strong>{asText(page['ref'])}</strong>{' '}
                {url ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" dir="auto">
                    {asText(page['title']) || url}
                  </a>
                ) : (
                  <span dir="auto">{asText(page['title'])}</span>
                )}{' '}
                <small className="muted">
                  ({page['cited'] === true ? text.cited : text.notCited})
                </small>
              </li>
            );
          })}
        </ul>
      </Block>
    );
  }
  const message =
    status === 'none'
      ? text.webNone
      : status === 'failed'
        ? fill(text.webFailed, { code: asText(web?.['code']) || '—' })
        : status === 'denied'
          ? text.webDenied
          : text.webOff;
  return (
    <p className="notice" role="note">
      {message}
    </p>
  );
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
  const web =
    typeof data['web'] === 'object' && data['web'] !== null
      ? (data['web'] as Record<string, unknown>)
      : null;
  const num = (value: unknown) => formatNumber(locale, typeof value === 'number' ? value : 0);

  return (
    <div className="output-view">
      <WebBlock text={text} web={web} num={num} />
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
                        {support === 'knowledge'
                          ? text.supportKnowledge
                          : support === 'web'
                            ? text.supportWeb
                            : text.supportUnverified}
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
                        const pageUrl = safeUrl(cite['url']);
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
                              {pageUrl && (
                                <>
                                  {' '}
                                  <a
                                    href={pageUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    dir="ltr"
                                  >
                                    {title || pageUrl}
                                  </a>
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
