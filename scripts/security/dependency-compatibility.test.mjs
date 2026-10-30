import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('React and React DOM have matching exact runtime versions', () => {
  const { dependencies } = JSON.parse(read('apps/web/package.json'));
  assert.match(dependencies.react, /^\d+\.\d+\.\d+$/u);
  assert.equal(dependencies.react, dependencies['react-dom']);
});

test('the Fastify override applies the version requested by the API to the Nest adapter too', () => {
  const { dependencies } = JSON.parse(read('apps/api/package.json'));
  const override = read('pnpm-workspace.yaml').match(/^  fastify: (\S+)$/mu)?.[1];
  assert.equal(override, dependencies.fastify);
});

test('CodeQL initialization, build and analysis use one pinned action version', () => {
  const uses = [
    ...read('.github/workflows/security.yml').matchAll(
      /uses: github\/codeql-action\/(init|autobuild|analyze)@([a-f0-9]{40})/gu,
    ),
  ];
  assert.deepEqual(uses.map((match) => match[1]).sort(), ['analyze', 'autobuild', 'init']);
  assert.equal(new Set(uses.map((match) => match[2])).size, 1);
});
