'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';

import { isLocale, type Locale } from '../i18n';
import { smartBus } from '../smart/bus';
import { smartMessagesFor } from '../smart/messages';

/**
 * Fallback for a page that crashed while rendering. The crash is reported to Smart's error
 * tracker (SMT-001); the previous page state is not kept, so the admin retries.
 */
export default function PageError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const params = useParams<{ locale?: string }>();
  const locale: Locale = params.locale && isLocale(params.locale) ? params.locale : 'fa';
  const text = smartMessagesFor(locale).crash;

  useEffect(() => {
    smartBus.emit({
      type: 'client-error',
      kind: 'render',
      message: error.message || 'Render error',
      ...(error.stack ? { detail: error.stack } : {}),
    });
  }, [error]);

  return (
    <main className="content" id="main-content">
      <section className="card stack" role="alert">
        <h1>{text.title}</h1>
        <p>{text.body}</p>
        <div>
          <button type="button" className="primary-button" onClick={() => retry()}>
            {text.retry}
          </button>
        </div>
      </section>
    </main>
  );
}
