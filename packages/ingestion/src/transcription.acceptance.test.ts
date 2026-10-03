import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { wordAccuracy } from './accuracy.js';
import { transcriberFromEnv } from './transcription.js';

/**
 * ING-005 acceptance on the real speech-to-text service. Runs only with
 * TRANSCRIPTION_API_KEY (the Provider acceptance workflow passes the repository secret).
 */
const corpus = fileURLToPath(new URL('../../../qa/acceptance-corpus/v0/', import.meta.url));

interface AudioItem {
  id: string;
  file: string;
  language: string;
  expected: { transcript: string; minWordAccuracy: number; durationSeconds: number };
}

const manifest = JSON.parse(readFileSync(`${corpus}manifest.json`, 'utf8')) as
  { items: AudioItem[] } | AudioItem[];
const items = (Array.isArray(manifest) ? manifest : manifest.items).filter(
  (item) => (item as { kind?: string }).kind === 'audio',
);

describe.skipIf(!process.env['TRANSCRIPTION_API_KEY'])(
  'speech-to-text acceptance (ING-005)',
  () => {
    it.each(items.map((item) => [item.id, item] as const))(
      '%s reaches its word accuracy and keeps segment timing',
      async (_id, item) => {
        const transcript = await transcriberFromEnv().transcribe(
          new Uint8Array(readFileSync(`${corpus}${item.file}`)),
          'audio/wav',
          item.language,
        );
        const text = transcript.segments.map((segment) => segment.text).join(' ');
        const accuracy = wordAccuracy(
          text,
          readFileSync(`${corpus}${item.expected.transcript}`, 'utf8'),
        );
        console.log(
          `${item.id}: word accuracy ${accuracy.toFixed(3)} (minimum ${item.expected.minWordAccuracy})`,
        );
        expect(accuracy).toBeGreaterThanOrEqual(item.expected.minWordAccuracy);
        expect(transcript.segments.length).toBeGreaterThan(0);
        for (const segment of transcript.segments) {
          expect(segment.endMs).toBeGreaterThanOrEqual(segment.startMs);
          expect(segment.endMs).toBeLessThanOrEqual((item.expected.durationSeconds + 1) * 1000);
        }
      },
      120_000,
    );
  },
);
