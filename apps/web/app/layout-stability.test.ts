import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The sidebar must not jump sideways when a page is long enough to need a scrollbar. The room for
 * the scrollbar is kept on the root element, so every page is as wide as every other one.
 * (Checked in a browser with classic scrollbars: the sidebar sat at the same place on a short and a
 * long page.)
 */
const css = readFileSync(join(import.meta.dirname, 'globals.css'), 'utf8');

/** The declarations of the top-level rule whose selector is exactly `html` (not the one nested in @supports). */
function htmlRule(source: string): string {
  const match = /^html\s*\{([^}]*)\}/mu.exec(source);
  return match?.[1] ?? '';
}

describe('page width', () => {
  it('keeps the room for the page scrollbar on the root element', () => {
    expect(htmlRule(css)).toMatch(/scrollbar-gutter:\s*stable\b/u);
  });

  it('falls back to an always-present scrollbar where scrollbar-gutter is unknown', () => {
    expect(css).toMatch(
      /@supports not \(scrollbar-gutter: stable\)\s*\{\s*html\s*\{[^}]*overflow-y:\s*scroll/u,
    );
  });

  it('the check sees a missing rule', () => {
    expect(htmlRule('body { margin: 0; }')).toBe('');
    expect(htmlRule('html { scrollbar-gutter: stable; }')).toMatch(/stable/u);
  });
});
