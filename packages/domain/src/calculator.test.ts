import { describe, expect, it } from 'vitest';

import { CALCULATOR_LIMITS, evaluateExpression, formatNumber } from './calculator.js';

const value = (text: string) => {
  const result = evaluateExpression(text);
  if (!result.ok) throw new Error(`${text}: ${result.error}`);
  return formatNumber(result.value);
};
const refused = (text: string) => {
  const result = evaluateExpression(text);
  return result.ok ? `ok:${result.value}` : result.error;
};

describe('calculator (ADR-0023)', () => {
  it('computes with the usual precedence and associativity', () => {
    expect(value('1 + 2 * 3')).toBe(7);
    expect(value('(1 + 2) * 3')).toBe(9);
    expect(value('10 - 4 - 3')).toBe(3);
    expect(value('100 / 5 / 4')).toBe(5);
    expect(value('2 ^ 3 ^ 2')).toBe(512);
    expect(value('-2 ^ 2')).toBe(-4);
    expect(value('2 ^ -1')).toBe(0.5);
    expect(value('7 % 4')).toBe(3);
    expect(value('--3')).toBe(3);
    expect(value('1.5e3 + .5')).toBe(1500.5);
  });

  it('has no 0.1 + 0.2 noise in what it reports', () => {
    expect(value('0.1 + 0.2')).toBe(0.3);
    expect(value('1200000 * 0.15')).toBe(180000);
  });

  it('knows a few functions and two constants', () => {
    expect(value('sqrt(144) + abs(-3)')).toBe(15);
    expect(value('round(2.6) + floor(2.9) + ceil(2.1)')).toBe(8);
    expect(value('max(3, 9, 4) - min(3, 9, 4)')).toBe(6);
    expect(value('pow(2, 10)')).toBe(1024);
    expect(value('ln(e)')).toBe(1);
    expect(value('log10(1000)')).toBe(3);
    expect(value('pi * 2')).toBeCloseTo(6.28318530718, 8);
    expect(value('SQRT(16)')).toBe(4);
  });

  it('reads Persian digits and symbols like the ASCII ones', () => {
    expect(value('۱۲ × ۳')).toBe(36);
    expect(value('۱٬۲۰۰ ÷ ۴')).toBe(300);
    expect(value('۲٫۵ + ۱')).toBe(3.5);
    expect(value('٣ − ١')).toBe(2);
  });

  it('refuses what is not arithmetic, with a reason', () => {
    expect(refused('')).toBe('empty');
    expect(refused('   ')).toBe('empty');
    expect(refused('1 +')).toBe('syntax');
    expect(refused('(1 + 2')).toBe('syntax');
    expect(refused('1 2')).toBe('syntax');
    expect(refused('1 / 0')).toBe('division_by_zero');
    expect(refused('5 % 0')).toBe('division_by_zero');
    expect(refused('foo + 1')).toBe('unknown_name');
    expect(refused('foo(1)')).toBe('unknown_name');
    expect(refused('sqrt(1, 2)')).toBe('wrong_arguments');
    expect(refused('sqrt(-1)')).toBe('out_of_range');
    expect(refused('ln(0)')).toBe('out_of_range');
    expect(refused('10 ^ 400')).toBe('out_of_range');
    expect(refused('1e16')).toBe('out_of_range');
    expect(refused('9'.repeat(CALCULATOR_LIMITS.maxLength + 1))).toBe('too_long');
    expect(refused('(('.repeat(60) + '1' + '))'.repeat(60))).toBe('too_deep');
  });

  it('cannot reach code: nothing but numbers, operators and the listed names parses', () => {
    for (const attack of [
      'process.exit()',
      'constructor.constructor("return 1")()',
      '1; 2',
      '`1`',
      '[1]',
      '{}',
      '"a" + 1',
      'x = 1',
      'require("fs")',
      'globalThis',
      '__proto__',
      'toString()',
      '1 /* c */ + 1',
    ]) {
      expect(refused(attack), attack).not.toMatch(/^ok:/u);
    }
  });
});
