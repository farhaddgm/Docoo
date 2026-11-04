import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aggregate, renderMarkdown, THRESHOLDS, verdict } from './report.mjs';
import { summarizeHeartbeat } from './heartbeat.mjs';

const totals = (overrides = {}) => ({
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  audioIn: 80,
  textIn: 20,
  cachedIn: 0,
  audioOut: 40,
  textOut: 10,
  ...overrides,
});

const result = (id, over = {}) => ({
  scenario: { id },
  score: {
    id,
    heard: 'متن شنیده‌شده',
    wer: 0.05,
    sttMissing: false,
    entities: [{ entity: 'x', hit: true }],
    tool: { ok: true, called: true, calledName: 'run_task', args: [] },
    noToolOk: null,
    latencyMs: 1200,
    totals: totals(),
    errors: 0,
    ...over,
  },
});

const prices = { audioIn: 32, audioOut: 64, textIn: 4, textOut: 16 };
const quiet = summarizeHeartbeat(
  [
    { t: 0, hidden: false },
    { t: 1000, hidden: true },
    { t: 2000, hidden: true },
  ],
  [],
);

test('everything passing is a go', () => {
  const stats = aggregate([result('a'), result('b')], { prices, activeSeconds: 600 });
  assert.equal(verdict(stats, quiet).overall, 'go');
});

test('a failed hard criterion (tool accuracy) is a no-go', () => {
  const bad = result('b', { tool: { ok: false, called: true, calledName: 'run_task', args: [] } });
  const stats = aggregate([result('a'), bad], { prices, activeSeconds: 600 });
  assert.equal(stats.toolAccuracy, 0.5);
  assert.equal(verdict(stats, quiet).overall, 'no-go');
});

test('only slow or expensive is conditional, not no-go', () => {
  const slow = result('a', { latencyMs: THRESHOLDS.latencyMedianMsMax + 1 });
  const stats = aggregate([slow], { prices, activeSeconds: 600 });
  assert.equal(verdict(stats, quiet).overall, 'conditional');
});

test('missing prices and missing hidden-tab data make the result incomplete, never a go', () => {
  const stats = aggregate([result('a')], { prices: null, activeSeconds: 600 });
  assert.equal(stats.usd, null);
  assert.equal(verdict(stats, quiet).rows.cost.status, 'unknown');
  assert.equal(
    verdict(aggregate([result('a')], { prices, activeSeconds: 600 }), null).overall,
    'incomplete',
  );
});

test('a connection lost while the browser was hidden is a no-go', () => {
  const lost = summarizeHeartbeat(
    [
      { t: 0, hidden: true },
      { t: 1000, hidden: true },
    ],
    [{ t: 500, kind: 'connection', state: 'disconnected' }],
  );
  const stats = aggregate([result('a')], { prices, activeSeconds: 600 });
  assert.equal(verdict(stats, lost).overall, 'no-go');
});

test('the Markdown report states the decision, the thresholds, unpriced cost and the human checklist', () => {
  const markdown = renderMarkdown({
    meta: { model: 'm', activeSeconds: 120, prices: null },
    results: [result('01-create-project')],
    heartbeat: null,
  });
  assert.match(markdown, /## نتیجه:/u);
  assert.match(markdown, /بدون قیمت/u);
  assert.match(markdown, /01-create-project/u);
  assert.match(markdown, /داوری انسانی/u);
});

test('an empty run still renders without NaN', () => {
  const markdown = renderMarkdown({ meta: {}, results: [], heartbeat: null });
  assert.doesNotMatch(markdown, /NaN|undefined/u);
});
