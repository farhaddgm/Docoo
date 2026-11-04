'use client';

import type { LiveAssistantClientConfig } from '@docoo/contracts';
import { useEffect, useState } from 'react';

import type { Locale } from '../i18n';
import { liveBackendFor, liveReadApi } from './live-api';
import { assistantNameFor, LiveCard } from './live-card';
import { LiveHistory } from './live-history';
import { liveAssistant } from './store';

/**
 * The live assistant's place in the Smart chat tab: the switch and the list of conversations.
 * Only the owner can use it, so anyone else (the server answers 403) sees nothing at all.
 */
export function LiveSection({
  workspaceId,
  locale,
}: {
  readonly workspaceId: string;
  readonly locale: Locale;
}) {
  const [config, setConfig] = useState<LiveAssistantClientConfig | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    // Tell the session store which workspace to report to; a running session keeps its own.
    liveAssistant.setBackend(liveBackendFor(workspaceId));
    liveReadApi
      .config(workspaceId, controller.signal)
      .then(setConfig)
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId]);

  if (!config) return null;
  return (
    <>
      <LiveCard locale={locale} config={config} />
      <LiveHistory
        workspaceId={workspaceId}
        locale={locale}
        name={assistantNameFor(locale, config)}
      />
    </>
  );
}
