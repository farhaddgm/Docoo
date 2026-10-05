'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useId, useState } from 'react';

import { apiGet, ApiError, query } from '../../api-client';
import { formatDate, formatDateTime, formatNumber, type Locale } from '../../i18n';
import { fill } from '../agents/agent-messages';
import { Notice } from '../use-action';
import { WorkspacePage } from '../workspace-page';
import { ClaimsPanel } from './claims-panel';
import { ConflictCard } from './conflicts-panel';
import { HistoryPanel } from './history-panel';
import { Badge, decisionTone, ScopeList, statusTone } from './knowledge-common';
import { AuditSection, EditSection, useKnowledgeAction } from './knowledge-actions';
import { knowledgeMessages } from './knowledge-messages';
import type { Conflict, KnowledgeDetail } from './knowledge-types';
import { OverridePanel } from './override-panel';
import { ReviewPanel } from './review-panel';
import { UsesPanel } from './uses-panel';

export function KnowledgeDetailPage({
  locale,
  knowledgeId,
}: {
  locale: Locale;
  knowledgeId: string;
}) {
  const text = knowledgeMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.detailSubtitle}>
      {(workspaceId) => (
        <Detail locale={locale} workspaceId={workspaceId} knowledgeId={knowledgeId} />
      )}
    </WorkspacePage>
  );
}

type Load = 'loading' | 'ready' | 'missing' | 'failed';

/** One knowledge item: its state, the Brain audit, claims, the override and its history. */
function Detail({
  locale,
  workspaceId,
  knowledgeId,
}: {
  locale: Locale;
  workspaceId: string;
  knowledgeId: string;
}) {
  const text = knowledgeMessages(locale);
  const id = useId();
  const base = `/workspaces/${workspaceId}`;
  const [knowledge, setKnowledge] = useState<KnowledgeDetail | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const action = useKnowledgeAction(locale);

  const reload = useCallback(async () => {
    try {
      const [detail, open] = await Promise.all([
        apiGet<{ knowledge: KnowledgeDetail }>(`${base}/knowledge/${knowledgeId}`),
        apiGet<{ items: Conflict[] }>(
          `${base}/knowledge-conflicts${query({ knowledgeId, status: 'open', limit: '100' })}`,
        ),
      ]);
      setKnowledge(detail.knowledge);
      setConflicts(open.items);
      setLoad('ready');
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        setLoad('missing');
      } else {
        setLoad((current) => (current === 'ready' ? current : 'failed'));
      }
    }
  }, [base, knowledgeId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (load === 'loading') return <p role="status">{text.loading}</p>;
  if (load === 'failed') {
    return (
      <p className="notice error" role="alert">
        {text.failed}
      </p>
    );
  }
  if (load === 'missing' || !knowledge) {
    return (
      <div className="stack">
        <p className="notice error" role="alert">
          {text.notFound}
        </p>
        <p>
          <Link href={`/${locale}/knowledge` as Route}>{text.back}</Link>
        </p>
      </div>
    );
  }

  const version = knowledge.currentVersion;
  const review = version?.latestReview ?? null;
  // Open conflicts per claim, so each claim says how many it is part of.
  const conflictCounts = new Map<string, number>();
  for (const conflict of conflicts) {
    for (const side of [conflict.claimA, conflict.claimB]) {
      conflictCounts.set(side.id, (conflictCounts.get(side.id) ?? 0) + 1);
    }
  }

  return (
    <div className="stack">
      <p>
        <Link href={`/${locale}/knowledge` as Route}>{text.back}</Link>
      </p>

      <section className="card stack" aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`} dir="auto">
          {knowledge.title}
        </h2>
        {version && (
          <p>
            <Badge tone={statusTone(version.status)}>{text.statuses[version.status]}</Badge>
            <Badge tone={decisionTone(version.effectiveDecision)}>
              {text.decisions[version.effectiveDecision]}
            </Badge>
          </p>
        )}
        <dl className="facts">
          <div>
            <dt>{text.factSource}</dt>
            <dd>{text.sourceTypes[knowledge.sourceType]}</dd>
          </div>
          <div>
            <dt>{text.factConfidentiality}</dt>
            <dd>{text.confidentiality[knowledge.confidentiality]}</dd>
          </div>
          <div>
            <dt>{text.factLanguage}</dt>
            <dd>{text.languages[knowledge.language]}</dd>
          </div>
          {version && (
            <div>
              <dt>{text.factVersion}</dt>
              <dd>{fill(text.versionLabel, { n: formatNumber(locale, version.versionNo) })}</dd>
            </div>
          )}
          {version?.validFrom && (
            <div>
              <dt>{text.factValidFrom}</dt>
              <dd>{formatDate(locale, version.validFrom)}</dd>
            </div>
          )}
          {version?.validUntil && (
            <div>
              <dt>{text.factValidUntil}</dt>
              <dd>{formatDate(locale, version.validUntil)}</dd>
            </div>
          )}
          <div>
            <dt>{text.factCreated}</dt>
            <dd>{formatDateTime(locale, knowledge.createdAt)}</dd>
          </div>
          <div>
            <dt>{text.factUpdated}</dt>
            <dd>{formatDateTime(locale, knowledge.updatedAt)}</dd>
          </div>
        </dl>
        <div>
          <strong>{text.factScopes}</strong>
          <ScopeList text={text} scopes={knowledge.scopes} />
        </div>
      </section>

      <Notice notice={action.notice} />

      <AuditSection
        locale={locale}
        workspaceId={workspaceId}
        knowledge={knowledge}
        onChanged={reload}
        action={action}
      />

      <ReviewPanel locale={locale} review={review} />

      <OverridePanel
        locale={locale}
        workspaceId={workspaceId}
        knowledge={knowledge}
        onChanged={reload}
      />

      {version && (
        <ClaimsPanel
          locale={locale}
          claims={version.claims}
          review={review}
          conflictCounts={conflictCounts}
        />
      )}

      <section className="card stack" aria-labelledby={`${id}-conflicts`}>
        <h2 id={`${id}-conflicts`}>{text.conflictsOfThis}</h2>
        {conflicts.length === 0 ? (
          <p className="muted">{text.conflictsOfThisNone}</p>
        ) : (
          <ul className="plain-list conflict-list">
            {conflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                locale={locale}
                workspaceId={workspaceId}
                conflict={conflict}
                onResolved={() => void reload()}
              />
            ))}
          </ul>
        )}
      </section>

      <UsesPanel
        locale={locale}
        workspaceId={workspaceId}
        knowledgeId={knowledge.id}
        refreshKey={`${knowledge.version}`}
      />

      <EditSection
        locale={locale}
        workspaceId={workspaceId}
        knowledge={knowledge}
        onChanged={reload}
        action={action}
      />

      <HistoryPanel
        locale={locale}
        workspaceId={workspaceId}
        knowledgeId={knowledge.id}
        currentVersionId={knowledge.currentVersion?.id ?? null}
        refreshKey={`${knowledge.version}:${review?.id ?? ''}`}
      />
    </div>
  );
}
