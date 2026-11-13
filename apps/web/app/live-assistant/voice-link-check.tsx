'use client';

import type { LiveVoiceCheck, LiveVoiceCheckFailure } from '@docoo/contracts';
import { useState } from 'react';

import { formatNumber, type Locale } from '../i18n';
import { liveReadApi } from './live-api';
import { liveSettingsMessages } from './settings-messages';

type CheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }
  | { readonly kind: 'ok'; readonly result: LiveVoiceCheck }
  | {
      readonly kind: 'failed';
      readonly failure: LiveVoiceCheckFailure;
      readonly result: LiveVoiceCheck | null;
    };

/**
 * One card for "can this server open the voice link": the button, the verdict as a badge, the
 * reason in words, and (for support) the model, the time and the kinds of the provider's first
 * events. The events carry no content, so showing them is safe.
 */
export function VoiceLinkCheck({
  locale,
  workspaceId,
}: {
  readonly locale: Locale;
  readonly workspaceId: string;
}) {
  const text = liveSettingsMessages(locale).status.voiceCheck;
  const [state, setState] = useState<CheckState>({ kind: 'idle' });
  const running = state.kind === 'running';

  const run = (): void => {
    setState({ kind: 'running' });
    liveReadApi
      .voiceCheck(workspaceId)
      .then((result) =>
        setState(
          result.ok
            ? { kind: 'ok', result }
            : { kind: 'failed', failure: result.failure ?? 'unexpected', result },
        ),
      )
      .catch(() => setState({ kind: 'failed', failure: 'network', result: null }));
  };

  const result = state.kind === 'ok' || state.kind === 'failed' ? state.result : null;

  return (
    <section className="card stack voice-link-check" aria-labelledby="la-voice-check">
      <div className="voice-link-head">
        <h3 id="la-voice-check">{text.title}</h3>
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
      </div>

      {result && (
        <details className="voice-link-details">
          <summary>{text.details}</summary>
          <dl className="voice-link-facts">
            <dt>{text.model}</dt>
            <dd dir="ltr">{result.model || '—'}</dd>
            <dt>{text.latency}</dt>
            <dd>
              {result.latencyMs === null
                ? '—'
                : `${formatNumber(locale, result.latencyMs)} ${text.ms}`}
            </dd>
            <dt>{text.events}</dt>
            <dd dir="ltr">{result.events.length > 0 ? result.events.join(' → ') : '—'}</dd>
          </dl>
        </details>
      )}
    </section>
  );
}
