'use client';

import type { ViewerMonitorView as View } from '@docoo/contracts';
import { useEffect, useState } from 'react';

import type { Locale } from '../i18n';
import { monitorMessages } from './messages';
import { ViewerMonitorView } from './viewer-monitor-view';

type Status = 'loading' | 'ok' | 'off' | 'lost';

/**
 * Reads the viewer monitor every few seconds and draws it. It mounts only while the window is
 * showing its content, so a black screen, a stopped broadcast or an expired window reads nothing.
 * A plain request is used on purpose: a screen that stays on for hours should not fill the error
 * report of the back office when the network blinks.
 */
export function ViewerMonitorLive({
  workspaceId,
  refreshS,
  locale,
}: {
  readonly workspaceId: string;
  readonly refreshS: number;
  readonly locale: Locale;
}) {
  const text = monitorMessages(locale).viewer;
  const [state, setState] = useState<{ view: View | null; status: Status }>({
    view: null,
    status: 'loading',
  });

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();

    const read = async () => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/monitor/viewer`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: { 'x-request-id': crypto.randomUUID() },
        });
        if (stopped) return;
        if (response.status === 409) setState({ view: null, status: 'off' });
        else if (response.ok) setState({ view: (await response.json()) as View, status: 'ok' });
        else setState((previous) => ({ view: previous.view, status: 'lost' }));
      } catch {
        if (!stopped) setState((previous) => ({ view: previous.view, status: 'lost' }));
      }
      if (!stopped) timer = window.setTimeout(() => void read(), Math.max(2, refreshS) * 1000);
    };
    void read();
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [workspaceId, refreshS]);

  if (state.status === 'off') return <p>{text.off}</p>;
  if (!state.view) return <p>{state.status === 'lost' ? text.lost : text.waiting}</p>;
  return <ViewerMonitorView view={state.view} locale={locale} lost={state.status === 'lost'} />;
}
