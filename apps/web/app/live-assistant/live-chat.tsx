'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { formatNumber, type Locale } from '../i18n';
import { fill, liveMessagesFor } from './messages';
import { liveAssistant } from './store';

const PROJECT_IN_PATH =
  /\/projects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/iu;

/** The project the owner has open, read from the address; the assistant takes "this project" to mean it. */
export const projectIdFromPath = (path: string | null): string | undefined =>
  path ? PROJECT_IN_PATH.exec(path)?.[1]?.toLowerCase() : undefined;

/**
 * The typed conversation of a running text session: what was said, a box to write in, and a
 * pointer to the confirmation card when the assistant proposed something.
 */
export function LiveChat({ locale }: { readonly locale: Locale }) {
  const text = liveMessagesFor(locale).card.typing;
  const state = useSyncExternalStore(
    liveAssistant.subscribe,
    liveAssistant.getSnapshot,
    liveAssistant.getServerSnapshot,
  );
  const pathname = usePathname();
  const [draft, setDraft] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const waiting = state.actions.some(
    (view) => view.status === 'proposed' || view.status === 'first_confirmed',
  );

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [state.chat.length, state.asking]);

  const send = () => {
    const value = draft.trim();
    if (value === '' || state.asking) return;
    setDraft('');
    void liveAssistant.ask(value, projectIdFromPath(pathname));
  };

  return (
    <div className="live-chat">
      <div className="live-chat-log" role="log" aria-label={text.log} aria-live="polite">
        {state.chat.map((line) => (
          <article
            key={line.id}
            className="live-chat-line"
            data-role={line.role}
            data-failed={line.failed}
          >
            <p className="live-chat-who">{text.roles[line.role]}</p>
            <p className="live-chat-text">
              {line.failed ? (text.failures[line.text] ?? text.failureOther) : line.text}
            </p>
            {line.steps && line.steps.length > 0 && (
              <details className="live-chat-steps">
                <summary>
                  {fill(text.steps, { n: formatNumber(locale, line.steps.length) })}
                </summary>
                <ul>
                  {line.steps.map((step, index) => (
                    <li key={index}>
                      <span>{step.summary}</span>
                      <span className="badge" data-status={step.status}>
                        {text.stepStatus[step.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </article>
        ))}
        {state.asking && (
          <article className="live-chat-line live-chat-thinking" data-role="assistant">
            <p className="live-chat-text muted" role="status">
              {text.thinking}
            </p>
          </article>
        )}
        <div ref={end} />
      </div>
      {waiting && (
        <p className="notice warn" role="status">
          {text.waiting}
        </p>
      )}
      <form
        className="live-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          value={draft}
          rows={2}
          maxLength={2000}
          placeholder={text.placeholder}
          aria-label={text.placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button
          type="submit"
          className="primary-button"
          disabled={state.asking || draft.trim() === ''}
        >
          {text.send}
        </button>
      </form>
    </div>
  );
}
