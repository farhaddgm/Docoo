import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A plain `<a href="/…">` to a page of this app reloads the whole page, which wipes the browser
 * state kept across pages, most importantly the live voice conversation (ADR-0055 §2). Pages link
 * with `next/link`. Downloads and the API are real files, so they stay plain anchors.
 */
const ROOT = join(import.meta.dirname);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.tsx$/u.test(entry.name) && !/\.test\./u.test(entry.name) ? [path] : [];
  });
}

/** Anchors whose href starts with a slash (a quoted path or a template that begins with one). */
export function plainInternalAnchors(source: string): string[] {
  const anchors = source.match(/<a\b[^>]*?\bhref=(?:"\/(?!\/)[^"]*"|\{`\/[^`]*`\})/gu) ?? [];
  return anchors.filter(
    (anchor) => !/href=(?:"|\{`)\/api\//u.test(anchor) && !/\bdownload\b/u.test(anchor),
  );
}

describe('internal links', () => {
  it('no page links to another page with a plain anchor', () => {
    const offenders = sources(ROOT).flatMap((file) =>
      plainInternalAnchors(readFileSync(file, 'utf8')).map(
        (anchor) => `${file.slice(ROOT.length)}: ${anchor}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('the check itself sees a plain page anchor and lets API files and downloads through', () => {
    expect(plainInternalAnchors('<a href="/fa/projects">x</a>')).toHaveLength(1);
    expect(plainInternalAnchors('<a href={`/${locale}/projects/${id}`}>x</a>')).toHaveLength(1);
    expect(plainInternalAnchors('<a href="/api/files/1">x</a>')).toHaveLength(0);
    expect(plainInternalAnchors('<a href={`/api/files/${id}`} download>x</a>')).toHaveLength(0);
    expect(plainInternalAnchors('<a href="https://example.com">x</a>')).toHaveLength(0);
    expect(plainInternalAnchors('<Link href="/fa/projects">x</Link>')).toHaveLength(0);
  });
});
