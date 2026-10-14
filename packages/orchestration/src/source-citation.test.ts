import { describe, expect, it } from 'vitest';
import { declaredSourceCitation } from './source-citation.js';

describe('declared source attribution', () => {
  it('recovers explicitly labeled source identity from existing immutable excerpts', () => {
    const content =
      'Manually supplied excerpt. Title: Original article. Author: Named author, Publisher. Published: 2024-01-15. URL: https://example.org/original/ . Accessed: 2026-10-13. Operator inference is separate.';
    expect(declaredSourceCitation({}, content)).toEqual({
      title: 'Original article',
      author: 'Named author, Publisher',
      publishedAt: '2024-01-15',
      url: 'https://example.org/original/',
    });
    expect(
      declaredSourceCitation(
        {},
        content + ' Title: A different article. URL: https://example.org/other',
      ),
    ).toBeNull();
    expect(
      declaredSourceCitation(
        {},
        'A quote mentions a paper at https://example.org; no labeled attribution.',
      ),
    ).toBeNull();
  });
  it('preserves only explicitly supplied attribution and rejects unsafe URLs', () => {
    const sourceCitation = {
      title: 'Original title',
      url: 'https://example.org/paper',
      author: 'Declared author',
      unknown: 'ignored',
    };
    expect(declaredSourceCitation({ sourceCitation })).toEqual({
      title: 'Original title',
      url: 'https://example.org/paper',
      author: 'Declared author',
    });
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://key:secret@example.org',
      'https://example.org/\nsecret',
    ])
      expect(declaredSourceCitation({ sourceCitation: { ...sourceCitation, url } })).toBeNull();
    expect(
      declaredSourceCitation({ declaration: 'Title and URL have not been supplied.' }),
    ).toBeNull();
    expect(declaredSourceCitation({ sourceCitation: { url: 'https://example.org' } })).toBeNull();
  });
});
