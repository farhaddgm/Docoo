import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarizeHeartbeat } from './heartbeat.mjs';

const seconds = (list) => list.map(([t, hidden]) => ({ t: t * 1000, hidden }));

test('counts hidden time, windows and the biggest gap while hidden', () => {
  const info = summarizeHeartbeat(
    seconds([
      [0, false],
      [1, false],
      [2, true],
      [3, true],
      [10, true],
      [11, false],
    ]),
  );
  assert.equal(info.windows, 1);
  assert.equal(info.hiddenSeconds, 8);
  assert.equal(info.maxHiddenGapMs, 7000);
  assert.equal(info.longHiddenGaps, 1);
});

test('a throttled tab (gaps of a minute) shows up as long gaps', () => {
  const samples = seconds([
    [0, true],
    [60, true],
    [120, true],
    [180, true],
  ]);
  const info = summarizeHeartbeat(samples);
  assert.equal(info.longHiddenGaps, 3);
  assert.equal(info.maxHiddenGapMs, 60000);
});

test('events received while hidden are counted and a lost connection while hidden is flagged', () => {
  const samples = seconds([
    [0, false],
    [5, true],
    [20, true],
    [25, false],
  ]);
  const info = summarizeHeartbeat(samples, [
    { t: 1000, kind: 'event' },
    { t: 10_000, kind: 'event' },
    { t: 15_000, kind: 'event' },
    { t: 16_000, kind: 'connection', state: 'disconnected' },
  ]);
  assert.equal(info.eventsWhileHidden, 2);
  assert.equal(info.connectionLostWhileHidden, true);
});

test('a connection that drops while the tab is visible is not blamed on hiding', () => {
  const samples = seconds([
    [0, false],
    [5, true],
    [20, true],
    [25, false],
  ]);
  const info = summarizeHeartbeat(samples, [
    { t: 26_000, kind: 'connection', state: 'disconnected' },
  ]);
  assert.equal(info.connectionLostWhileHidden, false);
});

test('no samples is all zeros', () => {
  const info = summarizeHeartbeat([]);
  assert.equal(info.hiddenSeconds, 0);
  assert.equal(info.windows, 0);
});
