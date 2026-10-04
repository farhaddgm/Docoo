'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api-client';

export interface NoticeState {
  readonly ok: boolean;
  readonly text: string;
}

/** Maps an API error to a localized message; unknown codes fall back to `fallback`. */
export function explainError(
  error: unknown,
  table: Readonly<Record<string, string>>,
  fallback: string,
): string {
  return (error instanceof ApiError && error.code && table[error.code]) || fallback;
}

/**
 * Runs one user action at a time and reports the outcome in a notice. A second click while
 * an action is running is ignored, so a double submit cannot repeat a command.
 */
export function useAction(explain: (error: unknown) => string) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (action: () => Promise<void>, okText: string): Promise<boolean> => {
      if (running.current) return false;
      running.current = true;
      setBusy(true);
      setNotice(null);
      try {
        await action();
        // An empty text means the result is shown by the page itself (a diff, a preview).
        if (okText) setNotice({ ok: true, text: okText });
        return true;
      } catch (error) {
        setNotice({ ok: false, text: explain(error) });
        return false;
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [explain],
  );

  return { busy, notice, setNotice, run };
}

/** Polite status for a success, assertive alert for a failure (WCAG 4.1.3). */
export function Notice({ notice }: { readonly notice: NoticeState | null }) {
  const element = useRef<HTMLParagraphElement>(null);
  // The outcome of an action taken far down the page must not stay out of sight.
  useEffect(() => {
    if (notice) element.current?.scrollIntoView({ block: 'nearest' });
  }, [notice]);
  if (!notice) return null;
  return (
    <p
      ref={element}
      className={`notice ${notice.ok ? 'ok' : 'error'}`}
      role={notice.ok ? 'status' : 'alert'}
    >
      {notice.text}
    </p>
  );
}
