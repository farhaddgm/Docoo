#!/usr/bin/env node
/**
 * Spike فاز ۰، آداپتر `pipeline` (ADR-0055، سند 18): رونویسی ElevenLabs ← مدل متنی با ابزار ← صدای
 * ElevenLabs، با همان ۱۲ سناریو و همان امتیازدهی مسیر بلادرنگ.
 *
 * اجرا:
 *   ELEVENLABS_API_KEY=... LLM_API_KEY=... node scripts/spikes/live-assistant/serve-pipeline.mjs \
 *     --out <پوشهٔ_خروجی> --llm-model <مدل> [--llm-base-url https://api.openai.com/v1] \
 *     [--stt-model scribe_v1] [--tts-model eleven_v4_turbo] [--port 8788] [--scenarios فایل.json] \
 *     [--price-llm-in N --price-llm-out N]  (دلار به‌ازای هر میلیون توکن) [--dry-run]
 *
 * `LLM_API_KEY` اگر نباشد از `OPENAI_API_KEY` خوانده می‌شود. هر سرویس سازگار با OpenAI Chat
 * Completions (و ابزار) کار می‌کند. امنیت مثل `serve.mjs`: فقط 127.0.0.1، Host و هدر `x-spike`
 * بررسی می‌شود، کلیدها هرگز به مرورگر نمی‌رسند و در متن خطا پوشانده می‌شوند.
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runChatTurn, synthesize, transcribe } from './lib/pipeline.mjs';
import { INSTRUCTIONS_FA, SPIKE_TOOLS } from './lib/session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_JSON = 1_000_000;
const MAX_AUDIO = 12_000_000;
const SAVE_NAMES = { report: '.md', events: '.jsonl' };
const AUDIO_TYPE = /^audio\/[a-z0-9.+-]{1,40}$/u;
const VOICE_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createPipelineServer({
  elevenKey,
  llmKey,
  llmModel,
  llmBaseUrl = 'https://api.openai.com/v1',
  sttModel = 'scribe_v1',
  ttsModel = 'eleven_v4_turbo',
  elevenBaseUrl = 'https://api.elevenlabs.io',
  fetchImpl = fetch,
  outDir,
  scenarios = { scenarios: [] },
  prices = null,
} = {}) {
  let history = [];
  let port = 0;

  const redact = (text) => {
    let value = String(text ?? '');
    for (const key of [elevenKey, llmKey]) if (key) value = value.split(key).join('[KEY]');
    return value.slice(0, 500);
  };
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

  async function turn(request, response, url) {
    if (!elevenKey || !llmKey) return json(response, 409, { error: 'no_key' });
    const mimeType = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const voiceId = url.searchParams.get('voice') ?? '';
    const language = url.searchParams.get('language') === 'en' ? 'en' : 'fa';
    if (!AUDIO_TYPE.test(mimeType) || !VOICE_ID.test(voiceId) || !llmModel) {
      return json(response, 400, { error: 'invalid_request' });
    }
    const audio = await readBody(request, MAX_AUDIO);
    const timings = { sttMs: 0, llmMs: 0, ttsMs: 0 };
    const fail = (error) =>
      json(response, 502, {
        error: {
          stage: error.stage ?? 'internal',
          status: error.status ?? 0,
          body: redact(error.body ?? error.message),
        },
      });
    let heard;
    let step;
    try {
      let started = performance.now();
      heard = await transcribe({
        fetchImpl,
        baseUrl: elevenBaseUrl,
        apiKey: elevenKey,
        model: sttModel,
        language,
        audio,
        mimeType,
      });
      timings.sttMs = Math.round(performance.now() - started);
      if (!heard.text) return json(response, 200, { transcript: '', empty: true, timings });
      started = performance.now();
      step = await runChatTurn({
        fetchImpl,
        baseUrl: llmBaseUrl,
        apiKey: llmKey,
        model: llmModel,
        history,
        userText: heard.text,
      });
      timings.llmMs = Math.round(performance.now() - started);
      let speech = null;
      if (step.reply) {
        started = performance.now();
        speech = await synthesize({
          fetchImpl,
          baseUrl: elevenBaseUrl,
          apiKey: elevenKey,
          model: ttsModel,
          voiceId,
          language,
          text: step.reply,
        });
        timings.ttsMs = Math.round(performance.now() - started);
      }
      return json(response, 200, {
        transcript: heard.text,
        sttSeconds: heard.seconds,
        reply: step.reply,
        toolCalls: step.toolCalls,
        usage: step.usage,
        ttsCharacters: step.reply.length,
        audioBase64: speech ? Buffer.from(speech).toString('base64') : null,
        timings,
      });
    } catch (error) {
      return fail(error);
    }
  }

  async function handle(request, response) {
    const host = request.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/u.test(host))
      return json(response, 403, { error: 'bad_host' });
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'GET') {
      if (url.pathname === '/') return serveFile(response, 'public/pipeline.html');
      if (url.pathname === '/pipeline.js') return serveFile(response, 'public/pipeline.js');
      const lib = /^\/lib\/([a-z-]+\.mjs)$/u.exec(url.pathname);
      if (lib) return serveFile(response, `lib/${lib[1]}`);
      if (url.pathname === '/api/config') {
        return json(response, 200, {
          hasKey: Boolean(elevenKey && llmKey),
          llmModel: llmModel ?? null,
          sttModel,
          ttsModel,
          scenarios: scenarios.scenarios ?? [],
          tools: SPIKE_TOOLS.map((tool) => tool.name),
          instructions: INSTRUCTIONS_FA,
          prices,
        });
      }
      if (url.pathname === '/api/voices') {
        if (!elevenKey) return json(response, 200, { voices: [] });
        const result = await fetchImpl(`${elevenBaseUrl}/v2/voices?page_size=100`, {
          headers: { 'xi-api-key': elevenKey, accept: 'application/json' },
        });
        const text = await result.text();
        if (!result.ok) {
          return json(response, 502, { error: { status: result.status, body: redact(text) } });
        }
        const voices = (JSON.parse(text).voices ?? [])
          .filter((voice) => VOICE_ID.test(voice.voice_id ?? ''))
          .map((voice) => ({
            id: voice.voice_id,
            name: String(voice.name ?? voice.voice_id),
            languages: (voice.verified_languages ?? []).map((item) => item.language),
          }));
        return json(response, 200, { voices });
      }
      return json(response, 404, { error: 'not_found' });
    }

    if (request.method !== 'POST' || request.headers['x-spike'] !== '1') {
      return json(response, 403, { error: 'forbidden' });
    }
    if (url.pathname === '/api/turn') return turn(request, response, url);

    const body = JSON.parse((await readBody(request, MAX_JSON)).toString('utf8') || '{}');
    if (url.pathname === '/api/reset') {
      history = [];
      return json(response, 200, { ok: true });
    }
    if (url.pathname === '/api/save') {
      const extension = SAVE_NAMES[body.name];
      if (!extension || typeof body.content !== 'string' || !outDir) {
        return json(response, 400, { error: 'invalid_request' });
      }
      await fs.mkdir(outDir, { recursive: true });
      const file = path.join(
        outDir,
        `pipeline-${body.name}-${new Date().toISOString().replace(/[:.]/gu, '-')}${extension}`,
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

/** قیمت مدل متنی: هر دو پرچم یا هیچ. صدا و رونویسی ElevenLabs بر حسب توکن نیست و اینجا قیمت نمی‌خورد. */
export function llmPricesFromArgs(argv) {
  const value = (name) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const input = value('price-llm-in');
  const output = value('price-llm-out');
  if (input === undefined && output === undefined) return null;
  if (input === undefined || output === undefined) {
    throw new Error('هر دو پرچم --price-llm-in و --price-llm-out لازم است.');
  }
  const prices = { audioIn: 0, audioOut: 0, textIn: Number(input), textOut: Number(output) };
  if (![prices.textIn, prices.textOut].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new Error('قیمت‌ها باید عدد غیرمنفی باشند (دلار به‌ازای هر میلیون توکن).');
  }
  return prices;
}

async function main() {
  const elevenKey = process.env['ELEVENLABS_API_KEY'];
  const llmKey = process.env['LLM_API_KEY'] ?? process.env['OPENAI_API_KEY'];
  const dryRun = process.argv.includes('--dry-run');
  if ((!elevenKey || !llmKey) && !dryRun) {
    console.error(
      'ELEVENLABS_API_KEY و LLM_API_KEY (یا OPENAI_API_KEY) هر دو لازم است. بدون کلید فقط با --dry-run.',
    );
    process.exit(2);
  }
  const outDir = arg('out');
  const llmModel = arg('llm-model');
  if (!dryRun && (!outDir || !llmModel)) {
    console.error('--out <پوشهٔ_خروجی> و --llm-model <مدل> لازم است.');
    process.exit(2);
  }
  let prices;
  try {
    prices = llmPricesFromArgs(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  const readJson = async (file, fallback) =>
    file ? JSON.parse(await fs.readFile(file, 'utf8')) : fallback;
  const app = createPipelineServer({
    elevenKey,
    llmKey,
    llmModel,
    ...(arg('llm-base-url') ? { llmBaseUrl: arg('llm-base-url') } : {}),
    ...(arg('stt-model') ? { sttModel: arg('stt-model') } : {}),
    ...(arg('tts-model') ? { ttsModel: arg('tts-model') } : {}),
    outDir: outDir ? path.resolve(outDir) : undefined,
    scenarios: await readJson(
      arg('scenarios'),
      await readJson(path.join(here, 'scenarios.fa.json'), {}),
    ),
    prices,
  });
  const port = await app.listen(Number(arg('port') ?? 8788));
  console.log(
    `http://127.0.0.1:${port}  (کلیدها ${elevenKey && llmKey ? 'موجود' : 'ناقص'}؛ با Ctrl+C پایان دهید)`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
