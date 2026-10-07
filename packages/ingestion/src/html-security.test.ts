import { describe, it, expect } from 'vitest';
import { htmlToText, fetchUrl } from './url-fetch.js';
describe('untrusted HTML', () => {
  it('decodes entities once and drops script and SVG content', () => {
    const result = htmlToText(
      '<title>Policy &amp; rules</title><script>hidden</script><svg><text>hidden</text></svg><p>&amp;lt;b&amp;gt;</p>',
    );
    expect(result.title).toBe('Policy & rules');
    expect(result.text).not.toContain('hidden');
    expect(result.text).toContain('&lt;b&gt;');
  });
  it('handles malformed repeated tag prefixes within the test deadline', () => {
    expect(() => htmlToText('<svg'.repeat(25_000))).not.toThrow();
    try {
      htmlToText('<title>'.repeat(25_000));
    } catch (error) {
      expect(error).toMatchObject({ code: 'html_too_deep' });
    }
    expect(htmlToText(' '.repeat(300_000)).text).toBe('');
  }, 2000);
  it('times out DNS as part of the total download deadline', async () => {
    await expect(
      fetchUrl('https://example.test', {
        policy: 'public',
        allowlist: [],
        maxBytes: 100,
        timeoutMs: 20,
        resolve: () => new Promise(() => undefined),
      }),
    ).rejects.toMatchObject({ code: 'url_timeout' });
  });
});
