'use client';

import { useSyncExternalStore } from 'react';

import { formatNumber, type Locale } from '../i18n';
import { fill, liveMessagesFor } from './messages';
import { isLiveActive } from './state';
import { liveAssistant } from './store';

/**
 * The button that switches the live conversation on and off, at the top of the Smart chat tab
 * (HUG-002). The session itself lives in the root layout, so closing this window changes nothing.
 */
export function LiveCard({ locale }: { readonly locale: Locale }) {
  const text = liveMessagesFor(locale);
  const state = useSyncExternalStore(
    liveAssistant.subscribe,
    liveAssistant.getSnapshot,
    liveAssistant.getServerSnapshot,
  );
  const active = isLiveActive(state.status);
  const busy = state.status === 'starting' || state.status === 'closing';
  const name = { name: text.name };

  let label = text.card.start;
  if (state.status === 'starting') label = text.card.starting;
  else if (state.status === 'closing') label = text.card.closing;
  else if (active) label = text.card.stop;

  return (
    <section className="live-card" aria-label={fill(text.card.title, name)}>
      <h3>{fill(text.card.title, name)}</h3>
      <p className="muted">{fill(text.card.intro, name)}</p>
      <div className="toolbar">
        <button
          type="button"
          className={active ? 'secondary-button' : 'primary-button'}
          aria-pressed={active}
          disabled={busy || (!active && !state.available)}
          onClick={() => void (active ? liveAssistant.stop() : liveAssistant.start())}
        >
          {label}
        </button>
        {state.status !== 'off' && (
          <span className="badge" data-state={state.status}>
            {text.status[state.status]}
          </span>
        )}
      </div>
      {!state.available && !active && <p className="muted">{text.card.unavailable}</p>}
      {state.error && (
        <p className="notice error" role="alert">
          {text.card.errors[state.error]}
        </p>
      )}
      {state.tokens > 0 && (
        <p className="muted">{fill(text.card.used, { n: formatNumber(locale, state.tokens) })}</p>
      )}
    </section>
  );
}
