import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTracker } from './tracker.mjs';

const usage = {
  total_tokens: 300,
  input_tokens: 200,
  output_tokens: 100,
  input_token_details: { text_tokens: 50, audio_tokens: 150 },
  output_token_details: { text_tokens: 10, audio_tokens: 90 },
};

test('tracker measures latency from end of speech to first output audio (WebRTC and delta forms)', () => {
  const tracker = createTracker();
  tracker.ingest({ type: 'input_audio_buffer.speech_stopped' }, 1000);
  tracker.ingest({ type: 'response.created', response: { id: 'r1' } }, 1100);
  tracker.ingest({ type: 'output_audio_buffer.started', response_id: 'r1' }, 1700);
  tracker.ingest({ type: 'output_audio_buffer.started', response_id: 'r1' }, 2500);
  tracker.ingest({ type: 'response.created', response: { id: 'r2' } }, 3000);
  tracker.ingest({ type: 'response.output_audio.delta', response_id: 'r2' }, 3400);
  const { responses } = tracker.snapshot();
  assert.equal(responses.find((item) => item.id === 'r1').latencyMs, 700);
  assert.equal(responses.find((item) => item.id === 'r2').latencyMs, 2400);
});

test('tracker collects transcripts under old and new event names', () => {
  const tracker = createTracker();
  tracker.ingest(
    { type: 'conversation.item.input_audio_transcription.completed', transcript: 'سلام' },
    1,
  );
  tracker.ingest({ type: 'response.audio_transcript.done', transcript: 'جواب قدیمی' }, 2);
  tracker.ingest({ type: 'response.output_audio_transcript.done', transcript: 'جواب جدید' }, 3);
  const snap = tracker.snapshot();
  assert.deepEqual(snap.userTranscripts, ['سلام']);
  assert.deepEqual(snap.assistantTranscripts, ['جواب قدیمی', 'جواب جدید']);
});

test('a tool call seen in the arguments event and again in response.done is counted once', () => {
  const tracker = createTracker();
  const call = {
    call_id: 'c1',
    name: 'run_task',
    arguments: JSON.stringify({ request: 'یک پروژه بساز' }),
  };
  tracker.ingest({ type: 'response.function_call_arguments.done', ...call }, 10);
  tracker.ingest(
    {
      type: 'response.done',
      response: {
        id: 'r1',
        status: 'completed',
        usage,
        output: [{ type: 'function_call', ...call }],
      },
    },
    20,
  );
  const snap = tracker.snapshot();
  assert.equal(snap.toolCalls.length, 1);
  assert.deepEqual(snap.toolCalls[0].args, { request: 'یک پروژه بساز' });
  assert.equal(snap.toolCalls[0].argsError, null);
  assert.equal(snap.totals.totalTokens, 300);
  assert.equal(snap.totals.audioOut, 90);
});

test('a tool call with broken JSON arguments is kept with its parse error', () => {
  const tracker = createTracker();
  tracker.ingest(
    {
      type: 'response.function_call_arguments.done',
      call_id: 'c2',
      name: 'run_task',
      arguments: '{oops',
    },
    1,
  );
  const [call] = tracker.snapshot().toolCalls;
  assert.equal(call.args, null);
  assert.ok(call.argsError);
});

test('errors are recorded, unknown events are counted, rate limits are ignored', () => {
  const tracker = createTracker();
  tracker.ingest(
    { type: 'error', error: { type: 'invalid_request_error', code: 'x', message: 'bad' } },
    1,
  );
  tracker.ingest({ type: 'something.new' }, 2);
  tracker.ingest({ type: 'something.new' }, 3);
  tracker.ingest({ type: 'rate_limits.updated' }, 4);
  const snap = tracker.snapshot();
  assert.equal(snap.errors.length, 1);
  assert.equal(snap.errors[0].code, 'x');
  assert.deepEqual(snap.unknownEvents, { 'something.new': 2 });
});

test('a failed response is an error', () => {
  const tracker = createTracker();
  tracker.ingest({ type: 'response.done', response: { id: 'r1', status: 'failed' } }, 1);
  assert.equal(tracker.snapshot().errors[0].type, 'response_failed');
});
