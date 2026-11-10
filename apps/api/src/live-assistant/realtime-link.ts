import type { LiveVoiceCheckFailure } from '@docoo/contracts';

/**
 * The link from the server to the provider's realtime voice service (ADR-0055 §4-3). Everything that
 * knows the provider's wire protocol lives in this file, so a change in that protocol is a change
 * here and nowhere else. The check below opens the link, waits for the provider to greet, and closes
 * it: nothing is said, so it costs nothing.
 */

/** The part of a WebSocket the link uses; tests give a scripted one. */
export interface LinkSocket {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  close(code?: number): void;
}

export type LinkSocketFactory = (url: string, headers: Record<string, string>) => LinkSocket;

/** Node's own WebSocket client; it takes request headers as an option, which the browser's does not. */
export const nodeSocketFactory: LinkSocketFactory = (url, headers) =>
  new (
    WebSocket as unknown as new (u: string, o: { headers: Record<string, string> }) => LinkSocket
  )(url, { headers });

export interface LinkCheckInput {
  readonly apiKey: string;
  readonly baseUrl: string | null;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly socket?: LinkSocketFactory;
  readonly now?: () => number;
}

export interface LinkCheckResult {
  readonly ok: boolean;
  readonly failure: LiveVoiceCheckFailure | null;
  readonly events: readonly string[];
  readonly latencyMs: number | null;
}

/** The realtime address of a connection: its own base address if it has one, else the provider's. */
export function realtimeUrl(baseUrl: string | null, model: string): string {
  const base = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
  const wsBase = base.replace(/^http/i, 'ws');
  return `${wsBase}/realtime?model=${encodeURIComponent(model)}`;
}

/** What a refusal at the door means, from the text the provider sent with it (never shown). */
export function classifyRefusal(text: string): LiveVoiceCheckFailure {
  const lower = text.toLowerCase();
  if (lower.includes('unsupported_country') || lower.includes('country, region')) return 'region';
  if (
    lower.includes('401') ||
    lower.includes('invalid_api_key') ||
    lower.includes('incorrect api key')
  )
    return 'auth';
  if (lower.includes('403')) return 'region';
  if (lower.includes('404') || lower.includes('model')) return 'model';
  return 'unexpected';
}

function eventKind(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      const kind = parsed.type;
      if (typeof kind === 'string') return kind.slice(0, 100);
    }
  } catch {
    /* not JSON: ignored */
  }
  return null;
}

export function checkRealtimeLink(input: LinkCheckInput): Promise<LinkCheckResult> {
  const now = input.now ?? Date.now;
  const make = input.socket ?? nodeSocketFactory;
  const started = now();
  const events: string[] = [];
  return new Promise((resolve) => {
    let settled = false;
    let socket: LinkSocket | null = null;
    const finish = (failure: LiveVoiceCheckFailure | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close(1000);
      } catch {
        /* already closed */
      }
      resolve({
        ok: failure === null,
        failure,
        events: events.slice(0, 10),
        latencyMs: failure === null ? now() - started : null,
      });
    };
    const timer = setTimeout(() => finish('timeout'), input.timeoutMs ?? 10_000);
    try {
      socket = make(realtimeUrl(input.baseUrl, input.model), {
        Authorization: `Bearer ${input.apiKey}`,
      });
    } catch {
      finish('network');
      return;
    }
    socket.onmessage = (event) => {
      const kind = eventKind(event.data);
      if (kind) events.push(kind);
      // The provider greets a new link with its session; seeing that proves the door is open.
      if (kind === 'session.created') finish(null);
      if (kind === 'error') finish('unexpected');
    };
    socket.onerror = (event) => {
      const text =
        event && typeof event === 'object' && 'message' in event
          ? String(event.message)
          : '';
      finish(text ? classifyRefusal(text) : 'network');
    };
    socket.onclose = (event) => {
      finish(
        classifyRefusal(`${event.code ?? ''} ${event.reason ?? ''}`.trim()) === 'unexpected'
          ? 'network'
          : classifyRefusal(`${event.code ?? ''} ${event.reason ?? ''}`),
      );
    };
  });
}
