'use client';

import { useState } from 'react';

import { apiSend } from '../api-client';
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
      {state !== 'idle' && (
        <small role="status" className={state === 'failed' ? 'notice error' : 'muted'}>
          {' '}
          {state === 'saved' ? text.saved : text.failed}
        </small>
      )}
    </span>
  );
}
