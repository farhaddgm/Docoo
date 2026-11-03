/**
 * A short reading of a stage output for the "view output" popup of the workflow: the few things a
 * person needs to recall what a stage produced, not the whole result (that stays in the stage's
 * own tab). Pure, so it is tested without the interface. A content that does not have the shape
 * its stage writes gives no blocks at all; the popup then points to the stage's tab.
 */

export type DigestKey =
  | 'problemStatement'
  | 'objectives'
  | 'assumptions'
  | 'unresolved'
  | 'findings'
  | 'ideas'
  | 'outline'
  | 'scores'
  | 'summary';

export interface DigestBlock {
  key: DigestKey;
  /** One paragraph (the problem statement, the evaluation summary). */
  text?: string;
  /** The first few entries, each clipped. */
  items?: string[];
  /** How many entries the output has, so the popup can say how many it does not show. */
  total?: number;
}

/** How many entries of a list the popup shows; the rest are counted, not shown. */
export const DIGEST_LIMIT = 5;
const ITEM_CLIP = 240;
const TEXT_CLIP = 480;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(asText).filter((item) => item !== '') : [];

/** Flattens white space and cuts a long text at `max` characters (counted by code point). */
export function clip(value: string, max: number): string {
  const characters = Array.from(value.replace(/\s+/gu, ' ').trim());
  if (characters.length <= max) return characters.join('');
  return `${characters
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`;
}

function list(key: DigestKey, entries: string[]): DigestBlock[] {
  const kept = entries.filter((entry) => entry !== '');
  if (kept.length === 0) return [];
  return [
    {
      key,
      items: kept.slice(0, DIGEST_LIMIT).map((entry) => clip(entry, ITEM_CLIP)),
      total: kept.length,
    },
  ];
}

function paragraph(key: DigestKey, value: unknown): DigestBlock[] {
  const text = asText(value);
  return text === '' ? [] : [{ key, text: clip(text, TEXT_CLIP) }];
}

/** "Title — description", or whichever of the two there is. */
const titled = (head: string, tail: string): string =>
  head !== '' && tail !== '' ? `${head} — ${tail}` : head || tail;

/**
 * The blocks to show for one stage's output. `score` writes a number the way the page does
 * (digits of the locale); it only matters for the evaluation.
 */
export function digestOutput(
  stage: string,
  content: unknown,
  score: (value: number) => string = String,
): DigestBlock[] {
  if (!isRecord(content)) return [];
  switch (stage) {
    case 'analysis':
      return [
        ...paragraph('problemStatement', content['problemStatement']),
        ...list('objectives', texts(content['objectives'])),
        ...list('assumptions', texts(content['assumptions'])),
        // Definitions written before the analyst existed call the open points `openQuestions`.
        ...list('unresolved', [
          ...texts(content['unresolved']),
          ...texts(content['openQuestions']),
        ]),
      ];
    case 'research':
      return list(
        'findings',
        records(content['findings']).map((finding) => asText(finding['claim'])),
      );
    case 'ideation':
      return list(
        'ideas',
        records(content['ideas']).map((idea) =>
          titled(asText(idea['title']), asText(idea['description'])),
        ),
      );
    case 'documentation':
      return list(
        'outline',
        records(content['outline']).map((item) =>
          titled(asText(item['heading']), asText(item['summary'])),
        ),
      );
    case 'evaluation':
      return [
        ...paragraph('summary', content['summary']),
        ...list(
          'scores',
          records(content['scores']).map((row) => {
            const criterion = asText(row['criterion']);
            const value = row['score'];
            return criterion === ''
              ? ''
              : typeof value === 'number'
                ? `${criterion}: ${score(value)}`
                : criterion;
          }),
        ),
      ];
    default:
      return [];
  }
}

/**
 * The output that stands for a stage: the one the stage reports as its latest, else the current
 * one, else the newest version. Null when the stage has no output.
 */
export function pickOutput<T extends { id: string; versionNo: number; current: boolean }>(
  outputs: readonly T[],
  latestId: string | null | undefined,
): T | null {
  const byId = latestId ? outputs.find((output) => output.id === latestId) : undefined;
  if (byId) return byId;
  const current = outputs.find((output) => output.current);
  if (current) return current;
  return [...outputs].sort((a, b) => b.versionNo - a.versionNo)[0] ?? null;
}
