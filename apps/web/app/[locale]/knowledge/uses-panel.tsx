'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { apiGet } from '../../api-client';
import { formatDateTime, formatNumber, type Locale, textDir } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { Badge } from './knowledge-common';
import { knowledgeHelp } from './knowledge-help';
import { knowledgeMessages } from './knowledge-messages';
import { InfoTip, SectionTitle } from '../../info-tip';
import { PagedRows } from '../../table-pager';

interface Use {
  id: string;
  snapshotId: string | null;
  projectId: string | null;
  projectTitle: string | null;
  stage: string | null;
  attemptNo: number | null;
  role: string;
  query: string | null;
  versionNos: number[];
  cited: boolean;
  createdAt: string;
}

interface Uses {
  items: Use[];
  totals: { retrievals: number; cited: number };
}

/**
 * Where agents used this knowledge (UX §6, ADR-0017): each retrieval with its project, stage
 * and attempt, and whether that attempt's output cited it with a quote the code verified.
 */
export function UsesPanel({
  locale,
  workspaceId,
  knowledgeId,
  refreshKey,
}: {
  locale: Locale;
  workspaceId: string;
  knowledgeId: string;
  /** Changes when the knowledge changed, so the list is read again. */
  refreshKey: string;
}) {
  const text = knowledgeMessages(locale);
  const help = knowledgeHelp(locale);
  const id = useId();
  const [uses, setUses] = useState<Uses | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    apiGet<Uses>(`/workspaces/${workspaceId}/knowledge/${knowledgeId}/uses`)
      .then((result) => {
        if (!active) return;
        setUses(result);
        setFailed(false);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [workspaceId, knowledgeId, refreshKey]);

  return (
    <section className="card stack" aria-labelledby={`${id}-heading`}>
      <SectionTitle id={`${id}-heading`} help={text.usesIntro}>
        {text.usesTitle}
      </SectionTitle>
      {failed && (
        <p className="notice error" role="alert">
          {text.usesFailed}
        </p>
      )}
      {!failed && uses === null && <p role="status">{text.loading}</p>}
      {uses && uses.items.length === 0 && <p className="muted">{text.usesNone}</p>}
      {uses && uses.items.length > 0 && (
        <>
          <p>
            {fill(text.usesTotals, {
              retrievals: formatNumber(locale, uses.totals.retrievals),
              cited: formatNumber(locale, uses.totals.cited),
            })}
          </p>
          <PagedRows rows={uses.items}>
            {(pageRows) => (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label={text.usesCaption}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">
                        {text.usesProject}
                        <InfoTip text={help.detail.uses.project} />
                      </th>
                      <th scope="col">
                        {text.usesStage}
                        <InfoTip text={help.detail.uses.stage} />
                      </th>
                      <th scope="col">
                        {text.usesQuery}
                        <InfoTip text={help.detail.uses.query} />
                      </th>
                      <th scope="col">
                        {text.usesVersion}
                        <InfoTip text={help.detail.uses.version} />
                      </th>
                      <th scope="col">
                        {text.usesWhen}
                        <InfoTip text={help.detail.uses.when} />
                      </th>
                      <th scope="col">
                        {text.usesResult}
                        <InfoTip text={help.detail.uses.result} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((use) => (
                      <tr key={use.id}>
                        <th scope="row" dir={textDir(locale)}>
                          {use.projectId ? (
                            <Link href={`/${locale}/projects/${use.projectId}` as Route}>
                              {use.projectTitle ?? use.projectId}
                            </Link>
                          ) : (
                            '—'
                          )}
                        </th>
                        <td>
                          {use.stage ? (text.usesStages[use.stage] ?? use.stage) : '—'}
                          {use.attemptNo !== null && (
                            <small className="muted">
                              {' '}
                              ({text.usesAttempt} {formatNumber(locale, use.attemptNo)})
                            </small>
                          )}
                        </td>
                        <td dir={textDir(locale)}>{use.query ?? '—'}</td>
                        <td>{use.versionNos.map((n) => formatNumber(locale, n)).join(', ')}</td>
                        <td>{formatDateTime(locale, use.createdAt)}</td>
                        <td>
                          <Badge tone={use.cited ? 'ok' : 'neutral'}>
                            {use.cited ? text.usesCited : text.usesRetrievedOnly}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PagedRows>
        </>
      )}
    </section>
  );
}
