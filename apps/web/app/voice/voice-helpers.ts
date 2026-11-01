import type { VoiceMode } from '@docoo/contracts';

/** Formats the first candidate the browser can record, the order the server accepts them in. */
const CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

export function pickRecordingType(isSupported: (type: string) => boolean): string | null {
  return CANDIDATES.find((type) => isSupported(type)) ?? null;
}

/** `m:ss` for the running clock of a recording. */
export function formatElapsed(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The four chat modes as the two chips of the chat box show them. */
export function describeMode(
  input: VoiceMode,
  output: VoiceMode,
): 'text' | 'dictate' | 'listen' | 'talk' {
  if (input === 'voice' && output === 'voice') return 'talk';
  if (input === 'voice') return 'dictate';
  if (output === 'voice') return 'listen';
  return 'text';
}

/** What a transcript does in the message box: it is added after what is already typed. */
export function appendTranscript(current: string, transcript: string): string {
  const text = transcript.trim();
  if (!text) return current;
  return current.trim() ? `${current.replace(/\s+$/u, '')} ${text}` : text;
}

/** A problem code from the API, reduced to the family the messages know about. */
export type VoiceProblem =
  | 'disabled'
  | 'not_configured'
  | 'too_long'
  | 'invalid_audio'
  | 'provider'
  | 'timeout'
  | 'limit'
  | 'rate'
  | 'autoplay'
  | 'denied'
  | 'unknown';

/** A browser refuses to start sound that no click asked for; the answer is ready and a tap plays it. */
export function isAutoplayBlock(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'NotAllowedError'
  );
}

export function problemFor(code: string | undefined, status: number): VoiceProblem {
  if (code === undefined && status === 429) return 'rate';
  switch (code) {
    case 'VOICE_DISABLED':
      return 'disabled';
    case 'VOICE_NOT_CONFIGURED':
      return 'not_configured';
    case 'VOICE_AUDIO_TOO_LONG':
    case 'VOICE_AUDIO_TOO_LARGE':
      return 'too_long';
    case 'VOICE_AUDIO_INVALID':
    case 'VOICE_NOTHING_TO_SAY':
      return 'invalid_audio';
    case 'VOICE_PROVIDER_TIMEOUT':
      return 'timeout';
    case 'VOICE_PROVIDER_ERROR':
      return 'provider';
    case 'VOICE_RATE_LIMITED':
      return 'rate';
    case 'AUTH_AI_DISABLED':
    case 'AUTH_AI_LIMIT_REACHED':
      return 'limit';
    default:
      return status === 403 ? 'denied' : 'unknown';
  }
}
