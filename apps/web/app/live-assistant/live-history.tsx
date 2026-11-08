'use client';

import type { LiveCostSummary, LiveSessionView } from '@docoo/contracts';
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react';

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
  const [spend, setSpend] = useState<LiveCostSummary | null>(null);
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
        // The summary is a nicety: failing to read it never hides the conversations.
        liveReadApi
          .cost(workspaceId, signal)
          .then((value) => setSpend(isCostSummary(value) ? value : null))
          .catch(() => undefined);
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

  const renderItem = (item: LiveSessionView) => {
    const open = openId === item.id;
    const minutes = formatNumber(
      locale,
      item.minutes > 0 ? Math.max(1, Math.round(item.minutes)) : 0,
    );
    return (
      <li key={item.id} className="live-history-item">
        <div className="live-history-row">
          <span className="live-history-when">
            {when.format(new Date(item.startedAt))}
            <span className="badge" data-state={item.status}>
              {item.endReason ? text.endReasons[item.endReason] : text.sessionStatus[item.status]}
            </span>
          </span>
          <button
            type="button"
            className="secondary-button live-history-toggle"
            aria-expanded={open}
            onClick={() => setOpenId(open ? null : item.id)}
          >
            {open ? text.close : text.open}
          </button>
          <span className="muted live-history-meta">
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
  };

  const groups = groupSessions(items ?? [], Date.now());

  return (
    <section className="live-history" aria-label={text.title}>
      <h3>{text.title}</h3>
      {failed && (
        <p className="notice error" role="alert">
          {text.loadFailed}
        </p>
      )}
      {spend && <SpendSummary locale={locale} spend={spend} />}
      {items?.length === 0 && !failed && <p className="muted">{text.empty}</p>}
      {items && items.length > 0 && (
        <div className="live-history-groups">
          {groups.map(({ key, sessions }) => (
            <details key={key} className="live-history-group">
              <summary>
                <span>{text.groups[key]}</span>
                <span className="badge">{formatNumber(locale, sessions.length)}</span>
              </summary>
              <ul className="live-history-list">{sessions.map(renderItem)}</ul>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

/** Anything that is not a whole summary is ignored: a missing summary must never break the page. */
export function isCostSummary(value: unknown): value is LiveCostSummary {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const period = (key: string) => {
    const entry = record[key] as Record<string, unknown> | undefined;
    return (
      typeof entry === 'object' &&
      entry !== null &&
      ['costUsd', 'typedCostUsd', 'tokens', 'sessions'].every(
        (field) => typeof entry[field] === 'number' && Number.isFinite(entry[field]),
      )
    );
  };
  return (
    period('day') &&
    period('week') &&
    period('month') &&
    typeof record['dailyCapUsd'] === 'number' &&
    Number.isFinite(record['dailyCapUsd'])
  );
}

const dollars = (locale: Locale, value: number): string =>
  formatNumber(locale, Math.round(value * 100) / 100);

export type SessionAgeGroup = 'day' | 'week' | 'month' | 'older';

const DAY = 24 * 60 * 60 * 1000;

/**
 * The conversations under their age: the last 24 hours, 7 days and 30 days, then the older ones.
 * The order inside a group is the order given (newest first); a group with nothing in it is left out.
 */
export function groupSessions<T extends { readonly startedAt: string }>(
  items: readonly T[],
  now: number,
): { key: SessionAgeGroup; sessions: T[] }[] {
  const buckets: Record<SessionAgeGroup, T[]> = { day: [], week: [], month: [], older: [] };
  for (const item of items) {
    const age = now - new Date(item.startedAt).getTime();
    const key: SessionAgeGroup =
      age < DAY ? 'day' : age < 7 * DAY ? 'week' : age < 30 * DAY ? 'month' : 'older';
    buckets[key].push(item);
  }
  return (['day', 'week', 'month', 'older'] as const)
    .map((key) => ({ key, sessions: buckets[key] }))
    .filter((group) => group.sessions.length > 0);
}

/**
 * What the assistant cost. The last 24 hours (the period the daily cap is measured over) show at
 * once, split into voice and typed; the 7 and 30 day rows open on request.
 */
function SpendSummary({
  locale,
  spend,
}: {
  readonly locale: Locale;
  readonly spend: LiveCostSummary;
}) {
  const text = liveMessagesFor(locale).history.spend;
  const [more, setMore] = useState(false);
  const moreId = useId();
  const rows = [
    [text.day, spend.day],
    [text.week, spend.week],
    [text.month, spend.month],
  ] as const;
  const shown = more ? rows : rows.slice(0, 1);
  return (
    <div className="live-spend" role="group" aria-label={text.title}>
      <div className="live-spend-head">
        <h4>{text.title}</h4>
        {spend.dailyCapUsd > 0 && (
          <span className="muted">
            {fill(text.cap, { cap: dollars(locale, spend.dailyCapUsd) })}
          </span>
        )}
      </div>
      {spend.month.sessions === 0 ? (
        <p className="muted">{text.none}</p>
      ) : (
        <>
          <table id={moreId} className="live-spend-table">
            <thead>
              <tr>
                <th scope="col">{text.columns.period}</th>
                <th scope="col">{text.columns.total}</th>
                <th scope="col">{text.columns.voice}</th>
                <th scope="col">{text.columns.typed}</th>
                <th scope="col">{text.columns.tokens}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(([label, period]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{dollars(locale, period.costUsd)}</td>
                  <td>{dollars(locale, Math.max(0, period.costUsd - period.typedCostUsd))}</td>
                  <td>{dollars(locale, period.typedCostUsd)}</td>
                  <td>{formatNumber(locale, period.tokens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="link-button live-spend-toggle"
            aria-expanded={more}
            aria-controls={moreId}
            onClick={() => setMore(!more)}
          >
            {more ? text.less : text.more}
          </button>
        </>
      )}
    </div>
  );
}
