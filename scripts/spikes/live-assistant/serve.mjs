#!/usr/bin/env node
/**
 * Spike فاز ۰ دستیار صوتی (ADR-0055، سند 18): سرور محلی که صفحهٔ آزمایش را می‌دهد و مثل سرور
 * Docoo در معماری پیشنهادی عمل می‌کند: مرورگر فقط SDP خودش را می‌فرستد، کلید فقط اینجاست.
 *
 * اجرا:
 *   OPENAI_API_KEY=... node scripts/spikes/live-assistant/serve.mjs --out <پوشهٔ_خروجی>
 *     [--port 8787] [--scenarios فایل.json]
 *     [--price-audio-in N --price-audio-out N --price-text-in N --price-text-out N]  (دلار به‌ازای هر میلیون توکن)
 *     [--session-override فایل.json] [--dry-run]
 *
 * امنیت: فقط روی 127.0.0.1 گوش می‌دهد؛ Host نامعتبر رد می‌شود (DNS rebinding)؛ هر POST باید هدر
 * `x-spike: 1` داشته باشد (یک سایت دیگر نمی‌تواند آن را بفرستد)؛ کلید هرگز چاپ، ذخیره یا به مرورگر
 * فرستاده نمی‌شود و در متن خطای سرویس‌دهنده هم پوشانده می‌شود. خروجی‌ها فقط در `--out` نوشته
 * می‌شوند و نباید commit شوند.
 *
 * مشخصات endpointها از دانش نویسنده است و در محیط ساخت با مستند رسمی تطبیق داده نشد (دسترسی
 * شبکه نبود). متن خطای سرویس‌دهنده عیناً (تا ۵۰۰ نویسه) در رابط نشان داده می‌شود.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { hasPrices } from './lib/cost.mjs';
import { buildCallForm, buildSessionConfig, INSTRUCTIONS_FA, SPIKE_TOOLS } from './lib/session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const UPSTREAM = 'https://api.openai.com';
const MAX_BODY = 1_000_000;
const CALL_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const SAVE_NAMES = { report: '.md', events: '.jsonl' };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createSpikeServer({
  apiKey,
  fetchImpl = fetch,
  outDir,
  scenarios = { scenarios: [] },
  prices = null,
  sessionOverride = {},
  upstream = UPSTREAM,
} = {}) {
  const redact = (text) => {
    let value = String(text ?? '');
    if (apiKey) value = value.split(apiKey).join('[KEY]');
    return value.slice(0, 500);
  };
  const auth = () => ({ Authorization: `Bearer ${apiKey}` });
  let port = 0;

  const json = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  };

  async function serveFile(response, relative) {
    try {
      const body = await fs.readFile(path.join(here, relative));
      response.writeHead(200, {
        'content-type': TYPES[path.extname(relative)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      json(response, 404, { error: 'not_found' });
    }
  }

  async function handle(request, response) {
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host))
      return json(response, 403, { error: 'bad_host' });
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'GET') {
      if (url.pathname === '/') return serveFile(response, 'public/index.html');
      if (url.pathname === '/app.js') return serveFile(response, 'public/app.js');
      const lib = /^\/lib\/([a-z-]+\.mjs)$/u.exec(url.pathname);
      if (lib) return serveFile(response, `lib/${lib[1]}`);
      if (url.pathname === '/api/config') {
        return json(response, 200, {
          hasKey: Boolean(apiKey),
          scenarios: scenarios.scenarios ?? [],
          tools: SPIKE_TOOLS.map((tool) => tool.name),
          instructions: INSTRUCTIONS_FA,
          prices,
        });
      }
      if (url.pathname === '/api/models') {
        if (!apiKey) return json(response, 200, { models: [] });
        const result = await fetchImpl(`${upstream}/v1/models`, { headers: auth() });
        if (!result.ok) {
          return json(response, 502, {
            error: { status: result.status, body: redact(await result.text()) },
          });
        }
        const data = (await result.json()).data ?? [];
        const ids = data
          .map((item) => item.id)
          .filter((id) => /realtime|transcribe|whisper|audio/iu.test(id));
        return json(response, 200, { models: ids.sort() });
      }
      return json(response, 404, { error: 'not_found' });
    }

    if (request.method !== 'POST' || request.headers['x-spike'] !== '1') {
      return json(response, 403, { error: 'forbidden' });
    }

    const body = JSON.parse((await readBody(request)) || '{}');

    if (url.pathname === '/api/session') {
      if (!apiKey) return json(response, 409, { error: 'no_key' });
      if (typeof body.sdp !== 'string' || body.sdp.length < 10 || !body.model) {
        return json(response, 400, { error: 'invalid_request' });
      }
      const session = buildSessionConfig({
        model: String(body.model),
        voice: body.voice ? String(body.voice) : undefined,
        transcriptionModel: body.transcriptionModel ? String(body.transcriptionModel) : undefined,
        language: body.language ? String(body.language) : 'fa',
        override: sessionOverride,
      });
      const result = await fetchImpl(`${upstream}/v1/realtime/calls`, {
        method: 'POST',
        headers: auth(),
        body: buildCallForm(body.sdp, session),
      });
      const text = await result.text();
      if (!result.ok) {
        return json(response, 502, { error: { status: result.status, body: redact(text) } });
      }
      const location = result.headers.get('location') ?? '';
      const callId = location.split('/').filter(Boolean).at(-1) ?? null;
      return json(response, 200, { sdp: text, callId, session });
    }

    if (url.pathname === '/api/hangup') {
      if (!apiKey) return json(response, 409, { error: 'no_key' });
      if (typeof body.callId !== 'string' || !CALL_ID.test(body.callId)) {
        return json(response, 400, { error: 'invalid_call_id' });
      }
      const result = await fetchImpl(`${upstream}/v1/realtime/calls/${body.callId}/hangup`, {
        method: 'POST',
        headers: auth(),
      });
      return json(response, 200, {
        ok: result.ok,
        status: result.status,
        body: redact(await result.text()),
      });
    }

    if (url.pathname === '/api/save') {
      const extension = SAVE_NAMES[body.name];
      if (!extension || typeof body.content !== 'string' || !outDir) {
        return json(response, 400, { error: 'invalid_request' });
      }
      await fs.mkdir(outDir, { recursive: true });
      const file = path.join(
        outDir,
        `${body.name}-${new Date().toISOString().replace(/[:.]/gu, '-')}${extension}`,
      );
      await fs.writeFile(file, body.content, { mode: 0o600 });
      return json(response, 200, { saved: path.basename(file) });
    }

    return json(response, 404, { error: 'not_found' });
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      const status = typeof error?.status === 'number' ? error.status : 500;
      if (!response.headersSent)
        json(response, status, { error: status === 500 ? 'internal' : 'rejected' });
      else response.end();
    });
  });

  return {
    server,
    listen: (requested = 0) =>
      new Promise((resolve) => {
        server.listen(requested, '127.0.0.1', () => {
          port = server.address().port;
          resolve(port);
        });
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
    get port() {
      return port;
    },
  };
}

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const PRICE_FLAGS = {
  audioIn: 'price-audio-in',
  audioOut: 'price-audio-out',
  textIn: 'price-text-in',
  textOut: 'price-text-out',
};

/**
 * قیمت‌ها (دلار به‌ازای هر میلیون توکن): یا چهار پرچم عددی ساده، یا `--prices` با JSON.
 * چهار پرچم در همهٔ پوسته‌ها (cmd، PowerShell، bash) بدون دردسر نقل‌قول کار می‌کند.
 * ناقص‌بودن خطاست، چون قیمت نصفه هزینهٔ غلط می‌سازد. هیچ‌چیز داده نشود: null (بدون قیمت).
 */
export function pricesFromArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const given = Object.entries(PRICE_FLAGS).filter(([, flag]) => value(flag) !== undefined);
  if (given.length > 0) {
    if (given.length !== 4) {
      throw new Error(
        `قیمت‌ها باید هر چهار پرچم باشند: ${Object.values(PRICE_FLAGS)
          .map((flag) => `--${flag}`)
          .join(' ')}`,
      );
    }
    const prices = {};
    for (const [key, flag] of given) {
      const number = Number(value(flag));
      if (!Number.isFinite(number) || number < 0) {
        throw new Error(`مقدار --${flag} باید عدد غیرمنفی باشد (دلار به‌ازای هر میلیون توکن).`);
      }
      prices[key] = number;
    }
    return prices;
  }
  const json = value('prices');
  if (json === undefined) return null;
  const parsed = JSON.parse(json);
  if (!hasPrices(parsed))
    throw new Error('--prices باید audioIn، audioOut، textIn و textOut را داشته باشد.');
  return parsed;
}

async function readJson(file, fallback) {
  if (!file) return fallback;
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function main() {
  const apiKey = process.env['OPENAI_API_KEY'];
  const dryRun = process.argv.includes('--dry-run');
  if (!apiKey && !dryRun) {
    console.error(
      'OPENAI_API_KEY تنظیم نشده است. برای دیدن صفحه بدون کلید از --dry-run استفاده کنید.',
    );
    process.exit(2);
  }
  const outDir = arg('out');
  if (!outDir && !dryRun) {
    console.error('--out <پوشهٔ_خروجی> لازم است (خارج از مخزن).');
    process.exit(2);
  }
  let prices;
  try {
    prices = pricesFromArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const app = createSpikeServer({
    apiKey,
    outDir: outDir ? path.resolve(outDir) : undefined,
    scenarios: await readJson(
      arg('scenarios'),
      await readJson(path.join(here, 'scenarios.fa.json'), {}),
    ),
    prices,
    sessionOverride: await readJson(arg('session-override'), {}),
  });
  const port = await app.listen(Number(arg('port') ?? 8787));
  console.log(
    `http://127.0.0.1:${port}  (کلید ${apiKey ? 'موجود' : 'ندارد'}؛ با Ctrl+C پایان دهید)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
