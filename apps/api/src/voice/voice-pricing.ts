import type { SpeechKind, SpeechUsage } from '@docoo/providers';

/** A row of `voice_prices`; every field a model does not charge for is null. */
export interface VoicePrice {
  readonly perMinute: number | null;
  readonly per1kCharacters: number | null;
  readonly inputPerMillion: number | null;
  readonly outputPerMillion: number | null;
}

/**
 * Cost of one voice call in US dollars (ADR-0046). Speech to text is charged by the minute,
 * text to speech by the thousand characters, and a model that reports tokens by the token as well.
 * Without a price the cost is null ("unpriced"); it is never shown as zero.
 */
export function voiceCostUsd(
  kind: SpeechKind,
  usage: SpeechUsage,
  price: VoicePrice | null,
): number | null {
  if (!price) return null;
  let total = 0;
  let charged = false;
  if (kind === 'stt' && price.perMinute !== null && usage.audioSeconds !== null) {
    total += (price.perMinute * usage.audioSeconds) / 60;
    charged = true;
  }
  if (kind === 'tts' && price.per1kCharacters !== null && usage.characters !== null) {
    total += (price.per1kCharacters * usage.characters) / 1000;
    charged = true;
  }
  if (price.inputPerMillion !== null && usage.inputTokens > 0) {
    total += (price.inputPerMillion * usage.inputTokens) / 1_000_000;
    charged = true;
  }
  if (price.outputPerMillion !== null && usage.outputTokens > 0) {
    total += (price.outputPerMillion * usage.outputTokens) / 1_000_000;
    charged = true;
  }
  return charged ? Math.round(total * 1e8) / 1e8 : null;
}

/** The text that is read aloud: at most `max` characters, cut at the end of a sentence when it can be. */
export function textToSpeak(text: string, max: number): { text: string; truncated: boolean } {
  const clean = text
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/[*_#>]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (clean.length <= max) return { text: clean, truncated: false };
  const head = clean.slice(0, max);
  const cut = Math.max(
    head.lastIndexOf('. '),
    head.lastIndexOf('؟'),
    head.lastIndexOf('! '),
    head.lastIndexOf('۔'),
  );
  return { text: (cut > max * 0.5 ? head.slice(0, cut + 1) : head).trim(), truncated: true };
}
