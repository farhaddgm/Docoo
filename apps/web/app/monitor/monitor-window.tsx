'use client';

import type { MonitorClientConfig, MonitorKind } from '@docoo/contracts';
import { useEffect, useMemo, useState } from 'react';

import { ApiError, apiGet } from '../api-client';
import type { Locale } from '../i18n';
import { useMonitorControl } from './control';
import { monitorMessages } from './messages';
import { shouldCloseWindow, watermarkText, windowView, type WindowLoad } from './window-model';

import './monitor.css';

interface Identity {
  readonly workspaces: readonly { id: string; name: string }[];
}

interface Loaded {
  readonly load: WindowLoad;
  readonly config?: MonitorClientConfig;
  readonly workspaceName?: string;
}

/**
 * A monitor window (ADR-0056 §5-1): a bare page for a room screen with no menu, no buttons and no
 * link into the back office. It reads the settings, then shows its monitor, a black page, or why it
 * shows nothing. The owner's stop and the time limit close it. This first step has no content yet.
 */
export function MonitorWindow({
  locale,
  kind,
}: {
  readonly locale: Locale;
  readonly kind: MonitorKind;
}) {
  const control = useMonitorControl();
  const [loaded, setLoaded] = useState<Loaded>({ load: 'loading' });
  // When this window was opened, kept for the tab so a reload does not give it more time.
  const openedAt = useMemo(() => {
    const key = `docoo.monitor.opened.${kind}`;
    try {
      const known = Number(window.sessionStorage.getItem(key));
      if (Number.isFinite(known) && known > 0) return known;
      const now = Date.now();
      window.sessionStorage.setItem(key, String(now));
      return now;
    } catch {
      return Date.now();
    }
  }, [kind]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const session = await fetch('/api/auth/session', {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (session.status === 401) return setLoaded({ load: 'guest' });
        if (!session.ok) return setLoaded({ load: 'unavailable' });
        const identity = (await session.json()) as Identity;
        const workspace = identity.workspaces[0];
        if (!workspace) return setLoaded({ load: 'unavailable' });
        const config = await apiGet<MonitorClientConfig>(
          `/workspaces/${workspace.id}/monitor/config`,
          controller.signal,
        );
        setLoaded({ load: 'ready', config, workspaceName: workspace.name });
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoaded({
          load: error instanceof ApiError && error.status === 403 ? 'denied' : 'unavailable',
        });
      }
    })();
    return () => controller.abort();
  }, []);

  // The clock for the time limit and the faint mark; once a minute is enough.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const settings = loaded.config?.settings;
  const view = windowView({
    load: loaded.load,
    enabled:
      kind === 'viewer'
        ? loaded.config?.viewerEnabled === true
        : loaded.config?.voiceEnabled === true,
    control,
    openedAt,
    now,
    maxPlayHours:
      typeof settings?.['monitor.max_play_hours'] === 'number'
        ? settings['monitor.max_play_hours']
        : 8,
  });

  useEffect(() => {
    if (shouldCloseWindow(view)) window.close();
  }, [view]);

  // The language of the window follows the settings; "ui" keeps the language of the back office.
  const chosen = settings?.['monitor.language'];
  const windowLocale: Locale = chosen === 'fa' || chosen === 'en' ? chosen : locale;
  const text = monitorMessages(windowLocale).window;
  const theme =
    settings?.['monitor.theme'] === 'light'
      ? 'light'
      : settings?.['monitor.theme'] === 'auto'
        ? 'auto'
        : 'dark';
  const scale =
    typeof settings?.['monitor.font_scale'] === 'number' ? settings['monitor.font_scale'] : 1.5;
  const time = new Intl.DateTimeFormat(windowLocale === 'fa' ? 'fa-IR' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  const mark = watermarkText(
    String(settings?.['monitor.watermark'] ?? 'none'),
    loaded.workspaceName ?? '',
    time,
  );

  const message: Record<string, string> = {
    loading: text.loading,
    guest: text.guest,
    owner_only: text.ownerOnly,
    unavailable: text.unavailable,
    off: text.off,
    stopped: text.stopped,
    expired: text.expired,
  };

  return (
    <div
      className={`monitor-window monitor-${theme} ${view === 'blackout' ? 'monitor-black' : ''}`}
      dir={windowLocale === 'fa' ? 'rtl' : 'ltr'}
      lang={windowLocale}
      style={{ fontSize: `${scale}rem` }}
      data-view={view}
    >
      {view === 'blackout' ? (
        <p className="monitor-sr">{text.blackout}</p>
      ) : (
        <>
          <header className="monitor-head">
            <h1>{text.titles[kind]}</h1>
            {view === 'ready' && settings?.['monitor.live_badge'] === true && (
              <span className="monitor-badge">{text.live}</span>
            )}
          </header>
          <main className="monitor-body" role="status" aria-live="polite">
            {view === 'ready' ? (
              <p>{text.building}</p>
            ) : (
              <>
                <p>{message[view]}</p>
                {view === 'off' && <p className="monitor-dim">{text.offHint}</p>}
              </>
            )}
          </main>
          {view === 'ready' && mark && <footer className="monitor-mark">{mark}</footer>}
        </>
      )}
    </div>
  );
}
