import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluate, parseRequirements, renderReport } from './trace.mjs';

const files = (present) => ({
  exists: (file) => file in present,
  read: (file) => present[file] ?? '',
});

const ids = ['FR-AUTH-001', 'FR-AUTH-002', 'NFR-SEC-001'];
const goodMap = () => ({
  waiverBudget: 1,
  requirements: {
    'FR-AUTH-001': { status: 'tested', evidence: ['a/login.test.ts'], note: 'Login is exercised.' },
    'FR-AUTH-002': { status: 'waived', evidence: [], note: 'Reset is not built yet.' },
    'NFR-SEC-001': {
      status: 'operational',
      evidence: ['docs/tls.md'],
      note: 'TLS is in the proxy.',
    },
  },
});
const repo = { 'a/login.test.ts': "it('logs in', () => {})", 'docs/tls.md': '# TLS' };

describe('requirement traceability (QA-TRACE)', () => {
  it('reads requirement ids from the documents in order, once each', () => {
    const markdown = [
      '- **FR-AUTH-001:** one',
      '- **NFR-SEC-001:** two',
      '- **FR-AUTH-001:** repeated',
      'text FR-AUTH-009 in a sentence is not a definition',
    ].join('\n');
    assert.deepEqual(parseRequirements(markdown), ['FR-AUTH-001', 'NFR-SEC-001']);
  });

  it('accepts a complete, honest map', () => {
    const { errors, summary } = evaluate({ ids, map: goodMap(), files: files(repo) });
    assert.deepEqual(errors, []);
    assert.deepEqual(summary, { tested: 1, operational: 1, waived: 1, missing: 0 });
  });

  it('rejects a requirement without an entry and an entry without a requirement', () => {
    const map = goodMap();
    delete map.requirements['FR-AUTH-001'];
    map.requirements['FR-GHOST-001'] = { status: 'waived', evidence: [], note: 'No such one.' };
    const { errors } = evaluate({ ids, map, files: files(repo) });
    assert.ok(errors.some((error) => error.startsWith('FR-AUTH-001: has no entry')));
    assert.ok(errors.some((error) => error.startsWith('FR-GHOST-001: is not a requirement')));
  });

  it('rejects tested evidence that is missing, not a test file, or has no test', () => {
    for (const [file, present, reason] of [
      ['a/gone.test.ts', repo, 'does not exist'],
      ['docs/tls.md', repo, 'is not a test file'],
      [
        'a/empty.test.ts',
        { ...repo, 'a/empty.test.ts': 'export const x = 1;' },
        'contains no test',
      ],
      ['../outside.test.ts', repo, 'does not exist'],
    ]) {
      const map = goodMap();
      map.requirements['FR-AUTH-001'].evidence = [file];
      const { errors } = evaluate({ ids, map, files: files(present) });
      assert.ok(
        errors.some((error) => error.includes(reason)),
        `${file}: ${errors.join(' | ')}`,
      );
    }
  });

  it('needs evidence for tested and operational, and none for waived', () => {
    const map = goodMap();
    map.requirements['FR-AUTH-001'].evidence = [];
    map.requirements['FR-AUTH-002'].evidence = ['a/login.test.ts'];
    const { errors } = evaluate({ ids, map, files: files(repo) });
    assert.ok(errors.some((error) => error.includes('needs at least one evidence')));
    assert.ok(errors.some((error) => error.includes('a waived requirement has no evidence')));
  });

  it('needs a note and a known status', () => {
    const map = goodMap();
    map.requirements['FR-AUTH-001'].note = '';
    map.requirements['NFR-SEC-001'].status = 'done';
    const { errors } = evaluate({ ids, map, files: files(repo) });
    assert.ok(errors.some((error) => error.includes('FR-AUTH-001: needs a note')));
    assert.ok(errors.some((error) => error.includes('NFR-SEC-001: status must be')));
  });

  it('stops the waiver count from growing past its budget', () => {
    const map = goodMap();
    map.requirements['FR-AUTH-001'] = { status: 'waived', evidence: [], note: 'Gave up on it.' };
    const { errors } = evaluate({ ids, map, files: files(repo) });
    assert.ok(errors.some((error) => error.includes('exceed the waiverBudget of 1')));
  });

  it('renders totals, a row per family and every waiver with its reason', () => {
    const report = renderReport({ ids, map: goodMap() });
    assert.match(
      report,
      /\*\*3\*\* requirements: \*\*1\*\* tested, \*\*1\*\* operational, \*\*1\*\* waived/u,
    );
    assert.match(report, /\| FR-AUTH \| 1 \| 0 \| 1 \|/u);
    assert.match(report, /\| NFR-SEC \| 0 \| 1 \| 0 \|/u);
    assert.match(report, /- \*\*FR-AUTH-002\*\*: Reset is not built yet\./u);
  });
});
