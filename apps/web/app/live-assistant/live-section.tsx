'use client';

import type { LiveAssistantClientConfig } from '@docoo/contracts';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api-client';
import type { Locale } from '../i18n';
import { liveBackendFor, liveReadApi } from './live-api';
import { assistantNameFor, LiveCard } from './live-card';
import { LiveHistory } from './live-history';
import { fill, liveMessagesFor } from './messages';
import { liveAssistant } from './store';

/**
 * The live assistant's place in the Smart chat tab: the switch and the list of conversations.
 * Only the owner can use it, so anyone else (the server answers 403) sees nothing at all.
 */
/**
 * What to say when the assistant's state could not be read: the code the server gave, so the
 * owner is never left looking at a missing card and guessing. (The Smart panel is only built for
 * administrators, who all hold this permission, so a failure here is never "not for you".)
 */
export function loadFailureCode(error: unknown): string {
  if (error instanceof ApiError) return error.code ?? `HTTP_${error.status}`;
  return 'NETWORK';
}

export function LiveSection({
  workspaceId,
  locale,
}: {
  readonly workspaceId: string;
  readonly locale: Locale;
}) {
  const [config, setConfig] = useState<LiveAssistantClientConfig | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setConfig(null);
    setFailure(null);
    // Tell the session store which workspace to report to; a running session keeps its own.
    liveAssistant.setBackend(liveBackendFor(workspaceId));
    liveReadApi
      .config(workspaceId, controller.signal)
      .then(setConfig)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure(loadFailureCode(error));
      });
    return () => controller.abort();
  }, [workspaceId, attempt]);

  if (failure) {
    const text = liveMessagesFor(locale).card;
    return (
      <section className="live-card" role="alert">
        <p className="notice error">{fill(text.loadFailed, { code: failure })}</p>
        <button type="button" className="secondary-button" onClick={retry}>
          {text.retry}
        </button>
      </section>
    );
  }
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
