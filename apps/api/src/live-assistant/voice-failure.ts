import type { LiveVoiceCheckFailure } from '@docoo/contracts';

/**
 * What a failed voice link means, as a kind (never the provider's text, which is read here and
 * dropped). The engines give the clues they have (an error event, a close code and reason, an HTTP
 * status and body); this file turns them into one of the kinds the page has words for.
 */

/** The kind a piece of provider text points to, or null when it says nothing clear. */
export function failureOfText(text: string): LiveVoiceCheckFailure | null {
  const lower = text.toLowerCase();
  if (lower.trim() === '') return null;
  if (lower.includes('retention') || lower.includes('enable_logging')) return 'retention';
  if (lower.includes('unsupported_country') || lower.includes('country, region')) return 'region';
  if (
    lower.includes('insufficient_quota') ||
    lower.includes('quota') ||
    lower.includes('billing') ||
    lower.includes('credit') ||
    lower.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limited') ||
    lower.includes('resource_exhausted') ||
    lower.includes('queue_overflow') ||
    lower.includes('too many')
  ) {
    return 'quota';
  }
  if (
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect api key') ||
    lower.includes('auth_error') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key') ||
    /\b401\b/u.test(lower)
  ) {
    return 'auth';
  }
  if (lower.includes('unaccepted_terms') || lower.includes('terms')) return 'terms';
  if (lower.includes('session_time_limit') || lower.includes('session_expired')) {
    return 'session_limit';
  }
  if (lower.includes('voice') && (lower.includes('not_found') || lower.includes('not found'))) {
    return 'voice';
  }
  if (lower.includes('model_not_found') || lower.includes('model not found')) return 'model';
  if (/\b402\b/u.test(lower) || /\b429\b/u.test(lower)) return 'quota';
  if (/\b403\b/u.test(lower)) return 'region';
  if (/\b404\b/u.test(lower)) return 'model';
  return null;
}

/** The kind an HTTP answer means: its text first, then its status. */
export function failureOfHttp(status: number, body: string): LiveVoiceCheckFailure {
  const byText = failureOfText(body);
  if (byText) return byText;
  if (status === 401) return 'auth';
  if (status === 402 || status === 429) return 'quota';
  if (status === 404) return 'voice';
  return 'unexpected';
}

/**
 * A socket reports its failure twice, an error and then a close, and the close is the one that
 * carries the code and the reason. This waits a moment for the close, puts the clues together and
 * reports once.
 */
export function createFailureReporter(
  report: (clue: string) => void,
  graceMs = 25,
): { error: (clue: string) => void; close: (clue: string) => void; cancel: () => void } {
  let clues: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    if (timer) clearTimeout(timer);
    timer = null;
    report(clues.join(' '));
  };
  return {
    error(clue) {
      if (done) return;
      clues.push(clue);
      timer ??= setTimeout(finish, graceMs);
    },
    close(clue) {
      if (done) return;
      clues.push(clue);
      finish();
    },
    cancel() {
      done = true;
      clues = [];
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** The text of a socket's error event, when it has one. */
export function clueOfError(event: unknown): string {
  if (event && typeof event === 'object') {
    const message = (event as { message?: unknown }).message;
    if (typeof message === 'string') return message;
    const error = (event as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const inner = (error as { message?: unknown }).message;
      if (typeof inner === 'string') return inner;
    }
  }
  return '';
}

/** The code and reason of a socket's close event. */
export function clueOfClose(event: { code?: number; reason?: string } | undefined): string {
  return `${event?.code ?? ''} ${event?.reason ?? ''}`.trim();
}
