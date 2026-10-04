'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { apiGet, query } from '../../api-client';
import { formatDate, formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { Badge, decisionTone, ScopeList, statusTone } from './knowledge-common';
import { knowledgeMessages } from './knowledge-messages';
import {
  claimKinds,
  knowledgeStatuses,
  sourceTypes,
  type ClaimRow,
  type KnowledgeRow,
} from './knowledge-types';

type View = 'documents' | 'claims';
type Support = '' | 'yes' | 'no' | 'unaudited';

/**
 * UX §8: the audit queue has two views of the same knowledge: the documents with their
 * status and score, and the claims with their citations, conflicts and decision.
 */
export function QueuePanel({
  locale,
  workspaceId,
  scopeType,
  scopeId,
  initialStatus = '',
  refreshKey = 0,
}: {
  locale: Locale;
  workspaceId: string;
  /** Limits the queue to the knowledge of one project or topic (a project's knowledge tab). */
  scopeType?: 'project' | 'topic';
  scopeId?: string;
  initialStatus?: string;
  refreshKey?: number;
}) {
  const scoped = scopeType !== undefined && scopeId !== undefined;
  const text = knowledgeMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}`;
  const [view, setView] = useState<View>('documents');
  const [status, setStatus] = useState(initialStatus);
  const [sourceType, setSourceType] = useState('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [support, setSupport] = useState<Support>('');
  const [kind, setKind] = useState('');
  const [conflictedOnly, setConflictedOnly] = useState(false);

  const [documents, setDocuments] = useState<KnowledgeRow[] | null>(null);
  const [claims, setClaims] = useState<ClaimRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [more, setMore] = useState(false);
  const request = useRef(0);

  // The search text applies a moment after typing stops, so each key is not a request.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (cursor?: string) => {
      const mine = ++request.current;
      try {
        if (view === 'documents') {
          const page = await apiGet<{ items: KnowledgeRow[]; nextCursor: string | null }>(
            `${base}/knowledge${query({
              limit: '50',
              cursor,
              status,
              sourceType,
              q: applied,
              ...(scopeType && scopeId ? { scopeType, scopeId } : {}),
            })}`,
          );
          if (mine !== request.current) return;
          setDocuments((current) => (cursor && current ? [...current, ...page.items] : page.items));
          setNextCursor(page.nextCursor);
        } else {
          const page = await apiGet<{ items: ClaimRow[]; nextCursor: string | null }>(
            `${base}/knowledge-claims${query({
              limit: '50',
              cursor,
              status,
              supported: support,
              kind,
              conflicted: conflictedOnly ? 'true' : '',
            })}`,
          );
          if (mine !== request.current) return;
          setClaims((current) => (cursor && current ? [...current, ...page.items] : page.items));
          setNextCursor(page.nextCursor);
        }
        setFailed(false);
      } catch {
        if (mine === request.current) setFailed(true);
      }
    },
    [base, view, status, sourceType, applied, support, kind, conflictedOnly, scopeType, scopeId],
  );

  useEffect(() => {
    setDocuments(null);
    setClaims(null);
    setNextCursor(null);
    void load();
  }, [load, refreshKey]);

  async function loadMore() {
    if (!nextCursor || more) return;
    setMore(true);
    await load(nextCursor);
    setMore(false);
  }

  const rows = view === 'documents' ? documents : claims;
  const filtered =
    status !== '' ||
    sourceType !== '' ||
    applied !== '' ||
    support !== '' ||
    kind !== '' ||
    conflictedOnly;

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{text.queueHeading}</h2>
      <p className="muted">{text.queueHelp}</p>

      {!scoped && (
        <div className="toolbar" role="group" aria-label={text.viewLabel}>
          {(['documents', 'claims'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className="secondary-button"
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {item === 'documents' ? text.documentView : text.claimView}
            </button>
          ))}
        </div>
      )}

      <form className="filter-grid" aria-label={text.filters} onSubmit={(e) => e.preventDefault()}>
        <label htmlFor={`${id}-status`}>{text.status}</label>
        <select id={`${id}-status`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{text.allStatuses}</option>
          {knowledgeStatuses.map((item) => (
            <option key={item} value={item}>
              {text.statuses[item]}
            </option>
          ))}
        </select>
        {view === 'documents' ? (
          <>
            <label htmlFor={`${id}-source`}>{text.sourceTypeFilter}</label>
            <select
              id={`${id}-source`}
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
            >
              <option value="">{text.allSourceTypes}</option>
              {sourceTypes.map((item) => (
                <option key={item} value={item}>
                  {text.sourceTypes[item]}
                </option>
              ))}
            </select>
            <label htmlFor={`${id}-search`}>{text.search}</label>
            <input
              id={`${id}-search`}
              type="search"
              dir="auto"
              value={search}
              maxLength={100}
              onChange={(e) => setSearch(e.target.value)}
            />
          </>
        ) : (
          <>
            <label htmlFor={`${id}-support`}>{text.supportFilter}</label>
            <select
              id={`${id}-support`}
              value={support}
              onChange={(e) => setSupport(e.target.value as Support)}
            >
              <option value="">{text.allSupport}</option>
              {(['yes', 'no', 'unaudited'] as const).map((item) => (
                <option key={item} value={item}>
                  {text.support[item]}
                </option>
              ))}
            </select>
            <label htmlFor={`${id}-kind`}>{text.kindFilter}</label>
            <select id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{text.allKinds}</option>
              {claimKinds.map((item) => (
                <option key={item} value={item}>
                  {text.claimKinds[item]}
                </option>
              ))}
            </select>
            <span />
            <label className="checkbox" htmlFor={`${id}-conflicted`}>
              <input
                id={`${id}-conflicted`}
                type="checkbox"
                checked={conflictedOnly}
                onChange={(e) => setConflictedOnly(e.target.checked)}
              />
              {text.conflictedOnly}
            </label>
          </>
        )}
      </form>

      {failed && (
        <p className="notice error" role="alert">
          {text.failed}
        </p>
      )}
      {!failed && rows === null && <p role="status">{text.loading}</p>}
      {rows?.length === 0 && (
        <p className="muted" role="status">
          {view === 'claims'
            ? text.claimsEmpty
            : filtered
              ? text.queueEmptyFiltered
              : text.queueEmpty}
        </p>
      )}

      {view === 'documents' && documents && documents.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">{text.queueCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{text.columns.title}</th>
                {!scoped && <th scope="col">{text.columns.scope}</th>}
                <th scope="col">{text.columns.status}</th>
                <th scope="col">{text.columns.score}</th>
                <th scope="col">{text.columns.claims}</th>
                <th scope="col">{text.columns.validUntil}</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((row) => (
                <tr key={row.id}>
                  <th scope="row" dir="auto" className="title-cell">
                    <Link href={`/${locale}/knowledge/${row.id}` as Route}>{row.title}</Link>
                    <br />
                    <small className="muted">
                      {text.sourceTypes[row.sourceType]}
                      {row.versionNo !== null &&
                        ` · ${fill(text.versionLabel, { n: formatNumber(locale, row.versionNo) })}`}
                      {` · ${formatDate(locale, row.updatedAt)}`}
                    </small>
                  </th>
                  {!scoped && (
                    <td>
                      <ScopeList text={text} scopes={row.scopes} />
                    </td>
                  )}
                  <td>
                    <span className="badge-stack">
                      {row.status && (
                        <Badge tone={statusTone(row.status)}>{text.statuses[row.status]}</Badge>
                      )}
                      {/* The Brain's decision is the status; only a human override or a changed
                          source says something more. */}
                      {(row.effectiveDecision === 'approved_by_override' ||
                        row.effectiveDecision === 'rejected_by_override' ||
                        row.effectiveDecision === 'stale') && (
                        <Badge tone={decisionTone(row.effectiveDecision)}>
                          {text.decisions[row.effectiveDecision]}
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td>
                    {row.overall === null
                      ? text.noScore
                      : fill(text.scoreOf, { n: formatNumber(locale, Math.round(row.overall)) })}
                  </td>
                  <td>
                    {formatNumber(locale, row.claimCount)}
                    {row.openConflicts > 0 && (
                      <>
                        <br />
                        <Badge tone="danger">
                          {fill(text.claimConflicts, {
                            n: formatNumber(locale, row.openConflicts),
                          })}
                        </Badge>
                      </>
                    )}
                  </td>
                  <td>{row.validUntil ? formatDate(locale, row.validUntil) : text.noExpiry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'claims' && claims && claims.length > 0 && (
        <div className="table-scroll">
          <table>
            <caption className="visually-hidden">{text.claimCaption}</caption>
            <thead>
              <tr>
                <th scope="col">{text.columns.claim}</th>
                <th scope="col">{text.columns.kind}</th>
                <th scope="col">{text.columns.document}</th>
                <th scope="col">{text.columns.support}</th>
                <th scope="col">{text.columns.citations}</th>
                <th scope="col">{text.columns.conflicts}</th>
                <th scope="col">{text.columns.decision}</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((claim) => (
                <tr key={claim.id}>
                  <th scope="row" dir="auto" className="claim-cell">
                    {claim.text}
                  </th>
                  <td>{text.claimKinds[claim.kind] ?? claim.kind}</td>
                  <td dir="auto">
                    <Link href={`/${locale}/knowledge/${claim.knowledgeId}` as Route}>
                      {claim.title}
                    </Link>
                    <br />
                    <small className="muted">
                      {fill(text.versionLabel, { n: formatNumber(locale, claim.versionNo) })} ·{' '}
                      {fill(text.claimOrdinal, { n: formatNumber(locale, claim.ordinal) })}
                    </small>
                  </td>
                  <td>
                    {claim.supported === null ? (
                      <Badge tone="neutral">{text.notAudited}</Badge>
                    ) : (
                      <Badge tone={claim.supported ? 'ok' : 'danger'}>
                        {claim.supported ? text.supported : text.notSupported}
                      </Badge>
                    )}
                  </td>
                  <td>
                    {claim.citations.total === 0
                      ? text.noCitations
                      : fill(text.citationsOf, {
                          complete: formatNumber(locale, claim.citations.complete),
                          total: formatNumber(locale, claim.citations.total),
                        })}
                  </td>
                  <td>{formatNumber(locale, claim.openConflicts)}</td>
                  <td>
                    <Badge tone={decisionTone(claim.effectiveDecision)}>
                      {text.decisions[claim.effectiveDecision]}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <p>
          <button type="button" className="secondary-button" disabled={more} onClick={loadMore}>
            {more ? text.loadingMore : text.loadMore}
          </button>
        </p>
      )}
    </section>
  );
}
