'use client';

import type { MonitorClientConfig, MonitorControlEvent, MonitorKind } from '@docoo/contracts';
import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiGet, apiSend } from '../api-client';
import type { Locale } from '../i18n';
import { PanelsSkeleton } from '../skeleton';
import { sendCommand, useMonitorControl } from './control';
import { monitorMessages } from './messages';
import { monitorWindowFeatures, monitorWindowName, monitorWindowPath } from './paths';

import './monitor.css';

const KINDS: readonly MonitorKind[] = ['viewer', 'voice'];

/**
 * The monitor page of the back office (ADR-0056 §5-1, §5-4): the two monitors, each opened in its
 * own named browser window, and the controls that black the screens out or stop the broadcast.
 */
export function MonitorLauncher({
  locale,
  workspaceId,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
}) {
  const text = monitorMessages(locale).launcher;
  const base = `/workspaces/${workspaceId}`;
  const control = useMonitorControl();
  const [config, setConfig] = useState<MonitorClientConfig | null>(null);
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      setConfig(await apiGet<MonitorClientConfig>(`${base}/monitor/config`));
      setFailure('');
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.status === 403 ? text.ownerOnly : text.loadFailed,
      );
    }
  }, [base, text.loadFailed, text.ownerOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The trail records what control was used, never what a monitor showed; a failure is not shown. */
  const report = (event: MonitorControlEvent, kind: MonitorKind | 'all') => {
    void apiSend('POST', `${base}/monitor/events`, { event, kind }).catch(() => undefined);
  };

  function open(kind: MonitorKind) {
    setNote('');
    // The same name every time: a second click brings the one window of this kind forward.
    const opened = window.open(
      monitorWindowPath(locale, kind),
      monitorWindowName(kind),
      monitorWindowFeatures,
    );
    if (!opened) {
      setNote(text.popupBlocked);
      return;
    }
    opened.focus();
    report('opened', kind);
  }

  function blackout(on: boolean) {
    sendCommand(on ? 'blackout' : 'resume');
    report(on ? 'blackout' : 'resumed', 'all');
  }

  function stop() {
    sendCommand('stop');
    setNote(text.controls.stopped);
    report('stopped', 'all');
  }

  if (failure) return <p className="notice error">{failure}</p>;
  if (!config) return <PanelsSkeleton label={text.loading} count={2} />;

  return (
    <div className="stack monitor-launcher">
      <p>{text.intro}</p>
      <p className="muted">{text.building}</p>

      <div className="monitor-cards">
        {KINDS.map((kind) => {
          const display = text.displays[kind];
          const enabled = kind === 'viewer' ? config.viewerEnabled : config.voiceEnabled;
          return (
            <section className="card stack" key={kind} aria-labelledby={`monitor-${kind}`}>
              <h2 id={`monitor-${kind}`}>{display.title}</h2>
              <p>{display.text}</p>
              <p className={enabled ? 'notice ok' : 'notice warn'} role="status">
                {enabled ? text.on : `${text.off}. ${text.turnOnHint}`}
              </p>
              <div className="toolbar">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!enabled}
                  onClick={() => open(kind)}
                >
                  {text.open}
                </button>
              </div>
            </section>
          );
        })}
      </div>

      <section className="card stack" aria-labelledby="monitor-controls">
        <h2 id="monitor-controls">{text.controls.title}</h2>
        <p className="muted">{text.controls.text}</p>
        {control.blackout && (
          <p className="notice warn" role="status">
            {text.controls.blackoutOn}
          </p>
        )}
        <div className="toolbar">
          <button
            type="button"
            className={control.blackout ? 'secondary-button' : 'primary-button'}
            onClick={() => blackout(!control.blackout)}
          >
            {control.blackout ? text.controls.resume : text.controls.blackout}
          </button>
          <button type="button" className="secondary-button" onClick={stop}>
            {text.controls.stop}
          </button>
        </div>
        {note && (
          <p className="notice info" role="status">
            {note}
          </p>
        )}
      </section>

      <p>
        <Link href={`/${locale}/monitor/settings` as Route}>{text.settings}</Link>
      </p>
    </div>
  );
}
