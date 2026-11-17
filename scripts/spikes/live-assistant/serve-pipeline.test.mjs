import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { createPipelineServer, llmPricesFromArgs } from './serve-pipeline.mjs';

const EL_KEY = 'el-secret-111';
const LLM_KEY = 'llm-secret-222';
let outDir;
let app;
let port;
let handler;

function request(method, pathname, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: pathname, headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const turn = (query = 'voice=v1&language=fa', headers = {}) =>
  request('POST', `/api/turn?${query}`, {
    headers: { 'x-spike': '1', 'content-type': 'audio/webm;codecs=opus', ...headers },
    body: Buffer.from([1, 2, 3]),
  });

before(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spike-pipe-'));
  app = createPipelineServer({
    elevenKey: EL_KEY,
    llmKey: LLM_KEY,
    llmModel: 'some-llm',
    outDir,
    scenarios: { scenarios: [{ id: '01', spoken: 'سلام' }] },
    prices: { audioIn: 0, audioOut: 0, textIn: 1, textOut: 2 },
    fetchImpl: async (url, init) => handler(String(url), init),
  });
  port = await app.listen(0);
});

after(async () => {
  await app.close();
  await fs.rm(outDir, { recursive: true, force: true });
});

const ok = (body) => new Response(JSON.stringify(body), { status: 200 });

test('turn: speech to text, model, then speech; no key leaves the server', async () => {
  const seen = [];
  handler = async (url, init) => {
    seen.push(url);
    if (url.includes('speech-to-text')) return ok({ text: 'سلام', words: [{ end: 1 }] });
    if (url.includes('chat/completions')) {
      assert.equal(init.headers.authorization, `Bearer ${LLM_KEY}`);
      return ok({
        choices: [{ message: { content: 'درود' } }],
        usage: { prompt_tokens: 20, completion_tokens: 3 },
      });
    }
    return new Response(new Uint8Array([7, 8]), { status: 200 });
  };
  const result = await turn();
  assert.equal(result.status, 200);
  const body = JSON.parse(result.text);
  assert.equal(body.transcript, 'سلام');
  assert.equal(body.reply, 'درود');
  assert.deepEqual(body.usage, { input: 20, output: 3, cached: 0, requests: 1 });
  assert.equal(Buffer.from(body.audioBase64, 'base64').length, 2);
  assert.equal(body.ttsCharacters, 4);
  assert.equal(seen.length, 3);
  assert.ok(!result.text.includes(EL_KEY) && !result.text.includes(LLM_KEY));
});

test('turn: an empty transcript stops before the model is called', async () => {
  const seen = [];
  handler = async (url) => {
    seen.push(url);
    return ok({ text: '' });
  };
  const body = JSON.parse((await turn()).text);
  assert.equal(body.empty, true);
  assert.equal(seen.length, 1);
});

test('turn: a failing stage is named and the keys are redacted', async () => {
  handler = async (url) =>
    url.includes('speech-to-text') ? new Response(`bad key ${EL_KEY}`, { status: 401 }) : ok({});
  const result = await turn();
  assert.equal(result.status, 502);
  const { error } = JSON.parse(result.text);
  assert.equal(error.stage, 'stt');
  assert.equal(error.status, 401);
  assert.match(error.body, /bad key \[KEY\]/u);
  assert.ok(!result.text.includes(EL_KEY));
});

test('turn: rejects a call without the custom header, a bad voice or a non-audio body', async () => {
  const noHeader = await request('POST', '/api/turn?voice=v1', {
    headers: { 'content-type': 'audio/webm' },
    body: Buffer.from([1]),
  });
  assert.equal(noHeader.status, 403);
  assert.equal((await turn('voice=../x&language=fa')).status, 400);
  assert.equal((await turn('voice=v1', { 'content-type': 'text/plain' })).status, 400);
});

test('config and voices: no key is sent to the browser; voices are filtered', async () => {
  handler = async () =>
    ok({
      voices: [
        { voice_id: 'v1', name: 'Sara', verified_languages: [{ language: 'fa' }] },
        { voice_id: 'bad id!', name: 'x' },
      ],
    });
  const config = await request('GET', '/api/config');
  assert.ok(!config.text.includes(EL_KEY) && !config.text.includes(LLM_KEY));
  assert.equal(JSON.parse(config.text).llmModel, 'some-llm');
  const voices = JSON.parse((await request('GET', '/api/voices')).text).voices;
  assert.deepEqual(voices, [{ id: 'v1', name: 'Sara', languages: ['fa'] }]);
});

test('reset and save: the report is written inside the output folder only', async () => {
  const headers = { 'x-spike': '1', 'content-type': 'application/json' };
  assert.equal((await request('POST', '/api/reset', { headers, body: '{}' })).status, 200);
  const saved = await request('POST', '/api/save', {
    headers,
    body: JSON.stringify({ name: 'report', content: '# r' }),
  });
  const file = JSON.parse(saved.text).saved;
  assert.match(file, /^pipeline-report-.*\.md$/u);
  assert.equal(await fs.readFile(path.join(outDir, file), 'utf8'), '# r');
  const bad = await request('POST', '/api/save', {
    headers,
    body: JSON.stringify({ name: '../../x', content: 'y' }),
  });
  assert.equal(bad.status, 400);
});

test('bad Host header is refused (DNS rebinding)', async () => {
  const result = await request('GET', '/api/config', { headers: { host: 'evil.test' } });
  assert.equal(result.status, 403);
});

test('llmPricesFromArgs: both flags or none; audio is priced zero', () => {
  assert.equal(llmPricesFromArgs([]), null);
  assert.throws(() => llmPricesFromArgs(['--price-llm-in', '1']));
  assert.throws(() => llmPricesFromArgs(['--price-llm-in', '1', '--price-llm-out', 'x']));
  assert.deepEqual(llmPricesFromArgs(['--price-llm-in', '1', '--price-llm-out', '4']), {
    audioIn: 0,
    audioOut: 0,
    textIn: 1,
    textOut: 4,
  });
});
