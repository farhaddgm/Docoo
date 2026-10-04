'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useState } from 'react';

import type { Locale } from '../../../i18n';
import { knowledgeMessages } from '../../knowledge/knowledge-messages';
import { QueuePanel } from '../../knowledge/queue-panel';
import { RetrievalPanel } from '../../knowledge/retrieval-panel';
import { SourcesPanel } from '../../knowledge/sources-panel';

/**
 * UX §6 "Knowledge" tab: the sources and the knowledge that belong to this project, and a test
 * of what its agents would be given. Workspace-wide and topic knowledge is managed on the
 * Knowledge page; it still reaches this project through its scope.
 */
export function KnowledgePanel({
  locale,
  workspaceId,
  projectId,
  readOnly,
}: {
  locale: Locale;
  workspaceId: string;
  projectId: string;
  readOnly: boolean;
}) {
  const text = knowledgeMessages(locale);
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="stack">
      <p className="muted">
        {text.projectKnowledgeHelp}{' '}
        <Link href={`/${locale}/knowledge` as Route}>{text.openKnowledgePage}</Link>
      </p>
      <SourcesPanel
        locale={locale}
        workspaceId={workspaceId}
        scopeType="project"
        scopeId={projectId}
        readOnly={readOnly}
        onChanged={() => setRefreshKey((key) => key + 1)}
      />
      <QueuePanel
        locale={locale}
        workspaceId={workspaceId}
        scopeType="project"
        scopeId={projectId}
        refreshKey={refreshKey}
      />
      <RetrievalPanel locale={locale} workspaceId={workspaceId} projectId={projectId} />
    </div>
  );
}
