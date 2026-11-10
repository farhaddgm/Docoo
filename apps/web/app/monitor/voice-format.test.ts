import { describe, expect, it } from 'vitest';

import {
  barPercent,
  fill,
  formatClock,
  formatCount,
  formatDollars,
  formatMinutes,
  providerName,
} from './voice-format';

describe('the voice monitor numbers', () => {
  it('names the providers, and an unknown one as it is', () => {
    expect(providerName('openai')).toBe('OpenAI');
    expect(providerName('gemini')).toBe('Google Gemini');
    expect(providerName('acme')).toBe('Acme');
  });

  it('writes counts with separators in the digits of the language', () => {
    expect(formatCount('en', 12_345.4)).toBe('12,345');
    expect(formatCount('fa', 1800)).toBe('۱٬۸۰۰');
    expect(formatCount('en', 0)).toBe('0');
  });

  it('writes dollars with more decimals for a tiny amount, so it is never shown as zero', () => {
    expect(formatDollars('en', 0.6)).toBe('$0.60');
    expect(formatDollars('en', 12.5)).toBe('$12.50');
    expect(formatDollars('en', 0.0123)).toBe('$0.0123');
    expect(formatDollars('en', 0)).toBe('$0.00');
    expect(formatDollars('fa', 0.6)).toContain('۰٫۶۰');
  });

  it('writes minutes, and hours with the rest', () => {
    expect(formatMinutes('en', 7.4)).toBe('7 min');
    expect(formatMinutes('en', 65)).toBe('1 h 5 min');
    expect(formatMinutes('en', 120)).toBe('2 h');
    expect(formatMinutes('fa', 10)).toBe('۱۰ دقیقه');
    expect(formatMinutes('fa', 90)).toBe('۱ ساعت ۳۰ دقیقه');
    expect(formatMinutes('en', -3)).toBe('0 min');
  });

  it('writes a clock time, and nothing for a bad instant', () => {
    expect(formatClock('en', 'not a date')).toBe('');
    expect(formatClock('en', '2026-11-09T12:34:00Z')).toMatch(/\d{2}:\d{2}/u);
  });

  it('keeps a bar inside its frame while the text can say more than a hundred', () => {
    expect(barPercent(35)).toBe(35);
    expect(barPercent(250)).toBe(100);
    expect(barPercent(-5)).toBe(0);
    expect(barPercent(null)).toBe(0);
  });

  it('fills placeholders and leaves unknown ones', () => {
    expect(fill('{n} min {x}', { n: '5' })).toBe('5 min {x}');
  });
});
