'use client';

import { useEffect, useState } from 'react';

import type { Locale } from '../../i18n';
import { WorkspacePage } from '../workspace-page';
import { ConflictsPanel } from './conflicts-panel';
import { knowledgeMessages } from './knowledge-messages';
import { QueuePanel } from './queue-panel';
import { RetrievalPanel } from './retrieval-panel';
import { SourcesPanel } from './sources-panel';

const tabs = ['queue', 'sources', 'conflicts', 'retrieval'] as const;
type Tab = (typeof tabs)[number];

const isTab = (value: string | null): value is Tab => tabs.some((tab) => tab === value);

export function KnowledgePage({ locale }: { locale: Locale }) {
  const text = knowledgeMessages(locale);
  return (
    <WorkspacePage locale={locale} title={text.title} subtitle={text.subtitle}>
      {(workspaceId) => <Sections locale={locale} workspaceId={workspaceId} />}
    </WorkspacePage>
  );
}

/** The sections of knowledge management; the chosen one survives a reload (`?tab=sources`). */
function Sections({ locale, workspaceId }: { locale: Locale; workspaceId: string }) {
  const text = knowledgeMessages(locale);
  const [tab, setTab] = useState<Tab>('queue');
  const [status, setStatus] = useState('');
  const [deleted, setDeleted] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requested = params.get('tab');
    if (isTab(requested)) setTab(requested);
    // The dashboard links to the queue already filtered (`?status=pending`).
    setStatus(params.get('status') ?? '');
    // Deleting a knowledge item sends the administrator back here with a note.
    if (params.get('deleted') === '1') {
      setDeleted(true);
      const url = new URL(location.href);
      url.searchParams.delete('deleted');
      history.replaceState(null, '', url);
    }
  }, []);

  function choose(next: Tab) {
    setTab(next);
    const url = new URL(location.href);
    url.searchParams.set('tab', next);
    url.searchParams.delete('status');
    history.replaceState(null, '', url);
  }

  return (
    <div className="stack">
      {deleted && (
        <p className="notice ok" role="status">
          {text.deleted}
        </p>
      )}
      <nav className="section-nav" aria-label={text.sections}>
        <ul>
          {tabs.map((item) => (
            <li key={item}>
              <button
                type="button"
                aria-current={tab === item ? 'page' : undefined}
                onClick={() => choose(item)}
              >
                {text.tabs[item]}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'queue' && (
        <QueuePanel
          key={status}
          locale={locale}
          workspaceId={workspaceId}
          initialStatus={status}
          refreshKey={refreshKey}
        />
      )}
      {tab === 'sources' && (
        <SourcesPanel
          locale={locale}
          workspaceId={workspaceId}
          onChanged={() => setRefreshKey((key) => key + 1)}
        />
      )}
      {tab === 'conflicts' && <ConflictsPanel locale={locale} workspaceId={workspaceId} />}
      {tab === 'retrieval' && <RetrievalPanel locale={locale} workspaceId={workspaceId} />}
    </div>
  );
}
