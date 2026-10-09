#!/usr/bin/env node
/**
 * Spike: مقایسهٔ Brave / Exa / Tavily روی مسئله‌های نمونه (ADR-0026، سند 16).
 *
 * اجرا:
 *   node scripts/spikes/search-api/run.mjs --out <پوشهٔ_خروجی> [--dry-run] [--count 10] [--judgments فایل.json]
 *
 * کلیدها فقط از محیط خوانده می‌شوند و هرگز چاپ یا ذخیره نمی‌شوند:
 *   BRAVE_SEARCH_API_KEY، EXA_API_KEY، TAVILY_API_KEY
 * ارائه‌دهندهٔ بدون کلید «رد شد» گزارش می‌شود، نه خطا و نه نتیجهٔ ساختگی.
 *
 * مشخصات endpointها از دانش نویسنده است و در محیط ساخت با مستند رسمی تطبیق داده نشد
 * (دسترسی شبکه نبود). قبل از اجرای واقعی با مستند هر ارائه‌دهنده تطبیق دهید؛ پاسخ خطای HTTP عیناً ثبت می‌شود.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { costPerSearch, describeResults, median, precisionAtK, urlOverlap } from './metrics.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const TIMEOUT_MS = 30_000;

const PROVIDERS = {
  brave: {
    keyEnv: 'BRAVE_SEARCH_API_KEY',
    pricePerThousand: 5,
    request: (p, key, count) => ({
      url: `https://api.search.brave.com/res/v1/web/search?${new URLSearchParams({
        q: p.query,
        country: p.country,
        search_lang: p.language,
        count: String(count),
      })}`,
      init: { headers: { 'X-Subscription-Token': key, Accept: 'application/json' } },
    }),
    parse: (json) =>
      (json?.web?.results ?? []).map((r) => ({
        url: r.url,
        title: r.title,
        snippet: r.description,
      })),
  },
  exa: {
    keyEnv: 'EXA_API_KEY',
    pricePerThousand: 7,
    request: (p, key, count) => ({
      url: 'https://api.exa.ai/search',
      init: {
        method: 'POST',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          query: p.query,
          numResults: count,
          contents: { text: { maxCharacters: 1000 } },
        }),
      },
    }),
    parse: (json) =>
      (json?.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.text })),
  },
  tavily: {
    keyEnv: 'TAVILY_API_KEY',
    pricePerThousand: 8,
    request: (p, key, count) => ({
      url: 'https://api.tavily.com/search',
      init: {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ query: p.query, max_results: count, search_depth: 'basic' }),
      },
    }),
    parse: (json) =>
      (json?.results ?? []).map((r) => ({ url: r.url, title: r.title, snippet: r.content })),
  },
};

function parseArgs(argv) {
  const args = { count: 10, dryRun: false, out: null, judgments: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--count') args.count = Number(argv[++i]);
    else if (a === '--judgments') args.judgments = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.out)
    throw new Error(
      '--out <directory> is required (outputs are never written to the repo by default).',
    );
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 20) {
    throw new Error('--count must be an integer from 1 to 20.');
  }
  return args;
}

async function callProvider(provider, problem, key, count) {
  const { url, init } = provider.request(problem, key, count);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const latencyMs = Math.round(performance.now() - started);
    const body = await response.text();
    if (!response.ok) {
      return { ok: false, latencyMs, error: `HTTP ${response.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true, latencyMs, results: provider.parse(JSON.parse(body)) };
  } catch (error) {
    return { ok: false, latencyMs: Math.round(performance.now() - started), error: String(error) };
  }
}

const fmt = (n, digits = 2) => (n === null || n === undefined ? 'n/a' : n.toFixed(digits));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { problems } = JSON.parse(await fs.readFile(path.join(here, 'problems.json'), 'utf8'));
  const judgments = args.judgments ? JSON.parse(await fs.readFile(args.judgments, 'utf8')) : {};
  const active = Object.entries(PROVIDERS).filter(([, p]) => process.env[p.keyEnv]);
  const skipped = Object.entries(PROVIDERS)
    .filter(([, p]) => !process.env[p.keyEnv])
    .map(([name, p]) => `${name} (${p.keyEnv} not set)`);

  console.log(`Providers to run: ${active.map(([n]) => n).join(', ') || 'none'}`);
  if (skipped.length) console.log(`Skipped: ${skipped.join('; ')}`);
  if (args.dryRun) return;
  if (active.length === 0) {
    console.log('No API key is set; nothing was measured and no report was written.');
    process.exitCode = 2;
    return;
  }

  const runs = [];
  for (const problem of problems) {
    for (const [name, provider] of active) {
      const outcome = await callProvider(
        provider,
        problem,
        process.env[provider.keyEnv],
        args.count,
      );
      runs.push({ problem: problem.id, language: problem.language, provider: name, ...outcome });
    }
  }

  const lines = [
    '# گزارش spike جست‌وجو',
    '',
    `تاریخ اجرا: ${new Date().toISOString()} — تعداد نتیجه در هر درخواست: ${args.count}`,
    '',
    '| مسئله | ارائه‌دهنده | وضعیت | تأخیر (ms) | نتیجه | یکتا | دامنهٔ متمایز | سهم زبان درست | سهم متن ≥۲۰۰ حرف | precision@5 (قضاوت‌شده/بدون‌قضاوت) |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const run of runs) {
    if (!run.ok) {
      lines.push(
        `| ${run.problem} | ${run.provider} | خطا: ${run.error.replace(/\|/g, '/').slice(0, 120)} | ${run.latencyMs} | | | | | | |`,
      );
      continue;
    }
    const d = describeResults(run.results, run.language);
    const p5 = precisionAtK(run.results, judgments, 5);
    lines.push(
      `| ${run.problem} | ${run.provider} | ok | ${run.latencyMs} | ${d.total} | ${d.unique} | ${d.distinctHosts} | ${fmt(d.languageShare)} | ${fmt(d.withTextShare)} | ${fmt(p5.precision)} (${p5.judged}/${p5.unjudged}) |`,
    );
  }

  lines.push(
    '',
    '## جمع‌بندی به‌ازای ارائه‌دهنده',
    '',
    '| ارائه‌دهنده | موفقیت | میانهٔ تأخیر (ms) | هزینهٔ هر جست‌وجو (USD، قیمت فهرست) |',
    '| --- | ---: | ---: | ---: |',
  );
  for (const [name, provider] of active) {
    const mine = runs.filter((r) => r.provider === name);
    const okRuns = mine.filter((r) => r.ok);
    lines.push(
      `| ${name} | ${okRuns.length}/${mine.length} | ${fmt(median(okRuns.map((r) => r.latencyMs)), 0)} | ${costPerSearch(provider.pricePerThousand).toFixed(4)} |`,
    );
  }

  if (active.length > 1) {
    lines.push(
      '',
      '## هم‌پوشانی نشانی‌ها (Jaccard)',
      '',
      '| مسئله | جفت | هم‌پوشانی |',
      '| --- | --- | ---: |',
    );
    for (const problem of problems) {
      const ok = runs.filter((r) => r.problem === problem.id && r.ok);
      for (let i = 0; i < ok.length; i += 1) {
        for (let j = i + 1; j < ok.length; j += 1) {
          const overlap = urlOverlap(
            ok[i].results.map((r) => r.url),
            ok[j].results.map((r) => r.url),
          );
          lines.push(`| ${problem.id} | ${ok[i].provider}/${ok[j].provider} | ${fmt(overlap)} |`);
        }
      }
    }
  }

  await fs.mkdir(args.out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.writeFile(path.join(args.out, `report-${stamp}.md`), `${lines.join('\n')}\n`);
  // نتیجه‌های خام برای قضاوت انسانی؛ کلید یا هدر درخواست در آن نیست.
  await fs.writeFile(
    path.join(args.out, `raw-${stamp}.json`),
    JSON.stringify(
      runs.map(({ problem, provider, ok, latencyMs, error, results }) => ({
        problem,
        provider,
        ok,
        latencyMs,
        error,
        results,
      })),
      null,
      2,
    ),
  );
  console.log(`Report written to ${args.out}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
