import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('the current package version has nonempty notes recognized by the actual Release workflow', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)));
  const workflow = readFileSync(
    new URL('../../.github/workflows/release.yml', import.meta.url),
    'utf8',
  );
  const command = workflow.match(
    /          awk -v v="\$\{TAG#v\}" '([\s\S]*?)' CHANGELOG.md > release-notes.md/u,
  );
  assert.ok(command, 'Release extraction command changed; update the regression to execute it.');
  const notes = execFileSync('awk', ['-v', `v=${version}`, command[1], 'CHANGELOG.md'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.ok(
    notes.trim().length > 0,
    `CHANGELOG.md has no release-compatible section for v${version}`,
  );
});
