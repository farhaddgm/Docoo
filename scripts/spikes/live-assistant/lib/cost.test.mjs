import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addTotals, breakdown, EMPTY_TOTALS, hasPrices, priceTotals } from './cost.mjs';

const usage = {
  total_tokens: 3600,
  input_tokens: 1500,
  output_tokens: 2100,
  input_token_details: { text_tokens: 500, audio_tokens: 1000, cached_tokens: 200 },
  output_token_details: { text_tokens: 100, audio_tokens: 2000 },
};

test('breakdown reads the response.usage shape', () => {
  const totals = breakdown(usage);
  assert.equal(totals.totalTokens, 3600);
  assert.equal(totals.audioIn, 1000);
  assert.equal(totals.audioOut, 2000);
  assert.equal(totals.textIn, 500);
  assert.equal(totals.textOut, 100);
  assert.equal(totals.cachedIn, 200);
});

test('breakdown of a missing usage is zeros, and total falls back to input + output', () => {
  assert.deepEqual(breakdown(null), { ...EMPTY_TOTALS });
  assert.equal(breakdown({ input_tokens: 10, output_tokens: 5 }).totalTokens, 15);
});

test('priceTotals multiplies each token kind by its own price', () => {
  const prices = { audioIn: 32, audioOut: 64, textIn: 4, textOut: 16 };
  const usd = priceTotals(breakdown(usage), prices);
  assert.ok(Math.abs(usd - 0.1636) < 1e-9);
});

test('without prices the cost is null, never zero', () => {
  assert.equal(priceTotals(breakdown(usage), null), null);
  assert.equal(priceTotals(breakdown(usage), { audioIn: 32 }), null);
  assert.equal(hasPrices({ audioIn: 0, audioOut: 0, textIn: 0, textOut: 0 }), true);
});

test('addTotals sums every field', () => {
  const sum = addTotals(breakdown(usage), breakdown(usage));
  assert.equal(sum.totalTokens, 7200);
  assert.equal(sum.audioOut, 4000);
});
