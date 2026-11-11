'use client';

import type { MonitorClientConfig, MonitorControlEvent, MonitorKind } from '@docoo/contracts';
import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiGet, apiSend } from '../api-client';
import { formatNumber, type Locale } from '../i18n';
import { PanelsSkeleton } from '../skeleton';
import { sendCommand, useMonitorControl } from './control';
import { monitorMessages, optionLabel, fillText } from './messages';
import { isHiddenValue, previewKeys } from './preview';
import { ShareLinks } from './share-links';
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
  const messages = monitorMessages(locale);
  const text = messages.launcher;
  const base = `/workspaces/${workspaceId}`;
  const control = useMonitorControl();
  const [config, setConfig] = useState<MonitorClientConfig | null>(null);
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState('');
  const [projects, setProjects] = useState<{ id: string; code: string; title: string }[]>([]);
  const [chosen, setChosen] = useState('');
  const [previewing, setPreviewing] = useState<MonitorKind | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await apiGet<MonitorClientConfig>(`${base}/monitor/config`);
      setConfig(loaded);
      setChosen(String(loaded.settings['monitor.viewer.project_id'] ?? ''));
      apiGet<{ items: { id: string; code: string; title: string }[] }>(`${base}/projects?limit=100`)
        .then((list) => setProjects(list.items ?? []))
        .catch(() => setProjects([]));
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

  /** Opens the summary first when the owner asked for it; otherwise opens the window at once. */
  function request(kind: MonitorKind) {
    if (config?.settings['monitor.preview_before_open'] === false) open(kind);
    else setPreviewing(kind);
  }

  function open(kind: MonitorKind) {
    setPreviewing(null);
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

  async function putOnStage(projectId: string) {
    setNote('');
    try {
      await apiSend('PUT', `${base}/settings/assignments`, {
        key: 'monitor.viewer.project_id',
        scopeType: 'workspace',
        scopeId: workspaceId,
        value: projectId,
        reason: 'monitor project on stage',
      });
      setChosen(projectId);
      setNote(text.stage.saved);
    } catch {
      setNote(text.stage.failed);
    }
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
                  onClick={() => request(kind)}
                >
                  {text.open}
                </button>
              </div>
            </section>
          );
        })}
      </div>

      {previewing !== null && (
        <section className="card stack monitor-preview" aria-labelledby="monitor-preview">
          <h2 id="monitor-preview">{text.preview.title}</h2>
          <p className="muted">{text.preview.text}</p>
          <ul className="monitor-preview-list">
            {previewKeys[previewing].map((key) => {
              const value = String(config.settings[key as keyof typeof config.settings]);
              return (
                <li
                  key={key}
                  className={isHiddenValue(value) ? 'monitor-preview-hidden' : undefined}
                >
                  <strong>{text.preview.labels[key]}:</strong> {optionLabel(messages, key, value)}
                </li>
              );
            })}
            <li>
              <strong>{text.preview.delay}:</strong>{' '}
              {fillText(text.preview.seconds, {
                n: formatNumber(locale, Number(config.settings['monitor.delay_s'])),
              })}
            </li>
            <li>
              <strong>{text.preview.redaction}:</strong>{' '}
              {optionLabel(
                messages,
                'monitor.redaction',
                String(config.settings['monitor.redaction']),
              )}
            </li>
          </ul>
          <div className="toolbar">
            <button type="button" className="primary-button" onClick={() => open(previewing)}>
              {text.preview.open}
            </button>
            <button type="button" className="secondary-button" onClick={() => setPreviewing(null)}>
              {text.preview.cancel}
            </button>
          </div>
        </section>
      )}

      <section className="card stack" aria-labelledby="monitor-stage">
        <h2 id="monitor-stage">{text.stage.title}</h2>
        <p className="muted">{text.stage.text}</p>
        <div className="toolbar">
          <select
            aria-labelledby="monitor-stage"
            value={chosen}
            onChange={(event) => setChosen(event.target.value)}
          >
            <option value="">{text.stage.none}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-button"
            disabled={chosen === ''}
            onClick={() => void putOnStage(chosen)}
          >
            {text.stage.show}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={
              String(config.settings['monitor.viewer.project_id'] ?? '') === '' && chosen === ''
            }
            onClick={() => void putOnStage('')}
          >
            {text.stage.clear}
          </button>
        </div>
      </section>

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

      <ShareLinks locale={locale} workspaceId={workspaceId} />

      <p>
        <Link href={`/${locale}/monitor/settings` as Route}>{text.settings}</Link>
      </p>
    </div>
  );
}
