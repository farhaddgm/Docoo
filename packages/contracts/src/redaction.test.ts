import { describe, expect, it } from 'vitest';

import { MASK, MAX_REDACT_LENGTH, redactText, type RedactionOptions } from './redaction.js';

const standard: RedactionOptions = { level: 'standard', blockedWords: [] };
const strict: RedactionOptions = { level: 'strict', blockedWords: [] };
const std = (text: string) => redactText(text, standard);
const str = (text: string) => redactText(text, strict);

describe('standard masking', () => {
  it('hides email addresses, whatever the script around them', () => {
    expect(std('write to ali.rezaei+x@example.co.uk now')).toBe(`write to ${MASK} now`);
    expect(std('ایمیل: info@شرکت.com')).toBe(`ایمیل: ${MASK}`);
  });

  it('hides phone numbers in Latin, Persian and Arabic-Indic digits', () => {
    expect(std('call +98 912 345 6789')).toBe(`call ${MASK}`);
    expect(std('تلفن ۰۹۱۲۳۴۵۶۷۸۹ است')).toBe(`تلفن ${MASK} است`);
    expect(std('tel (021) 8888-1234')).toBe(`tel ${MASK}`);
    expect(std('٠٩١٢٣٤٥٦٧٨٩')).toBe(MASK);
  });

  it('does not take a date or a short number for a phone number', () => {
    expect(std('on 2026-11-09 we met')).toBe('on 2026-11-09 we met');
    expect(std('۱۴۰۵/۰۸/۱۸ جلسه')).toBe('۱۴۰۵/۰۸/۱۸ جلسه');
    expect(std('3 projects, 12 stages, 1500 words')).toBe('3 projects, 12 stages, 1500 words');
  });

  it('hides IP addresses and addresses of machines inside the network', () => {
    expect(std('server at 10.0.12.7 is down')).toBe(`server at ${MASK} is down`);
    expect(std('http://localhost:3000/admin and http://192.168.1.5/x')).toBe(`${MASK} and ${MASK}`);
    expect(std('see db.internal:5432 or api.corp')).toBe(`see ${MASK} or ${MASK}`);
    expect(std('fe80::1ff:fe23:4567:890a')).toBe(MASK);
    expect(std('localhost:4000')).toBe(MASK);
  });

  it('hides paths inside a machine', () => {
    expect(std('file /home/user/Docoo/.env here')).toBe(`file ${MASK} here`);
    expect(std('C:\\Users\\Ali\\keys.txt')).toBe(MASK);
    expect(std('open ~/secrets/a.txt')).toBe(`open ${MASK}`);
    expect(std('and/or the 1/2 cases')).toBe('and/or the 1/2 cases');
  });

  it('hides keys and tokens of well-known shapes', () => {
    expect(std('key sk-proj-abcdefghijklmnop1234')).toBe(`key ${MASK}`);
    expect(std('ghp_abcdefghijklmnopqrstuv')).toBe(MASK);
    expect(std('AKIAABCDEFGHIJKLMNOP')).toBe(MASK);
    expect(std('Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123')).toBe(
      `Authorization: ${MASK}`,
    );
    expect(std('jwt eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2QT4')).toBe(`jwt ${MASK}`);
  });

  it('hides a long mixed token or hex string, but not a long plain word', () => {
    expect(std('token a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8')).toBe(`token ${MASK}`);
    expect(std('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe(MASK);
    const word = 'internationalization'.repeat(3);
    expect(std(word)).toBe(word);
  });

  it('hides technical ids', () => {
    expect(std('project 810b1170-629e-4718-b880-5cb0b81d6f32 ready')).toBe(`project ${MASK} ready`);
  });

  it('leaves ordinary text, web addresses and amounts alone', () => {
    const text = 'Report ready: see https://example.com/report, cost $12,500 for 3 stages.';
    expect(std(text)).toBe(text);
  });
});

describe('strict masking', () => {
  it('also hides every web address', () => {
    expect(str('see https://example.com/a?b=1 and www.example.org/x.')).toBe(
      `see ${MASK} and ${MASK}.`,
    );
  });

  it('also hides amounts of money in any script', () => {
    expect(str('cost $12.50 or €3 or 40 USD')).toBe(`cost ${MASK} or ${MASK} or ${MASK}`);
    expect(str('۱۲ میلیون تومان و 500 دلار')).toBe(`${MASK} و ${MASK}`);
  });

  it('also hides long numbers, thousands separators included', () => {
    expect(str('total 12,500 items')).toBe(`total ${MASK} items`);
    expect(str('۱۲۳۴۵۶ مورد')).toBe(`${MASK} مورد`);
    expect(str('1234 and 12 stay')).toBe('1234 and 12 stay');
  });

  it('keeps everything the standard level hides hidden', () => {
    expect(str('a@b.co 10.0.0.1')).toBe(`${MASK} ${MASK}`);
  });
});

describe('blocked words', () => {
  const words = (list: string[], level: 'standard' | 'strict' = 'standard') => ({
    level,
    blockedWords: list,
  });

  it('are hidden wherever they appear, ignoring case', () => {
    expect(redactText('Acme and ACME and acmeCorp', words(['Acme']))).toBe(
      `${MASK} and ${MASK} and ${MASK}Corp`,
    );
  });

  it('treat the Arabic and Persian forms of yeh and kaf alike', () => {
    expect(redactText('شرکت کاربری', words(['كاربري']))).toBe(`شرکت ${MASK}`);
    expect(redactText('شركت علي', words(['علی']))).toBe(`شركت ${MASK}`);
  });

  it('hide every occurrence, overlapping words and repeats included', () => {
    expect(redactText('Beta Corp Beta', words(['Beta', 'Beta Corp']))).toBe(`${MASK} ${MASK}`);
    expect(redactText('aaaa', words(['aa']))).toBe(MASK);
    expect(redactText('xx Acme Acme xx', words(['acme']))).toBe(`xx ${MASK} ${MASK} xx`);
  });

  it('hide an address that holds a blocked word as a whole, not only the word', () => {
    expect(redactText('mail ali@acme.com', words(['acme']))).toBe(`mail ${MASK}`);
  });

  it('ignore empty entries and take words with regular-expression characters literally', () => {
    expect(redactText('plain text', words(['', '   ']))).toBe('plain text');
    expect(redactText('cost (a+b)* here', words(['(a+b)*']))).toBe(`cost ${MASK} here`);
  });

  it('work together with the level', () => {
    expect(redactText('Acme paid $500', words(['Acme'], 'strict'))).toBe(`${MASK} paid ${MASK}`);
  });

  it('give back the text as it was when nothing matches', () => {
    expect(redactText('nothing here', words(['Acme']))).toBe('nothing here');
    expect(redactText('', words(['Acme']))).toBe('');
  });
});

describe('cost of masking', () => {
  it('cuts a text past the limit before masking, so it can never make the screen slow', () => {
    const long = 'a1'.repeat(25_000);
    const started = performance.now();
    const out = std(long);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(out).toBe(`${MASK}…`);
    expect(redactText('x'.repeat(MAX_REDACT_LENGTH + 500), standard)).toBe(
      `${'x'.repeat(MAX_REDACT_LENGTH)}…`,
    );
  });

  it('is quick on the longest text it accepts, whatever the shape', () => {
    for (const piece of ['word ', '1 ', 'a1', '1.', '@', 'a@', '/', ':']) {
      const text = piece.repeat(Math.ceil(MAX_REDACT_LENGTH / piece.length));
      const started = performance.now();
      str(text);
      expect(performance.now() - started, piece).toBeLessThan(1500);
    }
  });
});
