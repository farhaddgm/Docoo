import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cer, entityInText, median, normalizeFa, wer } from './text.mjs';

test('normalizeFa unifies Arabic letters, digits, zero-width joiner and punctuation', () => {
  assert.equal(normalizeFa('۱۲ آبان ۱۴۰۵'), '12 آبان 1405');
  assert.equal(normalizeFa('كتاب يك'), 'کتاب یک');
  assert.equal(normalizeFa('می‌خواهم؟'), 'می خواهم');
  assert.equal(normalizeFa('  Spring,   Campaign! '), 'spring campaign');
});

test('normalizeFa reads grouped money the same however it is written', () => {
  assert.equal(normalizeFa('۲٬۵۰۰٬۰۰۰'), '2500000');
  assert.equal(normalizeFa('2,500,000'), '2500000');
  assert.equal(normalizeFa('۲،۵۰۰'), '2500');
});

test('wer counts word substitutions, ignores digit and letter variants', () => {
  assert.equal(wer('یک پروژه جدید بساز', 'یک پروژه جدید بساز'), 0);
  assert.equal(wer('یک پروژه جدید بساز', 'یک پروژه قدیمی بساز'), 0.25);
  assert.equal(wer('بودجه ۲۰ دلار', 'بودجه 20 دلار'), 0);
  assert.equal(wer('', ''), 0);
  assert.equal(wer('', 'چیزی'), 1);
  assert.equal(wer('الف ب', ''), 1);
});

test('cer is finer than wer for a single wrong letter', () => {
  assert.ok(cer('پروژه', 'پروزه') < wer('پروژه', 'پروزه'));
});

test('entityInText accepts normalized and alternative forms', () => {
  assert.equal(entityInText('اسم پروژه طرح فروش بهاره است', 'طرح فروش بهاره'), true);
  assert.equal(entityInText('۱۲ آبان ۱۴۰۵', '12 آبان 1405'), true);
  assert.equal(entityInText('دو میلیون و پانصد هزار', ['2500000', 'دو میلیون و پانصد هزار']), true);
  assert.equal(entityInText('چیز دیگر', ['2500000']), false);
  assert.equal(entityInText('هر چیزی', ''), false);
});

test('median ignores non-numbers and handles even and empty lists', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([null, Number.NaN, 5]), 5);
  assert.equal(median([]), null);
});
