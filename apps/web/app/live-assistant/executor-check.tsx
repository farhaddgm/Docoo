'use client';

import type { LiveExecutorCheck, LiveExecutorCheckFailure } from '@docoo/contracts';
import { useState } from 'react';

import { formatNumber, type Locale } from '../i18n';
import { liveReadApi } from './live-api';
import { liveSettingsMessages } from './settings-messages';

type CheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'ok'; readonly result: LiveExecutorCheck }
  | {
      readonly kind: 'failed';
      readonly failure: LiveExecutorCheckFailure;
      readonly result: LiveExecutorCheck | null;
    };

/**
 * One card for "can the text model that answers typed requests (and does the assistant's work)
 * answer from here": one small real call with the same tools it gets in a conversation. A failure
 * is shown as a kind in words, with the provider's own short reason underneath, so a failing
 * conversation can be traced without the server's logs.
 */
export function ExecutorCheck({
  locale,
  workspaceId,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
}) {
  const text = liveSettingsMessages(locale).status.executorCheck;
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  const running = state.kind === 'running';

  const run = (): void => {
    setState({ kind: 'running' });
    liveReadApi
      .executorCheck(workspaceId)
      .then((result) =>
        setState(
          result.ok
            ? { kind: 'ok', result }
            : { kind: 'failed', failure: result.failure ?? 'unexpected', result },
        ),
      )
      .catch(() => setState({ kind: 'failed', failure: 'unexpected', result: null }));
  };

  const result = state.kind === 'ok' || state.kind === 'failed' ? state.result : null;

  return (
    <section className="card stack voice-link-check" aria-labelledby="la-executor-check">
      <div className="voice-link-head">
        <h3 id="la-executor-check">{text.title}</h3>
        {state.kind === 'ok' && <span className="badge ok">{text.badgeOk}</span>}
        {state.kind === 'failed' && <span className="badge error">{text.badgeFailed}</span>}
      </div>
      <p className="muted">{text.note}</p>
      <div className="toolbar">
        <button
          type="button"
          className="button secondary"
          disabled={running}
          aria-busy={running}
          onClick={run}
        >
          {running ? text.running : state.kind === 'idle' ? text.button : text.again}
        </button>
      </div>

      <div role="status" aria-live="polite">
        {state.kind === 'ok' && <p className="notice ok">{text.ok}</p>}
        {state.kind === 'failed' && (
          <p className="notice warn">
            <strong>{text.failed}</strong> {text.failures[state.failure]}
          </p>
        )}
        {state.kind === 'failed' && result?.detail && (
          <p className="notice warn" dir="ltr">
            {result.detail}
          </p>
        )}
      </div>

      {result && (
        <details className="voice-link-details" open={state.kind === 'failed'}>
          <summary>{text.details}</summary>
          <dl className="voice-link-facts">
            <dt>{text.model}</dt>
            <dd dir="ltr">{result.model || '—'}</dd>
            <dt>{text.tools}</dt>
            <dd>{formatNumber(locale, result.toolCount)}</dd>
            <dt>{text.code}</dt>
            <dd dir="ltr">{result.code ?? '—'}</dd>
            <dt>{text.latency}</dt>
            <dd>
              {result.latencyMs === null
                ? '—'
                : `${formatNumber(locale, result.latencyMs)} ${text.ms}`}
            </dd>
          </dl>
        </details>
      )}
    </section>
  );
}
