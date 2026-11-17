import assert from 'node:assert/strict';
import test from 'node:test';

import { BEGIN, END, collectFacts, renderBlock, replaceBlock } from './readme-status.mjs';

const base = {
  packageJson: '{"version":"1.2.3"}',
  changelog:
    '# Changelog\n\n## [Unreleased]\n\n## [1.2.3] — 2026-01-02\n\n## [1.2.2] — 2026-01-01\n',
  manifest: 'documents:\n  - path: a.md\n    doc_id: A\n  - path: b.md\n    doc_id: B\n',
  adrFiles: ['0001-a.md', '0002-b.md', 'README.md'],
};

test('facts come from the files that own them', () => {
  assert.deepEqual(collectFacts(base), {
    version: '1.2.3',
    date: '2026-01-02',
    documents: 2,
    adrs: 2,
  });
});

test('a version that was bumped without its changelog entry is refused', () => {
  assert.throws(
    () => collectFacts({ ...base, packageJson: '{"version":"1.3.0"}' }),
    /release them together/u,
  );
});

test('the block is replaced in place and everything around it is kept', () => {
  const readme = `before\n${BEGIN}\nold\n${END}\nafter\n`;
  const next = replaceBlock(readme, renderBlock(collectFacts(base)));
  assert.match(next, /^before\n/u);
  assert.match(next, /نسخهٔ فعلی: 1\.2\.3 \(2026-01-02\)/u);
  assert.ok(next.endsWith(`${END}\nafter\n`));
  assert.equal(replaceBlock(next, renderBlock(collectFacts(base))), next);
});

test('a README without markers is an error, not a silent no-op', () => {
  assert.throws(() => replaceBlock('no markers', 'x'), /no status block/u);
});
