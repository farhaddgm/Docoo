#!/usr/bin/env node
/**
 * Owner check of the GitHub side of the private beta (SEC-001 #89, ING-005 #53, REL-002 #94):
 * branch protection, CodeQL, whether Actions can start jobs at all, the provider-acceptance
 * secrets and the latest runs. It only reads. Every line says PASS, ACTION (something only the
 * owner can do, with the steps), FAIL or UNKNOWN (the token cannot see it).
 *
 *   GITHUB_TOKEN=<token with repo + admin:repo_hook read> node scripts/owner/check-github.mjs
 *   node scripts/owner/check-github.mjs --repo owner/name --lang en
 *
 * Without GITHUB_TOKEN/GH_TOKEN the token of an installed, signed-in `gh` is used.
 */
import { execFileSync } from 'node:child_process';

export const ACCEPTANCE_SECRETS = [
  { name: 'OPENAI_API_KEY', purpose: 'AI provider acceptance (OpenAI)' },
  { name: 'GEMINI_API_KEY', purpose: 'AI provider acceptance (Gemini)' },
  { name: 'ANTHROPIC_API_KEY', purpose: 'AI provider acceptance (Anthropic)' },
  { name: 'TRANSCRIPTION_API_KEY', purpose: 'speech-to-text acceptance (ING-005, #53)' },
];

const text = {
  fa: {
    repo: 'مخزن',
    repoOk: '{name} ({visibility}، شاخهٔ اصلی {branch})',
    repoFail: 'مخزن خوانده نشد (کد {status}). نام مخزن و دسترسی کلید را بررسی کنید.',
    protection: 'حفاظت شاخهٔ اصلی',
    protectionOk: 'فعال است؛ بررسی‌های الزامی: {checks}.',
    protectionNone:
      'شاخهٔ {branch} حفاظت ندارد. Settings → Branches → Add rule: Require a pull request و Require status checks (دست‌کم «quality») را روشن کنید.',
    protectionPlan:
      'حفاظت شاخه در این طرح GitHub برای مخزن خصوصی در دسترس نیست. یا GitHub Pro بگیرید یا مخزن را عمومی کنید (#89).',
    protectionNoChecks:
      'حفاظت هست ولی هیچ بررسی الزامی ندارد؛ «quality» و بقیهٔ بررسی‌های CI را الزامی کنید.',
    protectionMissing:
      'حفاظت هست؛ این بررسی‌های CI الزامی نیستند: {checks}. اگر می‌خواهید جلوی ادغام را بگیرند اضافه‌شان کنید.',
    codeql: 'CodeQL',
    codeqlOk: 'فعال است ({languages}).',
    codeqlOff:
      'CodeQL فعال نیست. Settings → Code security → Code scanning → Set up → Default را بزنید (#89).',
    codeqlUnknown: 'وضعیت CodeQL با این کلید دیده نمی‌شود (کد {status}).',
    actions: 'اجرای Actions',
    actionsOk: 'آخرین اجرای CI روی {branch}: {conclusion}.',
    actionsStuck:
      'کارهای Actions در همان ثانیهٔ اول و بدون هیچ گام شکست می‌خورند ({run}). معمولاً سقف هزینه یا اعتبار Actions تمام شده یا runner داده نمی‌شود: Settings → Billing and plans را ببینید.',
    actionsRed: 'آخرین اجرای CI روی {branch} شکست خورده است: {url}',
    actionsNone: 'هنوز اجرایی دیده نشد.',
    secrets: 'کلیدهای پذیرش provider',
    secretsOk: 'تنظیم‌شده: {present}.',
    secretsMissing:
      'تنظیم نشده: {missing}. Settings → Secrets and variables → Actions → New repository secret؛ بدون آن آزمون پذیرش آن بخش «رد می‌شود» و گواهی نمی‌دهد (#53).',
    secretsNone:
      'هیچ کلیدی تنظیم نشده؛ آزمون پذیرش provider و تبدیل گفتار به متن اجرا نمی‌شود (#53).',
    secretsUnknown: 'فهرست secretها با این کلید دیده نمی‌شود (دسترسی admin لازم است).',
    acceptance: 'آخرین اجرای Provider acceptance',
    acceptanceOk: '{conclusion}: {url}',
    acceptanceNone: 'هنوز اجرا نشده؛ Actions → Provider acceptance → Run workflow.',
    unknownApi: 'خوانده نشد (کد {status}).',
    summary: '{pass} موفق، {action} اقدام برای مالک، {fail} ناموفق، {unknown} نامشخص.',
    sources: { PASS: 'موفق', ACTION: 'اقدام', FAIL: 'ناموفق', UNKNOWN: 'نامشخص' },
  },
  en: {
    repo: 'Repository',
    repoOk: '{name} ({visibility}, default branch {branch})',
    repoFail: 'The repository could not be read (status {status}). Check the name and the token.',
    protection: 'Default branch protection',
    protectionOk: 'On; required checks: {checks}.',
    protectionNone:
      'Branch {branch} has no protection. Settings → Branches → Add rule: turn on Require a pull request and Require status checks (at least "quality").',
    protectionPlan:
      'Branch protection is not available for a private repository on this GitHub plan. Get GitHub Pro or make the repository public (#89).',
    protectionNoChecks:
      'Protection exists but requires no checks; require "quality" and the other CI checks.',
    protectionMissing:
      'Protection exists; these CI checks are not required: {checks}. Add them if they should block a merge.',
    codeql: 'CodeQL',
    codeqlOk: 'On ({languages}).',
    codeqlOff: 'CodeQL is off. Settings → Code security → Code scanning → Set up → Default (#89).',
    codeqlUnknown: 'CodeQL cannot be seen with this token (status {status}).',
    actions: 'Actions runs',
    actionsOk: 'Latest CI run on {branch}: {conclusion}.',
    actionsStuck:
      'Actions jobs fail within the first second with no steps ({run}). Usually the Actions spending limit or credit is used up or no runner is assigned: see Settings → Billing and plans.',
    actionsRed: 'The latest CI run on {branch} failed: {url}',
    actionsNone: 'No run seen yet.',
    secrets: 'Provider acceptance secrets',
    secretsOk: 'Set: {present}.',
    secretsMissing:
      'Not set: {missing}. Settings → Secrets and variables → Actions → New repository secret; without it that acceptance test is skipped and certifies nothing (#53).',
    secretsNone:
      'No key is set; the provider and speech-to-text acceptance tests do not run (#53).',
    secretsUnknown: 'The secret list cannot be seen with this token (admin access needed).',
    acceptance: 'Latest Provider acceptance run',
    acceptanceOk: '{conclusion}: {url}',
    acceptanceNone: 'Never run; Actions → Provider acceptance → Run workflow.',
    unknownApi: 'Could not be read (status {status}).',
    summary: '{pass} passed, {action} for the owner, {fail} failed, {unknown} unknown.',
    sources: { PASS: 'PASS', ACTION: 'ACTION', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN' },
  },
};

const fill = (template, values) =>
  template.replace(/\{(\w+)\}/gu, (_, key) => String(values[key] ?? ''));

/**
 * Runs every check. `api(path)` resolves `{ status, body }` for a GET under /repos/{repo}; the CLI
 * passes a fetch-based one and tests pass a map. Returns the results and the exit code.
 */
export async function runChecks({ repo, api, lang = 'fa' }) {
  const t = text[lang] ?? text.fa;
  const results = [];
  const add = (name, status, message) => results.push({ name, status, message });
  const get = async (path) => {
    try {
      return await api(path);
    } catch {
      return { status: 0, body: null };
    }
  };

  const info = await get('');
  if (info.status !== 200) {
    add(t.repo, 'FAIL', fill(t.repoFail, { status: info.status }));
    return finish(results, t);
  }
  const branch = info.body.default_branch ?? 'main';
  add(
    t.repo,
    'PASS',
    fill(t.repoOk, {
      name: info.body.full_name ?? repo,
      visibility: info.body.visibility ?? (info.body.private ? 'private' : 'public'),
      branch,
    }),
  );

  // Branch protection and the checks CI actually produces on the default branch.
  const latestCommit = await get(`/commits/${branch}`);
  const sha = latestCommit.body?.sha;
  const runs = sha
    ? await get(`/commits/${sha}/check-runs?per_page=100`)
    : { status: 0, body: null };
  const produced = [...new Set((runs.body?.check_runs ?? []).map((run) => run.name))];
  const protection = await get(`/branches/${branch}/protection`);
  if (protection.status === 200) {
    const required = [
      ...(protection.body.required_status_checks?.contexts ?? []),
      ...(protection.body.required_status_checks?.checks ?? []).map((check) => check.context),
    ];
    if (required.length === 0) add(t.protection, 'ACTION', t.protectionNoChecks);
    else {
      const missing = produced.filter((name) => !required.includes(name));
      add(
        t.protection,
        missing.length > 0 ? 'ACTION' : 'PASS',
        missing.length > 0
          ? fill(t.protectionMissing, { checks: missing.join(', ') })
          : fill(t.protectionOk, { checks: required.join(', ') }),
      );
    }
  } else if (protection.status === 404) {
    add(t.protection, 'ACTION', fill(t.protectionNone, { branch }));
  } else if (
    protection.status === 403 &&
    /upgrade|pro|public/iu.test(protection.body?.message ?? '')
  ) {
    add(t.protection, 'ACTION', t.protectionPlan);
  } else {
    add(t.protection, 'UNKNOWN', fill(t.unknownApi, { status: protection.status }));
  }

  const codeql = await get('/code-scanning/default-setup');
  if (codeql.status === 200 && codeql.body.state === 'configured') {
    add(
      t.codeql,
      'PASS',
      fill(t.codeqlOk, { languages: (codeql.body.languages ?? []).join(', ') }),
    );
  } else if (codeql.status === 200) {
    add(t.codeql, 'ACTION', t.codeqlOff);
  } else if (codeql.status === 404 || codeql.status === 403) {
    add(t.codeql, 'ACTION', t.codeqlOff);
  } else {
    add(t.codeql, 'UNKNOWN', fill(t.codeqlUnknown, { status: codeql.status }));
  }

  // Can Actions start a job at all? A run whose jobs end at once without a step cannot.
  const workflowRuns = await get(`/actions/runs?per_page=5`);
  const newest = workflowRuns.body?.workflow_runs?.[0];
  if (!newest) {
    add(
      t.actions,
      'UNKNOWN',
      workflowRuns.status === 200
        ? t.actionsNone
        : fill(t.unknownApi, { status: workflowRuns.status }),
    );
  } else {
    const jobs = await get(`/actions/runs/${newest.id}/jobs`);
    const list = jobs.body?.jobs ?? [];
    const stuck =
      list.length > 0 &&
      list.every(
        (job) =>
          job.conclusion === 'failure' &&
          (job.steps?.length ?? 0) === 0 &&
          new Date(job.completed_at).getTime() - new Date(job.started_at).getTime() < 5_000,
      );
    if (stuck) add(t.actions, 'FAIL', fill(t.actionsStuck, { run: newest.html_url }));
    else {
      const onBranch = await get(`/actions/workflows/ci.yml/runs?branch=${branch}&per_page=1`);
      const last = onBranch.body?.workflow_runs?.[0];
      if (last && last.conclusion !== 'success' && last.status === 'completed') {
        add(t.actions, 'FAIL', fill(t.actionsRed, { branch, url: last.html_url }));
      } else {
        add(
          t.actions,
          'PASS',
          fill(t.actionsOk, { branch, conclusion: last?.conclusion ?? last?.status ?? '—' }),
        );
      }
    }
  }

  const secrets = await get('/actions/secrets?per_page=100');
  if (secrets.status === 200) {
    const names = new Set((secrets.body.secrets ?? []).map((secret) => secret.name));
    const present = ACCEPTANCE_SECRETS.filter((secret) => names.has(secret.name)).map(
      (s) => s.name,
    );
    const missing = ACCEPTANCE_SECRETS.filter((secret) => !names.has(secret.name)).map(
      (s) => s.name,
    );
    if (present.length === 0) add(t.secrets, 'ACTION', t.secretsNone);
    else if (missing.length > 0) {
      add(
        t.secrets,
        'ACTION',
        `${fill(t.secretsOk, { present: present.join(', ') })} ${fill(t.secretsMissing, { missing: missing.join(', ') })}`,
      );
    } else add(t.secrets, 'PASS', fill(t.secretsOk, { present: present.join(', ') }));
  } else {
    add(t.secrets, 'UNKNOWN', t.secretsUnknown);
  }

  const acceptance = await get('/actions/workflows/provider-acceptance.yml/runs?per_page=1');
  const lastAcceptance = acceptance.body?.workflow_runs?.[0];
  if (lastAcceptance) {
    add(
      t.acceptance,
      lastAcceptance.conclusion === 'success' ? 'PASS' : 'ACTION',
      fill(t.acceptanceOk, {
        conclusion: lastAcceptance.conclusion ?? lastAcceptance.status,
        url: lastAcceptance.html_url,
      }),
    );
  } else {
    add(t.acceptance, 'ACTION', t.acceptanceNone);
  }
  return finish(results, t);
}

function finish(results, t) {
  const count = (status) => results.filter((result) => result.status === status).length;
  return {
    results,
    summary: fill(t.summary, {
      pass: count('PASS'),
      action: count('ACTION'),
      fail: count('FAIL'),
      unknown: count('UNKNOWN'),
    }),
    // Only a real failure makes the exit code non-zero; an action for the owner is a to-do.
    exitCode: count('FAIL') > 0 ? 1 : 0,
  };
}

export function render({ results, summary }, lang = 'fa') {
  const t = text[lang] ?? text.fa;
  return [
    ...results.map(
      (result) => `${t.sources[result.status].padEnd(8)} ${result.name}: ${result.message}`,
    ),
    '',
    summary,
  ].join('\n');
}

function detectRepo() {
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const match = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/u.exec(url);
  if (!match) throw new Error('Pass --repo owner/name.');
  return match[1];
}

function detectToken() {
  const env = process.env['GITHUB_TOKEN'] ?? process.env['GH_TOKEN'];
  if (env) return env;
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const repo = option('repo') ?? detectRepo();
  const lang = option('lang') === 'en' ? 'en' : 'fa';
  const token = detectToken();
  if (!token) {
    console.error('Set GITHUB_TOKEN (or sign in with `gh auth login`) first.');
    process.exit(2);
  }
  const api = async (path) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'docoo-owner-check',
      },
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
      // An empty body is fine; the status says enough.
    }
    return { status: response.status, body };
  };
  const outcome = await runChecks({ repo, api, lang });
  console.log(render(outcome, lang));
  process.exit(outcome.exitCode);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
