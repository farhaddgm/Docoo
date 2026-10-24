import type { Route } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatNumber, type Locale, textDir } from '../../../i18n';
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
  locale,
  text,
  web,
  num,
}: {
  locale: Locale;
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
                <li key={index} dir={textDir(locale)}>
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
                  <a href={url} target="_blank" rel="noopener noreferrer" dir={textDir(locale)}>
                    {asText(page['title']) || url}
                  </a>
                ) : (
                  <span dir={textDir(locale)}>{asText(page['title'])}</span>
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

type Text = ReturnType<typeof workflowMessages>['out'];
type Level = 'solid' | 'limited' | 'unverified' | 'disputed';

const LEVEL_TONE: Record<Level, string> = {
  solid: 'tone-ok',
  limited: 'tone-warn',
  unverified: 'tone-neutral',
  disputed: 'tone-danger',
};

/** The grade of a finding; older outputs have none and fall back to what supported them. */
function levelOf(finding: Record<string, unknown>): Level {
  const level = asText(finding['level']);
  if (level === 'solid' || level === 'limited' || level === 'unverified' || level === 'disputed') {
    return level;
  }
  const support = asText(finding['support']);
  return support === 'knowledge' ? 'solid' : support === 'web' ? 'limited' : 'unverified';
}

function Finding({
  locale,
  text,
  finding,
  num,
}: {
  locale: Locale;
  text: Text;
  finding: Record<string, unknown>;
  num: (value: unknown) => string;
}) {
  const support = asText(finding['support']);
  const evidence = records(finding['evidence']);
  const level = levelOf(finding);
  return (
    <li className="stack">
      <p dir={textDir(locale)}>
        {asText(finding['claim'])}{' '}
        <small className="muted">
          ({text.source}: {asText(finding['source'])})
        </small>
        {support !== '' && (
          <span className={`badge ${LEVEL_TONE[level]}`} title={text.levelHelp[level]}>
            {text.levels[level]}
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
                <blockquote dir={textDir(locale)}>{asText(cite['quote'])}</blockquote>
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
                      <a href={pageUrl} target="_blank" rel="noopener noreferrer" dir="ltr">
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
}

/** The whole research at a glance (ADR-0038): how many findings are solid and which questions are open. */
function Overview({
  text,
  summary,
  rounds,
  num,
}: {
  text: Text;
  summary: Record<string, unknown>;
  rounds: number;
  num: (value: unknown) => string;
}) {
  const questions =
    typeof summary['questions'] === 'object' && summary['questions'] !== null
      ? (summary['questions'] as Record<string, unknown>)
      : {};
  const sources =
    typeof summary['sources'] === 'object' && summary['sources'] !== null
      ? (summary['sources'] as Record<string, unknown>)
      : {};
  const total = typeof questions['total'] === 'number' ? questions['total'] : 0;
  const open =
    (typeof questions['weak'] === 'number' ? questions['weak'] : 0) +
    (typeof questions['unanswered'] === 'number' ? questions['unanswered'] : 0);
  return (
    <section className="notice info" aria-label={text.overviewHeading} role="note">
      <h4>{text.overviewHeading}</h4>
      <p>
        {fill(text.overviewFindings, {
          findings: num(summary['findings']),
          solid: num(summary['solid']),
          limited: num(summary['limited']),
          unverified: num(summary['unverified']),
          disputed: num(summary['disputed']),
        })}
      </p>
      {total > 0 && (
        <p>
          {fill(text.overviewQuestions, {
            total: num(total),
            answered: num(questions['answered']),
            weak: num(questions['weak']),
            unanswered: num(questions['unanswered']),
          })}
        </p>
      )}
      <p>
        {fill(text.overviewSources, {
          knowledge: num(sources['knowledge']),
          web: num(sources['web']),
        })}
      </p>
      {rounds > 0 && <p>{fill(text.overviewRounds, { n: num(rounds) })}</p>}
      {open > 0 && <p>{text.overviewNext}</p>}
    </section>
  );
}

/**
 * The research output (ADR-0017): every finding says whether approved knowledge supports it,
 * and each citation says whether its quote was found in that knowledge. When the stage worked to
 * a research plan (ADR-0038) the findings are grouped under the questions they answer. Outputs
 * written before knowledge-backed research have no support or evidence and show the claim and
 * its source only.
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
  const summary =
    typeof data['summary'] === 'object' && data['summary'] !== null
      ? (data['summary'] as Record<string, unknown>)
      : null;
  const plan =
    typeof data['plan'] === 'object' && data['plan'] !== null
      ? (data['plan'] as Record<string, unknown>)
      : null;
  const planned = plan ? records(plan['questions']) : [];
  const offered = knowledge ? records(knowledge['offered']) : [];
  const conflicts = records(data['conflicts']);
  const web =
    typeof data['web'] === 'object' && data['web'] !== null
      ? (data['web'] as Record<string, unknown>)
      : null;
  const num = (value: unknown) => formatNumber(locale, typeof value === 'number' ? value : 0);
  const unplanned = findings.filter(
    (finding) => !planned.some((question) => question['id'] === finding['questionId']),
  );

  return (
    <div className="output-view">
      {summary && (
        <Overview text={text} summary={summary} rounds={records(data['rounds']).length} num={num} />
      )}
      <WebBlock locale={locale} text={text} web={web} num={num} />
      {verification && !summary && (
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

      {planned.length > 0 ? (
        <>
          {planned.map((question) => {
            const mine = findings.filter((finding) => finding['questionId'] === question['id']);
            const status = asText(question['status']);
            return (
              <Block
                key={asText(question['id'])}
                title={`${asText(question['id'])} — ${asText(question['question'])}`}
              >
                <p>
                  <span
                    className={`badge tone-${status === 'answered' ? 'ok' : status === 'weak' ? 'warn' : 'danger'}`}
                  >
                    {text.questionStatus[status] ?? status}
                  </span>{' '}
                  <small className="muted">
                    {fill(text.questionCounts, {
                      findings: num(question['findings']),
                      supported: num(question['supported']),
                    })}
                  </small>
                </p>
                {mine.length === 0 ? (
                  <p className="muted">{text.questionNoFindings}</p>
                ) : (
                  <ol className="plain-list">
                    {mine.map((finding, index) => (
                      <Finding
                        key={index}
                        locale={locale}
                        text={text}
                        finding={finding}
                        num={num}
                      />
                    ))}
                  </ol>
                )}
              </Block>
            );
          })}
          {unplanned.length > 0 && (
            <Block title={text.unplannedHeading}>
              <ol className="plain-list">
                {unplanned.map((finding, index) => (
                  <Finding key={index} locale={locale} text={text} finding={finding} num={num} />
                ))}
              </ol>
            </Block>
          )}
        </>
      ) : (
        <Block title={text.findings}>
          {findings.length === 0 ? (
            <p className="muted">{text.none}</p>
          ) : (
            <ol className="plain-list">
              {findings.map((finding, index) => (
                <Finding key={index} locale={locale} text={text} finding={finding} num={num} />
              ))}
            </ol>
          )}
        </Block>
      )}

      {conflicts.length > 0 && (
        <Block title={text.conflictsHeading}>
          <ul>
            {conflicts.map((conflict, index) => (
              <li key={index} dir={textDir(locale)}>
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
              <li key={index} dir={textDir(locale)}>
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
