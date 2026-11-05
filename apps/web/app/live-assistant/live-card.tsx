'use client';

import type { LiveAssistantClientConfig } from '@docoo/contracts';
import type { Route } from 'next';
import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import { formatNumber, type Locale } from '../i18n';
import { LiveChat } from './live-chat';
import { fill, liveMessagesFor } from './messages';
import { isLiveActive } from './state';
import { liveAssistant } from './store';

/** The name shown to the owner: the Persian interface uses the spoken name, the English one the display name. */
export const assistantNameFor = (locale: Locale, config: LiveAssistantClientConfig): string =>
  locale === 'fa' ? config.spokenName : config.displayName;

/**
 * The button that switches the live conversation on and off, at the top of the Smart chat tab
 * (HUG-002). The session itself lives in the root layout, so closing this window changes nothing.
 */
export function LiveCard({
  locale,
  config,
}: {
  readonly locale: Locale;
  readonly config: LiveAssistantClientConfig;
}) {
  const text = liveMessagesFor(locale);
  const state = useSyncExternalStore(
    liveAssistant.subscribe,
    liveAssistant.getSnapshot,
    liveAssistant.getServerSnapshot,
  );
  const active = isLiveActive(state.status);
  const busy = state.status === 'starting' || state.status === 'closing';
  const name = { name: assistantNameFor(locale, config) };

  let label = text.card.start;
  if (state.status === 'starting') label = text.card.starting;
  else if (state.status === 'closing') label = text.card.closing;
  else if (active) label = text.card.stop;

  // Why it cannot start yet, said once: the owner's settings first, then the missing connection.
  const reason = config.unavailableReason
    ? text.card.notReady[config.unavailableReason]
    : !state.available
      ? text.card.notReady.no_provider
      : null;
  const canStart = state.available && config.ready;
  const typed = active && state.channel === 'text';
  const typingReason = config.textUnavailableReason
    ? text.card.typing.notReady[config.textUnavailableReason]
    : null;

  return (
    <section className="live-card" aria-label={fill(text.card.title, name)}>
      <h3>{fill(text.card.title, name)}</h3>
      <p className="muted">{fill(text.card.intro, name)}</p>
      <div className="toolbar">
        <button
          type="button"
          className={active ? 'secondary-button' : 'primary-button'}
          aria-pressed={active}
          disabled={busy || (!active && !canStart)}
          onClick={() => void (active ? liveAssistant.stop() : liveAssistant.start())}
        >
          {typed ? text.card.typing.stop : label}
        </button>
        {!active && !busy && (
          <button
            type="button"
            className="secondary-button"
            disabled={!config.textReady}
            onClick={() => void liveAssistant.start({ channel: 'text' })}
          >
            {text.card.typing.start}
          </button>
        )}
        {state.status !== 'off' && (
          <span className="badge" data-state={state.status}>
            {text.status[state.status]}
          </span>
        )}
      </div>
      {reason && !active && (
        <p className="muted">
          {reason}{' '}
          {config.unavailableReason && (
            <Link href={`/${locale}/live-assistant` as Route}>{text.card.openSettings}</Link>
          )}
        </p>
      )}
      {typingReason && !active && !reason && (
        <p className="muted">
          {typingReason}{' '}
          <Link href={`/${locale}/live-assistant` as Route}>{text.card.openSettings}</Link>
        </p>
      )}
      {typed && <LiveChat locale={locale} />}
      {state.warning && active && (
        <p className="notice warn" role="status">
          {text.card.nearCap}
        </p>
      )}
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
