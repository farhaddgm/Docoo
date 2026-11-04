import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareValue, scoreScenario } from './score.mjs';
import { createTracker } from './tracker.mjs';

function run(events) {
  const tracker = createTracker();
  events.forEach((event, index) => tracker.ingest(event, index * 100));
  return tracker.snapshot();
}

const heard = (transcript) => ({
  type: 'conversation.item.input_audio_transcription.completed',
  transcript,
});
const call = (name, args, id = 'c1') => ({
  type: 'response.function_call_arguments.done',
  call_id: id,
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
});

test('compareValue: contains for text, numeric equality for numbers, any-of for arrays', () => {
  assert.equal(compareValue('طرح فروش', 'پروژه‌ای به اسم طرح فروش بهاره'), true);
  assert.equal(compareValue(2500000, '2,500,000'), true);
  assert.equal(compareValue(2500000, '۲٬۵۰۰٬۰۰۰'), true);
  assert.equal(compareValue(2500000, 'دو میلیون'), false);
  assert.equal(compareValue(['20', 'بیست'], 'سقف را بیست دلار بگذار'), true);
  assert.equal(compareValue('x', undefined), false);
});

test('a command scored right: speech understood, correct tool with correct arguments', () => {
  const scenario = {
    id: '01',
    spoken: 'یک پروژه جدید بساز به اسم طرح فروش بهاره',
    entities: ['طرح فروش بهاره'],
    expectTool: { name: 'run_task', args: { request: 'طرح فروش بهاره' } },
  };
  const score = scoreScenario(
    scenario,
    run([
      heard('یک پروژه جدید بساز به اسم طرح فروش بهاره'),
      call('run_task', { request: 'پروژهٔ جدید با نام طرح فروش بهاره بساز' }),
    ]),
  );
  assert.equal(score.wer, 0);
  assert.equal(score.entities[0].hit, true);
  assert.equal(score.tool.ok, true);
});

test('the wrong argument fails the tool check and names the argument', () => {
  const score = scoreScenario(
    { id: '02', expectTool: { name: 'run_task', args: { request: 'طرح فروش بهاره' } } },
    run([call('run_task', { request: 'پروژه طرح فروش پاییزه بساز' })]),
  );
  assert.equal(score.tool.called, true);
  assert.equal(score.tool.ok, false);
  assert.equal(score.tool.args[0].ok, false);
});

test('not calling the expected tool, or calling a different one, fails', () => {
  const scenario = { id: '03', expectTool: { name: 'confirm_action', args: { actionId: 'A1' } } };
  assert.equal(scoreScenario(scenario, run([])).tool.called, false);
  assert.equal(
    scoreScenario(scenario, run([call('cancel_action', { actionId: 'A1' })])).tool.called,
    false,
  );
});

test('the expected tool may be any of several names', () => {
  const scenario = { id: '04', expectTool: { name: ['show_on_screen', 'run_task'], args: {} } };
  assert.equal(
    scoreScenario(scenario, run([call('show_on_screen', { target: 'providers' })])).tool.ok,
    true,
  );
});

test('a tool call whose arguments are not JSON never counts as right', () => {
  const score = scoreScenario(
    { id: '05', expectTool: { name: 'run_task', args: {} } },
    run([call('run_task', '{oops')]),
  );
  assert.equal(score.tool.argsParsed, false);
  assert.equal(score.tool.ok, false);
});

test('expectNoTool is right only when no tool was called', () => {
  const scenario = { id: '06', expectNoTool: true };
  assert.equal(scoreScenario(scenario, run([heard('اونو حذفش کن')])).noToolOk, true);
  assert.equal(
    scoreScenario(scenario, run([call('run_task', { request: 'حذف' })])).noToolOk,
    false,
  );
});

test('a scenario without a transcription event reports it instead of a fake perfect score', () => {
  const score = scoreScenario({ id: '07', spoken: 'سلام', entities: ['سلام'] }, run([]));
  assert.equal(score.sttMissing, true);
  assert.equal(score.wer, null);
  assert.equal(score.entities[0].hit, false);
});
