'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../api-client';
import { formatDateTime, formatNumber, type Locale } from '../i18n';
import { smartApi, type ErrorStatus, type SmartError } from './api';
import { fill, smartErrorMessage, smartMessagesFor } from './messages';
import { refreshSummary } from './summary';

interface ErrorDetailProps {
  readonly locale: Locale;
  readonly workspaceId: string;
  readonly errorId: string;
  readonly onChanged?: ((error: SmartError) => void) | undefined;
  readonly onChat?: ((error: SmartError) => void) | undefined;
  readonly onBack?: (() => void) | undefined;
}

/** One error with its automatic analysis, request, stack and sanitised context (SMT-001). */
export function ErrorDetail({
  locale,
  workspaceId,
  errorId,
  onChanged,
  onChat,
  onBack,
}: ErrorDetailProps) {
  const text = smartMessagesFor(locale);
  const [error, setError] = useState<SmartError | null>(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setFailure('');
    smartApi
      .error(workspaceId, errorId, controller.signal)
      .then((body) => setError(body.error))
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setFailure(smartErrorMessage(locale, caught instanceof ApiError ? caught.code : undefined));
      });
    return () => controller.abort();
  }, [workspaceId, errorId, locale]);

  const change = useCallback(
    async (status: ErrorStatus) => {
      setBusy(true);
      setFailure('');
      try {
        const updated = (await smartApi.setErrorStatus(workspaceId, errorId, status)).error;
        setError((current) => (current ? { ...current, status: updated.status } : updated));
        onChanged?.(updated);
        refreshSummary();
      } catch (caught) {
        setFailure(smartErrorMessage(locale, caught instanceof ApiError ? caught.code : undefined));
      } finally {
        setBusy(false);
      }
    },
    [workspaceId, errorId, locale, onChanged],
  );

  if (failure && !error) return <p className="notice error">{failure}</p>;
  if (!error) return <p role="status">…</p>;

  return (
    <div className="smart-detail">
      {onBack && (
        <button type="button" className="link-like" onClick={onBack}>
          {text.errors.back}
        </button>
      )}
      <p className="smart-chips">
        <span className={`badge smart-status-${error.status}`}>
          {text.errors.status[error.status]}
        </span>
        <span className="badge">{text.errors.source[error.source]}</span>
        <span className="badge">{text.errors.category[error.category]}</span>
        <span className="muted">
          {fill(text.errors.occurrences, { n: formatNumber(locale, error.occurrences) })}
        </span>
      </p>
      <p className="smart-message">{error.message}</p>
      <p className="muted">{text.errors.hint[error.category]}</p>
      <dl className="smart-facts">
        <div>
          <dt>{text.errors.firstSeen}</dt>
          <dd>{formatDateTime(locale, error.firstSeenAt)}</dd>
        </div>
        <div>
          <dt>{text.errors.lastSeen}</dt>
          <dd>{formatDateTime(locale, error.lastSeenAt)}</dd>
        </div>
        {error.route && (
          <div>
            <dt>{text.errors.request}</dt>
            <dd dir="ltr">
              {[error.method, error.route, error.httpStatus].filter(Boolean).join(' ')}
            </dd>
          </div>
        )}
        {error.page && (
          <div>
            <dt>{text.errors.page}</dt>
            <dd dir="ltr">{error.page}</dd>
          </div>
        )}
        {error.correlationId && (
          <div>
            <dt>{text.errors.correlation}</dt>
            <dd dir="ltr">{error.correlationId}</dd>
          </div>
        )}
      </dl>
      {error.stack && (
        <details>
          <summary>{text.errors.stack}</summary>
          <pre className="smart-pre" dir="ltr">
            {error.stack}
          </pre>
        </details>
      )}
      {error.context !== undefined && error.context !== null && (
        <details>
          <summary>{text.errors.context}</summary>
          <pre className="smart-pre" dir="ltr">
            {JSON.stringify(error.context, null, 2)}
          </pre>
        </details>
      )}
      {failure && <p className="notice error">{failure}</p>}
      <div className="toolbar">
        {error.status === 'new' && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void change('seen')}
          >
            {text.errors.actions.seen}
          </button>
        )}
        {(error.status === 'new' || error.status === 'seen') && (
          <>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void change('fixed')}
            >
              {text.errors.actions.fixed}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void change('ignored')}
            >
              {text.errors.actions.ignored}
            </button>
          </>
        )}
        {(error.status === 'fixed' || error.status === 'ignored') && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void change('new')}
          >
            {text.errors.actions.reopen}
          </button>
        )}
        {onChat && (
          <button type="button" className="primary-button" onClick={() => onChat(error)}>
            {text.errors.chat}
          </button>
        )}
      </div>
    </div>
  );
}
