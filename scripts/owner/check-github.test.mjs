import assert from 'node:assert/strict';
import test from 'node:test';

import { ACCEPTANCE_SECRETS, REQUIRED_PR_CHECKS, render, runChecks } from './check-github.mjs';

const ok = (body) => ({ status: 200, body });
const job = (overrides = {}) => ({
  conclusion: 'success',
  steps: [{ name: 'checkout' }],
  started_at: '2026-10-04T10:00:00Z',
  completed_at: '2026-10-04T10:05:00Z',
  ...overrides,
});

/** A repository where everything is in place; tests change one thing at a time. */
function healthy(overrides = {}) {
  const routes = {
    '': ok({ full_name: 'o/r', default_branch: 'main', visibility: 'private' }),
    '/commits/main': ok({ sha: 'abc' }),
    '/commits/abc/check-runs?per_page=100': ok({
      check_runs: [{ name: 'quality' }, { name: 'sast' }],
    }),
    '/branches/main/protection': ok({ required_status_checks: { contexts: REQUIRED_PR_CHECKS } }),
    '/code-scanning/default-setup': ok({
      state: 'configured',
      languages: ['javascript-typescript'],
    }),
    '/actions/runs?per_page=5': ok({ workflow_runs: [{ id: 1, html_url: 'https://x/run/1' }] }),
    '/actions/runs/1/jobs': ok({ jobs: [job(), job()] }),
    '/actions/workflows/ci.yml/runs?branch=main&per_page=1': ok({
      workflow_runs: [{ status: 'completed', conclusion: 'success', html_url: 'https://x/ci' }],
    }),
    '/actions/workflows/security.yml/runs?branch=main&per_page=1': ok({
      workflow_runs: [
        {
          head_sha: 'abc',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://x/security',
        },
      ],
    }),
    '/actions/secrets?per_page=100': ok({
      secrets: ACCEPTANCE_SECRETS.map((secret) => ({ name: secret.name })),
    }),
    '/actions/workflows/provider-acceptance.yml/runs?per_page=1': ok({
      workflow_runs: [{ status: 'completed', conclusion: 'success', html_url: 'https://x/acc' }],
    }),
    ...overrides,
  };
  return async (path) => routes[path] ?? { status: 404, body: { message: 'Not Found' } };
}

const by = (outcome, name) => outcome.results.find((result) => result.name === name);

test('a repository with everything in place passes with exit code 0', async () => {
  const outcome = await runChecks({ repo: 'o/r', api: healthy(), lang: 'en' });
  assert.deepEqual([...new Set(outcome.results.map((result) => result.status))], ['PASS']);
  assert.equal(outcome.exitCode, 0);
  assert.match(outcome.summary, /7 passed, 0 for the owner, 0 failed, 0 unknown/u);
});

test('no branch protection is an action for the owner, with the steps', async () => {
  const api = healthy({
    '/branches/main/protection': { status: 404, body: { message: 'Branch not protected' } },
  });
  const outcome = await runChecks({ repo: 'o/r', api, lang: 'en' });
  const line = by(outcome, 'Default branch protection');
  assert.equal(line.status, 'ACTION');
  assert.match(line.message, /Settings → Branches/u);
  assert.equal(outcome.exitCode, 0);
});

test('protection that does not require the checks CI produces is flagged', async () => {
  const noChecks = healthy({
    '/branches/main/protection': ok({ required_status_checks: { contexts: [] } }),
  });
  assert.equal(
    by(await runChecks({ repo: 'o/r', api: noChecks, lang: 'en' }), 'Default branch protection')
      .status,
    'ACTION',
  );
  const partial = healthy({
    '/branches/main/protection': ok({ required_status_checks: { contexts: ['quality'] } }),
  });
  const line = by(
    await runChecks({ repo: 'o/r', api: partial, lang: 'en' }),
    'Default branch protection',
  );
  assert.equal(line.status, 'ACTION');
  assert.match(line.message, /sast/u);
});

test('a plan that cannot protect a private repository is explained', async () => {
  const api = healthy({
    '/branches/main/protection': {
      status: 403,
      body: {
        message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.',
      },
    },
  });
  const line = by(await runChecks({ repo: 'o/r', api, lang: 'en' }), 'Default branch protection');
  assert.equal(line.status, 'ACTION');
  assert.match(line.message, /GitHub Pro/u);
});

test('CodeQL off is an action, while unreadable configuration is unknown', async () => {
  const off = healthy({
    '/code-scanning/default-setup': ok({ state: 'not-configured' }),
    '/code-scanning/analyses?ref=refs%2Fheads%2Fmain&per_page=100': ok([]),
  });
  assert.equal(
    by(await runChecks({ repo: 'o/r', api: off, lang: 'en' }), 'CodeQL').status,
    'ACTION',
  );
  const hidden = healthy({ '/code-scanning/default-setup': { status: 404, body: {} } });
  assert.equal(
    by(await runChecks({ repo: 'o/r', api: hidden, lang: 'en' }), 'CodeQL').status,
    'UNKNOWN',
  );
  const odd = healthy({ '/code-scanning/default-setup': { status: 500, body: {} } });
  assert.equal(
    by(await runChecks({ repo: 'o/r', api: odd, lang: 'en' }), 'CodeQL').status,
    'UNKNOWN',
  );
});

test('advanced CodeQL proves an analysis on the exact default branch commit', async () => {
  const analysis = {
    id: 42,
    commit_sha: 'abc',
    ref: 'refs/heads/main',
    tool: { name: 'CodeQL' },
    error: '',
  };
  const api = (analyses) =>
    healthy({
      '/code-scanning/default-setup': ok({ state: 'not-configured' }),
      '/code-scanning/analyses?ref=refs%2Fheads%2Fmain&per_page=100': ok(analyses),
    });
  const line = by(await runChecks({ repo: 'o/r', api: api([analysis]), lang: 'en' }), 'CodeQL');
  assert.equal(line.status, 'PASS');
  assert.match(line.message, /analysis 42.*abc/u);
  for (const change of [
    { commit_sha: 'old' },
    { ref: 'refs/pull/1/merge' },
    { tool: { name: 'Someone calling their tool CodeQL-ish' } },
    { error: 'upload failed' },
  ]) {
    assert.equal(
      by(
        await runChecks({ repo: 'o/r', api: api([{ ...analysis, ...change }]), lang: 'en' }),
        'CodeQL',
      ).status,
      'ACTION',
    );
  }
  assert.equal(
    by(
      await runChecks({
        repo: 'o/r',
        api: api([analysis, { ...analysis, id: 43, error: 'failed' }]),
        lang: 'en',
      }),
      'CodeQL',
    ).status,
    'ACTION',
  );
});

test('a new failing scheduled security scan cannot be hidden by old passing CI', async () => {
  const api = healthy({
    '/actions/workflows/security.yml/runs?branch=main&per_page=1': ok({
      workflow_runs: [
        {
          head_sha: 'abc',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://x/security',
        },
      ],
    }),
  });
  const outcome = await runChecks({ repo: 'o/r', api, lang: 'en' });
  assert.equal(by(outcome, 'Latest Security run').status, 'FAIL');
  assert.equal(outcome.exitCode, 1);
});

test('a green acceptance workflow without keys does not certify live providers', async () => {
  const api = healthy({ '/actions/secrets?per_page=100': ok({ secrets: [] }) });
  const line = by(
    await runChecks({ repo: 'o/r', api, lang: 'en' }),
    'Latest Provider acceptance run',
  );
  assert.equal(line.status, 'ACTION');
  assert.match(line.message, /unverified/u);
});

test('main-only checks do not become PR requirements, but absent PR jobs remain required', async () => {
  const api = healthy({
    '/commits/abc/check-runs?per_page=100': ok({
      check_runs: [
        ...REQUIRED_PR_CHECKS.map((name) => ({ name })),
        ...['monitor', 'acceptance', 'sync', 'release'].map((name) => ({ name })),
      ],
    }),
  });
  assert.equal(
    by(await runChecks({ repo: 'o/r', api, lang: 'en' }), 'Default branch protection').status,
    'PASS',
  );
  const missing = healthy({
    '/branches/main/protection': ok({
      required_status_checks: { contexts: REQUIRED_PR_CHECKS.filter((name) => name !== 'codeql') },
    }),
    '/commits/abc/check-runs?per_page=100': ok({ check_runs: [] }),
  });
  const line = by(
    await runChecks({ repo: 'o/r', api: missing, lang: 'en' }),
    'Default branch protection',
  );
  assert.equal(line.status, 'ACTION');
  assert.match(line.message, /codeql/u);
});

test('jobs that end at once without a step mean Actions cannot start (exit code 1)', async () => {
  const stuck = job({
    conclusion: 'failure',
    steps: [],
    started_at: '2026-10-04T17:15:47Z',
    completed_at: '2026-10-04T17:15:48Z',
  });
  const api = healthy({ '/actions/runs/1/jobs': ok({ jobs: [stuck, stuck] }) });
  const outcome = await runChecks({ repo: 'o/r', api, lang: 'en' });
  const line = by(outcome, 'Actions runs');
  assert.equal(line.status, 'FAIL');
  assert.match(line.message, /Billing and plans/u);
  assert.equal(outcome.exitCode, 1);
});

test('a red CI run on the default branch fails the check; a failing job with steps is not "stuck"', async () => {
  const red = healthy({
    '/actions/workflows/ci.yml/runs?branch=main&per_page=1': ok({
      workflow_runs: [{ status: 'completed', conclusion: 'failure', html_url: 'https://x/ci' }],
    }),
    '/actions/runs/1/jobs': ok({ jobs: [job({ conclusion: 'failure' })] }),
  });
  const outcome = await runChecks({ repo: 'o/r', api: red, lang: 'en' });
  assert.equal(by(outcome, 'Actions runs').status, 'FAIL');
  assert.match(by(outcome, 'Actions runs').message, /failed/u);
});

test('missing provider secrets are listed, with the issue they block', async () => {
  const some = healthy({
    '/actions/secrets?per_page=100': ok({ secrets: [{ name: 'OPENAI_API_KEY' }] }),
  });
  const line = by(
    await runChecks({ repo: 'o/r', api: some, lang: 'en' }),
    'Provider acceptance secrets',
  );
  assert.equal(line.status, 'ACTION');
  assert.match(line.message, /Set: OPENAI_API_KEY/u);
  assert.match(line.message, /TRANSCRIPTION_API_KEY/u);
  const none = healthy({ '/actions/secrets?per_page=100': ok({ secrets: [] }) });
  assert.match(
    by(await runChecks({ repo: 'o/r', api: none, lang: 'en' }), 'Provider acceptance secrets')
      .message,
    /#53/u,
  );
  const hidden = healthy({ '/actions/secrets?per_page=100': { status: 403, body: {} } });
  assert.equal(
    by(await runChecks({ repo: 'o/r', api: hidden, lang: 'en' }), 'Provider acceptance secrets')
      .status,
    'UNKNOWN',
  );
});

test('a provider acceptance run that never happened is a to-do', async () => {
  const api = healthy({
    '/actions/workflows/provider-acceptance.yml/runs?per_page=1': ok({ workflow_runs: [] }),
  });
  assert.equal(
    by(await runChecks({ repo: 'o/r', api, lang: 'en' }), 'Latest Provider acceptance run').status,
    'ACTION',
  );
});

test('an unfinished or unreadable CI run is not reported as passing', async () => {
  for (const response of [
    ok({ workflow_runs: [{ status: 'in_progress', conclusion: null, html_url: 'https://x/ci' }] }),
    { status: 403, body: {} },
  ]) {
    const api = healthy({ '/actions/workflows/ci.yml/runs?branch=main&per_page=1': response });
    assert.equal(
      by(await runChecks({ repo: 'o/r', api, lang: 'en' }), 'Actions runs').status,
      'UNKNOWN',
    );
  }
});

test('an unreadable repository stops at once, and an API that throws is "unknown"', async () => {
  const gone = await runChecks({
    repo: 'o/r',
    api: async () => ({ status: 404, body: null }),
    lang: 'en',
  });
  assert.equal(gone.results.length, 1);
  assert.equal(gone.exitCode, 1);
  const flaky = await runChecks({
    repo: 'o/r',
    api: async (path) => {
      if (path === '') return ok({ full_name: 'o/r', default_branch: 'main', private: true });
      throw new Error('network');
    },
    lang: 'en',
  });
  assert.equal(by(flaky, 'Default branch protection').status, 'UNKNOWN');
});

test('the report is readable in Persian and English', async () => {
  const outcome = await runChecks({ repo: 'o/r', api: healthy(), lang: 'fa' });
  assert.match(render(outcome, 'fa'), /موفق/u);
  assert.match(render(outcome, 'fa'), /حفاظت شاخهٔ اصلی/u);
  assert.match(render(await runChecks({ repo: 'o/r', api: healthy(), lang: 'en' }), 'en'), /PASS/u);
});
