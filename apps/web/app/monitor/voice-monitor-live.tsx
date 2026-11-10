'use client';

import type { VoiceMonitorView as View } from '@docoo/contracts';
import { useEffect, useRef, useState } from 'react';

import type { Locale } from '../i18n';
import { monitorMessages } from './messages';
import { VoiceMonitorView } from './voice-monitor-view';

type Status = 'loading' | 'ok' | 'off' | 'lost';

/**
 * Reads the voice monitor every few seconds and draws it. It mounts only while the window is
 * showing its content, so a black screen, a stopped broadcast or an expired window reads nothing.
 * A plain request is used on purpose: a screen that stays on for hours should not fill the error
 * report of the back office when the network blinks.
 */
export function VoiceMonitorLive({
  workspaceId,
  refreshS,
  locale,
  onSessionEnded,
}: {
  readonly workspaceId: string;
  readonly refreshS: number;
  readonly locale: Locale;
  /** The account's session ended (401/403): the window must show nothing of the work. */
  readonly onSessionEnded?: () => void;
}) {
  const text = monitorMessages(locale).voice;
  const [state, setState] = useState<{ view: View | null; status: Status }>({
    view: null,
    status: 'loading',
  });

  const ended = useRef(onSessionEnded);
  ended.current = onSessionEnded;

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();

    const read = async () => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/monitor/voice`, {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: { 'x-request-id': crypto.randomUUID() },
        });
        if (stopped) return;
        if (response.status === 401 || response.status === 403) {
          // The window lives and dies with the account's session: nothing stays on the screen.
          stopped = true;
          setState({ view: null, status: 'loading' });
          ended.current?.();
          return;
        }
        if (response.status === 409) setState({ view: null, status: 'off' });
        else if (response.ok) {
          const body = (await response.json()) as View;
          // An answer that is not a view (a proxy page, a half answer) must not break the screen.
          const valid = Array.isArray(body.sessions) && typeof body.assistantName === 'string';
          setState((previous) =>
            valid ? { view: body, status: 'ok' } : { view: previous.view, status: 'lost' },
          );
        } else setState((previous) => ({ view: previous.view, status: 'lost' }));
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
  return <VoiceMonitorView view={state.view} locale={locale} lost={state.status === 'lost'} />;
}
