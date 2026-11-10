'use client';

import { useEffect, useState } from 'react';

import { apiGet, apiSend } from '../api-client';
import type { Locale } from '../i18n';
import { monitorMessages } from './messages';

/**
 * The button on a project's page that puts the project on the viewer monitor (ADR-0056 §5-1). It
 * sets the same setting as the picker on the Monitor page. Only the owner sees it.
 */
export function ShowOnProjectorButton({
  locale,
  workspaceId,
  projectId,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly projectId: string;
}) {
  const text = monitorMessages(locale).launcher.stage;
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');

  const [alias, setAlias] = useState('');
  const [aliasState, setAliasState] = useState<'idle' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    const controller = new AbortController();
    apiGet<{ alias: string | null }>(
      `/workspaces/${workspaceId}/monitor/alias/${projectId}`,
      controller.signal,
    )
      .then((body) => setAlias(body.alias ?? ''))
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId, projectId]);

  async function saveAlias() {
    setAliasState('idle');
    try {
      await apiSend('PUT', `/workspaces/${workspaceId}/monitor/alias/${projectId}`, {
        alias: alias.trim(),
      });
      setAliasState('saved');
    } catch {
      setAliasState('failed');
    }
  }

  async function show() {
    setState('idle');
    try {
      await apiSend('PUT', `/workspaces/${workspaceId}/settings/assignments`, {
        key: 'monitor.viewer.project_id',
        scopeType: 'workspace',
        scopeId: workspaceId,
        value: projectId,
        reason: 'monitor project on stage',
      });
      setState('saved');
    } catch {
      setState('failed');
    }
  }

  return (
    <span className="show-on-projector">
      <button type="button" className="secondary-button" onClick={() => void show()}>
        {text.show}
      </button>
      <label className="show-on-projector-alias">
        <small>{text.aliasLabel}</small>{' '}
        <input
          value={alias}
          maxLength={80}
          title={text.aliasHint}
          onChange={(event) => {
            setAlias(event.target.value);
            setAliasState('idle');
          }}
        />
      </label>
      <button type="button" className="secondary-button" onClick={() => void saveAlias()}>
        {text.aliasSave}
      </button>
      {aliasState !== 'idle' && (
        <small role="status" className={aliasState === 'failed' ? 'notice error' : 'muted'}>
          {' '}
          {aliasState === 'saved' ? text.saved : text.failed}
        </small>
      )}
      {state !== 'idle' && (
        <small role="status" className={state === 'failed' ? 'notice error' : 'muted'}>
          {' '}
          {state === 'saved' ? text.saved : text.failed}
        </small>
      )}
    </span>
  );
}
