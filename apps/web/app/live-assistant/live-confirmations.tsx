'use client';

import type { LiveActionView } from '@docoo/contracts';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { formatNumber } from '../i18n';
import { useLocale } from '../locale-context';
import {
  groupable,
  isOpen,
  overdueActions,
  recentResults,
  remainingFor,
  stepsOf,
  waitingActions,
} from './confirmation-model';
import { fill, liveMessagesFor } from './messages';
import { isLiveActive } from './state';
import { liveAssistant } from './store';

/** m:ss in the language's digits. */
function clock(locale: 'fa' | 'en', seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const pad = rest < 10 ? formatNumber(locale, 0) : '';
  return `${formatNumber(locale, minutes)}:${pad}${formatNumber(locale, rest)}`;
}

/**
 * Where a change waits for a person (ADR-0055 §4-5, §4-6, HUG-012). It is mounted with the floating
 * pill, so it shows on every page and without the Smart window: what will happen (the server's own
 * preview), the steps its risk needs and which one is current, how long is left, and the buttons. A
 * spoken answer works the same way; this is the visible half of it.
 */
export function LiveConfirmations() {
  const locale = useLocale();
  const text = liveMessagesFor(locale);
  const state = useSyncExternalStore(
    liveAssistant.subscribe,
    liveAssistant.getSnapshot,
    liveAssistant.getServerSnapshot,
  );
  const active = isLiveActive(state.status) || state.status === 'closing';
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const refreshed = useRef(new Set<string>());

  const remaining = (view: LiveActionView) => remainingFor(state.timing, view, now);
  const waiting = active ? waitingActions(state.actions, remaining) : [];
  const results = active ? recentResults(state.actions, state.timing, now) : [];
  const overdue = active ? overdueActions(state.actions, remaining) : [];
  const ticking = waiting.length > 0 || results.length > 0 || overdue.length > 0;

  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  // A change whose time ran out here is shown to the server, which closes it and says so.
  useEffect(() => {
    for (const view of overdue) {
      if (refreshed.current.has(view.id)) continue;
      refreshed.current.add(view.id);
      void liveAssistant.refresh(view.id);
    }
  }, [overdue]);

  useEffect(() => {
    if (!active) refreshed.current.clear();
  }, [active]);

  if (waiting.length === 0 && results.length === 0) return null;
  const together = groupable(waiting);
  const name = { name: text.name };

  async function run(id: string, work: () => Promise<unknown>) {
    setBusy(id);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="live-confirm"
      role="region"
      aria-label={fill(text.confirm.title, name)}
      aria-live="assertive"
    >
      {together.length >= 2 && (
        <button
          type="button"
          className="primary-button"
          disabled={busy !== null}
          onClick={() => void run('group', () => liveAssistant.confirmGroup())}
        >
          {fill(text.confirm.groupButton, { n: formatNumber(locale, together.length) })}
        </button>
      )}
      {waiting.map((view) => {
        const tier = view.tier === 'T2' || view.tier === 'T3' ? view.tier : 'T1';
        const second = view.status === 'first_confirmed';
        const hint = state.hint?.actionId === view.id ? state.hint.reason : null;
        const target = view.targetName ?? '';
        return (
          <article
            key={view.id}
            className="live-confirm-item"
            data-tier={tier}
            data-status={view.status}
          >
            <header>
              <strong>{fill(text.confirm.title, name)}</strong>
              <span className="badge" data-tier={tier}>
                {text.confirm.tiers[tier].label}
              </span>
              <span className="muted live-confirm-time">
                {fill(text.confirm.timeLeft, { time: clock(locale, remaining(view)) })}
              </span>
            </header>
            <p className="live-confirm-summary">{view.summary}</p>
            <p className="muted">{text.confirm.tiers[tier].hint}</p>
            <ol className="live-steps" aria-label={fill(text.confirm.title, name)}>
              {stepsOf(view).map((step) => (
                <li
                  key={step.key}
                  data-state={step.state}
                  aria-current={step.state === 'current' ? 'step' : undefined}
                >
                  {text.confirm.steps[step.key]}
                </li>
              ))}
            </ol>
            {second && target !== '' && (
              <p className="live-confirm-echo">{fill(text.confirm.echoHint, { target })}</p>
            )}
            {!second && <p className="muted">{text.confirm.voiceHint}</p>}
            {hint && (
              <p className="notice warn" role="status">
                {fill(text.confirm.hints[hint], { target })}
              </p>
            )}
            <div className="toolbar">
              <button
                type="button"
                className="primary-button"
                disabled={busy !== null}
                onClick={() =>
                  void run(view.id, () => liveAssistant.confirm(view.id, { via: 'click' }))
                }
              >
                {second ? text.confirm.finalButton : text.confirm.confirmButton}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={busy !== null}
                onClick={() => void run(view.id, () => liveAssistant.cancel(view.id))}
              >
                {text.confirm.cancelButton}
              </button>
            </div>
          </article>
        );
      })}
      {results.map((view) => {
        const kind =
          view.status === 'executed' ||
          view.status === 'failed' ||
          view.status === 'cancelled' ||
          view.status === 'expired'
            ? view.status
            : null;
        if (!kind || isOpen(view)) return null;
        return (
          <p key={view.id} className="live-confirm-result" data-status={kind} role="status">
            <span className="badge" data-state={kind}>
              {text.confirm.results[kind]}
            </span>{' '}
            {view.summary}
          </p>
        );
      })}
    </section>
  );
}
