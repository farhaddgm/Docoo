import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { createSpikeServer, pricesFromArgs } from './serve.mjs';

const KEY = 'sk-test-secret-123';
const upstreamCalls = [];
let outDir;
let app;
let port;
let nextUpstream;

function request(method, pathname, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: pathname, headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

const post = (pathname, body, headers = { 'x-spike': '1', 'content-type': 'application/json' }) =>
  request('POST', pathname, { headers, body });

before(async () => {
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spike-'));
  app = createSpikeServer({
    apiKey: KEY,
    outDir,
    scenarios: { scenarios: [{ id: '01', spoken: 'سلام' }] },
    prices: { audioIn: 1, audioOut: 2, textIn: 3, textOut: 4 },
    fetchImpl: async (url, init) => {
      upstreamCalls.push({ url, init });
      return nextUpstream(url, init);
    },
  });
  port = await app.listen(0);
});

after(async () => {
  await app.close();
  await fs.rm(outDir, { recursive: true, force: true });
});

test('session: forwards the browser offer with the key and returns the answer and call id', async () => {
  nextUpstream = () =>
    new Response('v=0 answer', {
      status: 201,
      headers: { location: '/v1/realtime/calls/rtc_abc123' },
    });
  const result = await post('/api/session', {
    sdp: 'v=0 offer sdp',
    model: 'some-realtime-model',
    voice: 'v1',
  });
  assert.equal(result.status, 200);
  const body = JSON.parse(result.text);
  assert.equal(body.sdp, 'v=0 answer');
  assert.equal(body.callId, 'rtc_abc123');

  const upstream = upstreamCalls.at(-1);
  assert.equal(upstream.url, 'https://api.openai.com/v1/realtime/calls');
  assert.equal(upstream.init.headers.Authorization, `Bearer ${KEY}`);
  assert.equal(await upstream.init.body.get('sdp').text(), 'v=0 offer sdp');
  const session = JSON.parse(await upstream.init.body.get('session').text());
  assert.equal(session.model, 'some-realtime-model');
  assert.equal(session.audio.output.voice, 'v1');
  assert.deepEqual(
    session.tools.map((tool) => tool.name),
    ['run_task', 'confirm_action', 'cancel_action', 'show_on_screen', 'get_status', 'end_session'],
  );
  assert.ok(!result.text.includes(KEY), 'the key never reaches the browser');
});

test('session: a provider error is shown verbatim but the key is redacted', async () => {
  nextUpstream = () => new Response(`bad key ${KEY} rejected`, { status: 401 });
  const result = await post('/api/session', { sdp: 'v=0 offer sdp', model: 'm' });
  assert.equal(result.status, 502);
  const { error } = JSON.parse(result.text);
  assert.equal(error.status, 401);
  assert.match(error.body, /bad key \[KEY\] rejected/u);
  assert.ok(!result.text.includes(KEY));
});

test('session: rejects a request without the custom header (cross-site form)', async () => {
  const result = await post('/api/session', { sdp: 'v=0 offer sdp', model: 'm' }, {});
  assert.equal(result.status, 403);
});

test('session: rejects a forged Host header (DNS rebinding)', async () => {
  const result = await request('GET', '/api/config', { headers: { host: 'evil.example' } });
  assert.equal(result.status, 403);
});

test('config: tells the page a key exists without sending it', async () => {
  const result = await request('GET', '/api/config');
  const body = JSON.parse(result.text);
  assert.equal(body.hasKey, true);
  assert.equal(body.scenarios.length, 1);
  assert.ok(!result.text.includes(KEY));
});

test('models: lists only realtime, transcription and audio models', async () => {
  nextUpstream = () =>
    new Response(
      JSON.stringify({ data: [{ id: 'gpt-x' }, { id: 'rt-realtime-1' }, { id: 'x-transcribe' }] }),
      {
        status: 200,
      },
    );
  const result = await request('GET', '/api/models');
  assert.deepEqual(JSON.parse(result.text).models, ['rt-realtime-1', 'x-transcribe']);
});

test('hangup: only well-formed call ids are forwarded', async () => {
  assert.equal((await post('/api/hangup', { callId: '../../etc' })).status, 400);
  nextUpstream = () => new Response('', { status: 200 });
  const result = await post('/api/hangup', { callId: 'rtc_abc123' });
  assert.equal(JSON.parse(result.text).ok, true);
  assert.equal(
    upstreamCalls.at(-1).url,
    'https://api.openai.com/v1/realtime/calls/rtc_abc123/hangup',
  );
});

test('save: writes only report and events files into the output folder', async () => {
  const saved = JSON.parse((await post('/api/save', { name: 'report', content: '# گزارش' })).text);
  assert.match(saved.saved, /^report-.*\.md$/u);
  assert.equal(await fs.readFile(path.join(outDir, saved.saved), 'utf8'), '# گزارش');
  assert.equal((await post('/api/save', { name: '../evil', content: 'x' })).status, 400);
});

test('static files: the page and library modules are served, nothing else is', async () => {
  assert.equal((await request('GET', '/')).status, 200);
  const lib = await request('GET', '/lib/text.mjs');
  assert.equal(lib.status, 200);
  assert.match(lib.headers['content-type'], /javascript/u);
  assert.equal((await request('GET', '/lib/../serve.mjs')).status, 404);
  assert.equal((await request('GET', '/lib/text.test.mjs')).status, 404);
  assert.equal((await request('GET', '/scenarios.fa.json')).status, 404);
});

test('without a key the session endpoints say so instead of calling out', async () => {
  const keyless = createSpikeServer({ fetchImpl: () => assert.fail('must not call upstream') });
  const keylessPort = await keyless.listen(0);
  const result = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: keylessPort,
        method: 'POST',
        path: '/api/session',
        headers: { 'x-spike': '1', 'content-type': 'application/json' },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ sdp: 'v=0 offer sdp', model: 'm' }));
  });
  await keyless.close();
  assert.equal(result, 409);
});

test('pricesFromArgs: four simple flags, a JSON fallback, or nothing', () => {
  const four = [
    '--price-audio-in',
    '32',
    '--price-audio-out',
    '64',
    '--price-text-in',
    '4',
    '--price-text-out',
    '16',
  ];
  assert.deepEqual(pricesFromArgs(['node', 'serve.mjs', ...four]), {
    audioIn: 32,
    audioOut: 64,
    textIn: 4,
    textOut: 16,
  });
  assert.deepEqual(
    pricesFromArgs(['--prices', '{"audioIn":1,"audioOut":2,"textIn":3,"textOut":4}']),
    { audioIn: 1, audioOut: 2, textIn: 3, textOut: 4 },
  );
  assert.equal(pricesFromArgs(['--out', 'x']), null);
});

test('pricesFromArgs: a half-given or bad price is an error, never a wrong cost', () => {
  assert.throws(() => pricesFromArgs(['--price-audio-in', '32']), /هر چهار پرچم/u);
  const bad = [
    '--price-audio-in',
    'abc',
    '--price-audio-out',
    '1',
    '--price-text-in',
    '1',
    '--price-text-out',
    '1',
  ];
  assert.throws(() => pricesFromArgs(bad), /عدد غیرمنفی/u);
  const negative = [
    '--price-audio-in',
    '-1',
    '--price-audio-out',
    '1',
    '--price-text-in',
    '1',
    '--price-text-out',
    '1',
  ];
  assert.throws(() => pricesFromArgs(negative), /عدد غیرمنفی/u);
  assert.throws(() => pricesFromArgs(['--prices', '{"audioIn":1}']), /audioOut/u);
});
