/**
 * Turns the stored content of an output or a document (JSON) into plain text for a screen. Strings
 * stay as they are, lists become lines, objects become "key: value" lines. It is only for showing:
 * the text is masked and cut afterwards, and nothing is ever written back.
 */
const MAX = 20_000;
const TITLE_KEYS = ['title', 'problemStatement', 'headline', 'summary', 'name'];

export function contentToText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (depth > 6) return '';
  if (Array.isArray(value)) {
    return value
      .map((item) => contentToText(item, depth + 1))
      .filter((line) => line !== '')
      .map((line) => `• ${line}`)
      .join('\n')
      .slice(0, MAX);
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = contentToText(item, depth + 1);
        return text === '' ? '' : text.includes('\n') ? `${key}:\n${text}` : `${key}: ${text}`;
      })
      .filter((line) => line !== '')
      .join('\n')
      .slice(0, MAX);
  }
  return '';
}

/** A short headline of a content: a known title-like string field, else null. */
export function contentTitle(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const key of TITLE_KEYS) {
    const item = (value as Record<string, unknown>)[key];
    if (typeof item === 'string' && item.trim() !== '') return item.trim().slice(0, 200);
  }
  return null;
}

export interface ResearchSource {
  readonly title: string | null;
  readonly url: string | null;
  readonly verified: boolean;
}

/**
 * The sources the research stage cited, read from its stored output: every piece of evidence of
 * every finding, one entry per address (or per title for a source of the organization's own
 * knowledge). A source counts as verified when any of its quotes was found in the page.
 */
export function researchSourcesOf(content: unknown): ResearchSource[] {
  if (content === null || typeof content !== 'object') return [];
  const findings = (content as Record<string, unknown>)['findings'];
  if (!Array.isArray(findings)) return [];
  const found = new Map<string, { title: string | null; url: string | null; verified: boolean }>();
  for (const finding of findings) {
    const evidence = (finding as Record<string, unknown> | null)?.['evidence'];
    if (!Array.isArray(evidence)) continue;
    for (const item of evidence) {
      if (item === null || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      const url = typeof entry['url'] === 'string' && entry['url'] !== '' ? entry['url'] : null;
      const title =
        typeof entry['title'] === 'string' && entry['title'] !== '' ? entry['title'] : null;
      const ref = typeof entry['ref'] === 'string' ? entry['ref'] : '';
      const key = url ?? (title !== null ? `t:${title}` : `r:${ref}`);
      const verified = entry['verified'] === true;
      const before = found.get(key);
      found.set(key, {
        title: before?.title ?? title,
        url,
        verified: (before?.verified ?? false) || verified,
      });
    }
  }
  return [...found.values()];
}
