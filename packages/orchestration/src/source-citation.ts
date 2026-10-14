/** Attribution declared in an immutable approved knowledge version; not a verified web fetch. */
export interface SourceCitation {
  readonly title: string;
  readonly url: string;
  readonly author?: string;
  readonly publisher?: string;
  readonly publishedAt?: string;
}

export function declaredSourceCitation(provenance: unknown, content = ''): SourceCitation | null {
  const explicit =
    provenance && typeof provenance === 'object' && 'sourceCitation' in provenance
      ? provenance.sourceCitation
      : null;
  // Existing approved excerpts can contain an explicit attribution header. Read only labeled
  // fields from the immutable full version, never infer metadata from a quote or model output.
  const labeled = (label: string): string | null => {
    const matches = [
      ...content.matchAll(
        new RegExp(
          `(?:^|\\s)${label}:\\s*(.+?)(?=\\s+(?:Title|Author|Publisher|Published|URL|Accessed):|\\n|$)`,
          'gu',
        ),
      ),
    ];
    return matches.length === 1 ? matches[0]![1]!.trim().replace(/\.$/u, '').trim() : null;
  };
  const urls = [...content.matchAll(/(?:^|\s)URL:\s*(https?:\/\/[^\s]+)/gu)];
  const input =
    explicit ??
    (urls.length === 1
      ? {
          title: labeled('Title'),
          url: urls[0]![1],
          author: labeled('Author'),
          publisher: labeled('Publisher'),
          publishedAt: labeled('Published'),
        }
      : null);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const fields = input as Record<string, unknown>;
  const text = (key: string, limit: number): string | null => {
    const value = fields[key];
    return typeof value === 'string' &&
      value.trim() &&
      value.length <= limit &&
      !/[\r\n]/u.test(value)
      ? value.trim()
      : null;
  };
  const title = text('title', 500),
    url = text('url', 2048);
  if (!title || !url) return null;
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password)
      return null;
  } catch {
    return null;
  }
  const author = text('author', 200),
    publisher = text('publisher', 200),
    publishedAt = text('publishedAt', 40);
  return {
    title,
    url,
    ...(author ? { author } : {}),
    ...(publisher ? { publisher } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}
