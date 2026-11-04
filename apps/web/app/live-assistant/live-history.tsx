'use client';

import type { LiveSessionView } from '@docoo/contracts';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { formatNumber, type Locale } from '../i18n';
import { liveReadApi, type LiveSessionDetail } from './live-api';
import { fill, liveMessagesFor } from './messages';
import { liveAssistant } from './store';

/**
 * Every voice conversation of the owner, newest first, with its transcript and the changes it
 * proposed (HUG-002). Reloaded whenever a session starts or ends, so the list is never stale.
 */
export function LiveHistory({
  workspaceId,
  locale,
  name,
}: {
  readonly workspaceId: string;
  readonly locale: Locale;
  readonly name: string;
}) {
  const text = liveMessagesFor(locale).history;
  const status = useSyncExternalStore(
    liveAssistant.subscribe,
    () => liveAssistant.getSnapshot().status,
    () => 'off' as const,
  );
  const [items, setItems] = useState<LiveSessionView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<LiveSessionDetail | null>(null);
  const [asking, setAsking] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const out = await liveReadApi.sessions(workspaceId, signal);
        setItems(out.items);
        setFailed(false);
      } catch {
        if (!signal?.aborted) setFailed(true);
      }
    },
    [workspaceId],
  );

  // A session that has just started or ended changes the list; the states in between do not.
  const settled = status === 'awake' || status === 'off' || status === 'error';
  useEffect(() => {
    if (!settled) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, settled, status]);

  useEffect(() => {
    setAsking(false);
    setDeleteFailed(false);
    if (!openId) return;
    const controller = new AbortController();
    setDetail(null);
    liveReadApi
      .session(workspaceId, openId, controller.signal)
      .then(setDetail)
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId, openId]);

  async function deleteText(sessionId: string) {
    setDeleteFailed(false);
    try {
      await liveReadApi.deleteTranscript(workspaceId, sessionId);
      setAsking(false);
      const [list, again] = await Promise.all([
        liveReadApi.sessions(workspaceId),
        liveReadApi.session(workspaceId, sessionId),
      ]);
      setItems(list.items);
      setDetail(again);
    } catch {
      setDeleteFailed(true);
    }
  }

  const when = new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <section className="live-history" aria-label={text.title}>
      <h3>{text.title}</h3>
      {failed && (
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
      )}
      {items?.length === 0 && !failed && <p className="muted">{text.empty}</p>}
      {items && items.length > 0 && (
        <ul className="live-history-list">
          {items.map((item) => {
            const open = openId === item.id;
            const minutes = formatNumber(
              locale,
              item.minutes > 0 ? Math.max(1, Math.round(item.minutes)) : 0,
            );
            return (
              <li key={item.id} className="live-history-item">
                <div className="live-history-row">
                  <span>{when.format(new Date(item.startedAt))}</span>
                  <span className="badge" data-state={item.status}>
                    {item.endReason
                      ? text.endReasons[item.endReason]
                      : text.sessionStatus[item.status]}
                  </span>
                  <span className="muted">
                    {fill(text.minutes, { n: minutes })} ·{' '}
                    {fill(text.tokens, {
                      n: formatNumber(locale, item.inputTokens + item.outputTokens),
                    })}
                    {item.costUsd > 0 && (
                      <>
                        {' '}
                        ·{' '}
                        {fill(text.cost, {
                          n: formatNumber(locale, Math.round(item.costUsd * 100) / 100),
                        })}
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : item.id)}
                  >
                    {open ? text.close : text.open}
                  </button>
                </div>
                {open && (
                  <div className="live-history-detail">
                    {!detail && (
                      <p className="muted" aria-busy="true">
                        …
                      </p>
                    )}
                    {detail && detail.session.id === item.id && (
                      <>
                        <h4>{text.transcript}</h4>
                        {detail.messages.length === 0 ? (
                          <p className="muted">{text.noMessages}</p>
                        ) : (
                          <ol className="live-history-lines">
                            {detail.messages.map((message) => (
                              <li key={message.id}>
                                <strong>{fill(text.roles[message.role], { name })}:</strong>{' '}
                                <span>{message.content}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                        {item.status === 'ended' && detail.messages.length > 0 && (
                          <div className="toolbar">
                            {asking ? (
                              <>
                                <span>{text.deleteAsk}</span>
                                <button
                                  type="button"
                                  className="secondary-button live-danger"
                                  onClick={() => void deleteText(item.id)}
                                >
                                  {text.deleteYes}
                                </button>
                                <button
                                  type="button"
                                  className="secondary-button"
                                  onClick={() => setAsking(false)}
                                >
                                  {text.deleteNo}
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                className="secondary-button"
                                onClick={() => setAsking(true)}
                              >
                                {text.deleteText}
                              </button>
                            )}
                          </div>
                        )}
                        {deleteFailed && (
                          <p className="notice error" role="alert">
                            {text.deleteFailed}
                          </p>
                        )}
                        <h4>{text.changes}</h4>
                        {detail.actions.length === 0 ? (
                          <p className="muted">{text.noActions}</p>
                        ) : (
                          <ul className="live-history-lines">
                            {detail.actions.map((action) => (
                              <li key={action.id}>
                                <span>{action.summary || action.capability}</span>{' '}
                                <span className="badge" data-state={action.status}>
                                  {text.actionStatus[action.status]}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
