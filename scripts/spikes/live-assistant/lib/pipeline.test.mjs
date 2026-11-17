import assert from 'node:assert/strict';
import { test } from 'node:test';

import { eventsForTurn, runChatTurn, synthesize, transcribe } from './pipeline.mjs';
import { scoreScenario } from './score.mjs';
import { createTracker } from './tracker.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('runChatTurn: a tool call is answered with the canned result, then the model speaks', async () => {
  const seen = [];
  const answers = [
    reply({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'c1',
                function: { name: 'run_task', arguments: '{"request":"پروژه طرح بهاره"}' },
              },
            ],
          },
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 10,
        prompt_tokens_details: { cached_tokens: 40 },
      },
    }),
    reply({
      choices: [{ message: { content: 'تأیید می‌کنید؟' } }],
      usage: { prompt_tokens: 150, completion_tokens: 6 },
    }),
  ];
  const history = [];
  const result = await runChatTurn({
    baseUrl: 'https://llm.test/v1/',
    apiKey: 'k',
    model: 'm',
    history,
    userText: 'یک پروژه بساز',
    fetchImpl: async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
      return answers.shift();
    },
  });
  assert.equal(seen[0].url, 'https://llm.test/v1/chat/completions');
  assert.equal(seen[0].auth, 'Bearer k');
  assert.equal(seen[0].body.tools.length, 6);
  assert.equal(seen[0].body.messages[0].role, 'system');
  assert.equal(result.reply, 'تأیید می‌کنید؟');
  assert.deepEqual(
    result.toolCalls.map((call) => call.name),
    ['run_task'],
  );
  assert.deepEqual(result.usage, { input: 250, output: 16, cached: 40, requests: 2 });
  // the second request carries the tool result, and the history is kept for the next turn
  assert.equal(seen[1].body.messages.at(-1).role, 'tool');
  assert.deepEqual(
    history.map((item) => item.role),
    ['user', 'assistant', 'tool', 'assistant'],
  );
});

test('runChatTurn: a provider error carries the stage, status and body', async () => {
  await assert.rejects(
    runChatTurn({
      baseUrl: 'https://llm.test/v1',
      apiKey: 'k',
      model: 'm',
      history: [],
      userText: 'x',
      fetchImpl: async () => new Response('nope', { status: 401 }),
    }),
    (error) => error.stage === 'llm' && error.status === 401 && error.body === 'nope',
  );
});

test('eventsForTurn: the realtime tracker and scorer work on a pipeline turn', () => {
  const turn = {
    transcript: 'یک پروژه جدید بساز به اسم طرح فروش بهاره',
    reply: 'تأیید می‌کنید؟',
    toolCalls: [{ callId: 'c1', name: 'run_task', arguments: '{"request":"طرح فروش بهاره"}' }],
    usage: { input: 250, output: 16, cached: 40 },
    speechStoppedAt: 1000,
    firstAudioAt: 2400,
  };
  const tracker = createTracker();
  for (const { at, event } of eventsForTurn(turn)) tracker.ingest(event, at);
  const score = scoreScenario(
    {
      id: '01',
      spoken: turn.transcript,
      entities: ['طرح فروش بهاره'],
      expectTool: { name: 'run_task', args: { request: 'طرح فروش بهاره' } },
    },
    tracker.snapshot(),
  );
  assert.equal(score.tool.ok, true);
  assert.equal(score.latencyMs, 1400);
  assert.equal(score.totals.inputTokens, 250);
  assert.equal(score.totals.outputTokens, 16);
  assert.equal(score.totals.cachedIn, 40);
  assert.equal(score.wer, 0);
});

test('eventsForTurn: no spoken answer means no latency, not zero', () => {
  const tracker = createTracker();
  const turn = {
    transcript: 'تو حذفش کن',
    reply: '',
    toolCalls: [],
    usage: { input: 10, output: 0, cached: 0 },
    speechStoppedAt: 5,
    firstAudioAt: null,
  };
  for (const { at, event } of eventsForTurn(turn)) tracker.ingest(event, at);
  const score = scoreScenario({ id: '08', expectNoTool: true }, tracker.snapshot());
  assert.equal(score.latencyMs, null);
  assert.equal(score.noToolOk, true);
});

test('transcribe and synthesize talk to ElevenLabs with the key in a header', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return url.includes('speech-to-text')
      ? reply({ text: ' سلام ', words: [{ end: 1.5 }, { end: 2.25 }] })
      : new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  };
  const heard = await transcribe({
    fetchImpl,
    baseUrl: 'https://el.test',
    apiKey: 'xk',
    model: 'scribe_v1',
    language: 'fa',
    audio: new Uint8Array([9]),
    mimeType: 'audio/webm',
  });
  assert.deepEqual(heard, { text: 'سلام', seconds: 2.25 });
  assert.equal(calls[0].url, 'https://el.test/v1/speech-to-text');
  assert.equal(calls[0].init.headers['xi-api-key'], 'xk');
  assert.equal(calls[0].init.body.get('model_id'), 'scribe_v1');
  assert.equal(calls[0].init.body.get('language_code'), 'fa');

  const speech = await synthesize({
    fetchImpl,
    baseUrl: 'https://el.test',
    apiKey: 'xk',
    model: 'tts-m',
    voiceId: 'v1',
    language: 'fa',
    text: 'سلام',
  });
  assert.deepEqual([...speech], [1, 2, 3]);
  assert.match(calls[1].url, /\/v1\/text-to-speech\/v1\?output_format=mp3_44100_128$/u);
  assert.equal(JSON.parse(calls[1].init.body).model_id, 'tts-m');
});
