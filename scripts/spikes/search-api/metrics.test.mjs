import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalUrl,
  costPerSearch,
  describeResults,
  median,
  persianRatio,
  precisionAtK,
  urlOverlap,
} from './metrics.mjs';

test('persianRatio separates Persian from Latin and ignores digits', () => {
  assert.equal(persianRatio('hello world'), 0);
  assert.equal(persianRatio('تحلیل بازار'), 1);
  assert.equal(persianRatio('12345 ---'), 0);
  const mixed = persianRatio('بازار market');
  assert.ok(mixed > 0 && mixed < 1);
});

test('canonicalUrl drops tracking, fragment, www and trailing slash', () => {
  assert.equal(
    canonicalUrl('https://www.Example.com/a/b/?utm_source=x&id=2#top'),
    'https://example.com/a/b?id=2',
  );
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com/');
  assert.equal(canonicalUrl('not a url'), null);
});

test('describeResults counts duplicates, hosts and language share', () => {
  const stats = describeResults(
    [
      { url: 'https://a.com/x', title: 'تحلیل بازار', snippet: 'ب'.repeat(250) },
      { url: 'https://www.a.com/x/', title: 'تحلیل بازار', snippet: '' },
      { url: 'https://b.com/y', title: 'English title', snippet: '' },
    ],
    'fa',
  );
  assert.equal(stats.total, 3);
  assert.equal(stats.unique, 2);
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.distinctHosts, 2);
  assert.equal(stats.languageShare, 2 / 3);
  assert.equal(stats.withTextShare, 1 / 3);
});

test('describeResults on an empty page is all zeros, not NaN', () => {
  const stats = describeResults([], 'en');
  assert.equal(stats.languageShare, 0);
  assert.equal(stats.withTextShare, 0);
});

test('urlOverlap is Jaccard and is zero for two empty sets', () => {
  assert.equal(urlOverlap([], []), 0);
  assert.equal(urlOverlap(['https://a.com/1', 'https://a.com/2'], ['https://a.com/2']), 1 / 2);
  assert.equal(urlOverlap(['https://a.com/1'], ['https://www.a.com/1/']), 1);
});

test('precisionAtK ignores unjudged urls and reports them', () => {
  const ranked = [
    { url: 'https://a.com/1' },
    { url: 'https://a.com/2' },
    { url: 'https://a.com/3' },
  ];
  const judgments = { 'https://a.com/1': 2, 'https://a.com/2': 0 };
  const result = precisionAtK(ranked, judgments, 3);
  assert.equal(result.precision, 1 / 2);
  assert.equal(result.judged, 2);
  assert.equal(result.unjudged, 1);
  assert.equal(precisionAtK(ranked, {}, 3).precision, null);
});

test('costPerSearch and median', () => {
  assert.equal(costPerSearch(5), 0.005);
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});
