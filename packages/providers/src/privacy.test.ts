import { describe, expect, it } from 'vitest';

import {
  applyPrivacy,
  findPrivateValues,
  isValidIranIban,
  isValidLuhn,
  isValidNationalId,
  parsePrivacyPolicy,
  ProviderError,
  type NormalizedModelRequest,
  type NormalizedModelResponse,
  type PrivacyPolicy,
} from './index.js';

const mask: PrivacyPolicy = { mode: 'mask', blockedWords: [] };

/** A valid Iranian IBAN built from 22 body digits. */
function makeIban(body: string): string {
  const base = `${body}1827`;
  let remainder = 0;
  for (const digit of `${base}00`) remainder = (remainder * 10 + Number(digit)) % 97;
  const check = String(98 - remainder).padStart(2, '0');
  return `IR${check}${body}`;
}

const request = (content: string, extra: Partial<NormalizedModelRequest> = {}) =>
  ({ model: 'm', messages: [{ role: 'user', content }], ...extra });

const response = (over: Partial<NormalizedModelResponse>): NormalizedModelResponse => ({
  provider: 'fake',
  model: 'm',
  text: '',
  json: null,
  toolCalls: [],
  finishReason: 'stop',
  rawFinishReason: null,
  usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: null, cachedInputTokens: null },
  providerRequestId: null,
  latencyMs: 1,
  ...over,
});

const kinds = (text: string, words: string[] = []) =>
  findPrivateValues(text, words).map((span) => span.kind);

describe('validators', () => {
  it('checks the national id control digit', () => {
    expect(isValidNationalId('0013542419')).toBe(true);
    expect(isValidNationalId('0013542418')).toBe(false);
    expect(isValidNationalId('1111111111')).toBe(false);
    expect(isValidNationalId('123')).toBe(false);
  });

  it('checks Luhn and IBAN', () => {
    expect(isValidLuhn('4111111111111111')).toBe(true);
    expect(isValidLuhn('4111111111111112')).toBe(false);
    const iban = makeIban('0170000000123456789012'.slice(0, 22));
    expect(isValidIranIban(iban)).toBe(true);
    expect(isValidIranIban(`${iban.slice(0, -1)}0`)).toBe(false);
  });
});

describe('detection', () => {
  it('finds each kind', () => {
    expect(kinds('write to ali.reza@example.com')).toEqual(['EMAIL']);
    expect(kinds('call 09121234567')).toEqual(['PHONE']);
    expect(kinds('call +98 912 123 4567')).toEqual(['PHONE']);
    expect(kinds('office 021-12345678')).toEqual(['PHONE']);
    expect(kinds('id 0013542419')).toEqual(['NATIONAL_ID']);
    expect(kinds('card 4111 1111 1111 1111')).toEqual(['CARD']);
    expect(kinds(`sheba ${makeIban('0170000000123456789012')}`)).toEqual(['IBAN']);
  });

  it('reads Persian and Arabic digits', () => {
    expect(kinds('شمارهٔ من ۰۹۱۲۱۲۳۴۵۶۷ است')).toEqual(['PHONE']);
    expect(kinds('کد ملی ٠٠١٣٥٤٢٤١٩')).toEqual(['NATIONAL_ID']);
    expect(kinds('کارت ۴۱۱۱-۱۱۱۱-۱۱۱۱-۱۱۱۱')).toEqual(['CARD']);
  });

  it('leaves look-alikes alone', () => {
    expect(kinds('order 0013542418 shipped')).toEqual([]); // bad control digit
    expect(kinds('number 4111111111111112')).toEqual([]); // bad Luhn
    expect(kinds('year 2026-09-24, total 1,250,000')).toEqual([]);
    expect(kinds('version 1.2.3 at host@')).toEqual([]);
    expect(kinds('')).toEqual([]);
  });

  it('does not report a number twice', () => {
    // A 16-digit card is not also read as a national id, and an email is one span.
    expect(kinds('4111111111111111')).toEqual(['CARD']);
    expect(kinds('a09121234567@x.com')).toEqual(['EMAIL']);
  });

  it('hides blocked words in any case and with Arabic letters', () => {
    expect(kinds('شرکت علی با ACME', ['acme'])).toEqual(['TERM']);
    expect(kinds('کتاب', ['كتاب'])).toEqual(['TERM']);
  });
});

describe('applyPrivacy', () => {
  it('masks with stable placeholders and restores the answer', () => {
    const text = 'Mail ali@example.com or 09121234567; again ali@example.com. ID 0013542419.';
    const out = applyPrivacy(request(text), mask);
    const sent = out.request.messages[0]!.content;
    expect(sent).toBe('Mail ‹EMAIL_1› or ‹PHONE_1›; again ‹EMAIL_1›. ID ‹NATIONAL_ID_1›.');
    expect(sent).not.toContain('example.com');
    expect(out.report).toEqual({ total: 4, byKind: { EMAIL: 2, PHONE: 1, NATIONAL_ID: 1 } });
    expect(out.request.instructions).toContain('placeholders');

    const answered = out.restore(response({ text: 'Send to ‹EMAIL_1› and ‹PHONE_1}' }));
    expect(answered.text).toBe('Send to ali@example.com and ‹PHONE_1}');
    expect(out.restore(response({ text: '‹NATIONAL_ID_1›' })).text).toBe('0013542419');
  });

  it('keeps a value as it was written, in Persian digits too', () => {
    const out = applyPrivacy(request('تماس: ۰۹۱۲۱۲۳۴۵۶۷'), mask);
    expect(out.restore(response({ text: '‹PHONE_1›' })).text).toBe('۰۹۱۲۱۲۳۴۵۶۷');
  });

  it('masks instructions, tool results and tool-call arguments', () => {
    const out = applyPrivacy(
      {
        model: 'm',
        instructions: 'Client is Acme Corp.',
        messages: [
          {
            role: 'assistant',
            content: 'ok',
            toolCalls: [{ id: '1', name: 't', arguments: { who: 'ali@example.com', n: 3 } }],
          },
          { role: 'tool', toolCallId: '1', toolName: 't', content: 'reply to ali@example.com' },
        ],
      },
      { mode: 'mask', blockedWords: ['Acme Corp'] },
    );
    expect(out.request.instructions).toContain('Client is ‹TERM_1›.');
    const [assistant, tool] = out.request.messages as unknown as [
      { toolCalls: { arguments: { who: string; n: number } }[] },
      { content: string },
    ];
    expect(assistant.toolCalls[0]!.arguments).toEqual({ who: '‹EMAIL_1›', n: 3 });
    expect(tool.content).toBe('reply to ‹EMAIL_1›');
  });

  it('restores parsed JSON and tool calls of the response', () => {
    const out = applyPrivacy(request('ali@example.com'), mask);
    const back = out.restore(
      response({
        json: { to: ['‹EMAIL_1›'], keep: 1 },
        toolCalls: [{ id: 'c', name: 'send', arguments: { to: '‹EMAIL_1›' } }],
      }),
    );
    expect(back.json).toEqual({ to: ['ali@example.com'], keep: 1 });
    expect(back.toolCalls[0]!.arguments).toEqual({ to: 'ali@example.com' });
  });

  it('keeps JSON text valid when a restored word needs escaping', () => {
    const out = applyPrivacy(
      request('Client: Say "Hi" Ltd', { responseSchema: { name: 's', schema: {} } }),
      {
        mode: 'mask',
        blockedWords: ['Say "Hi" Ltd'],
      },
    );
    const back = out.restore(response({ text: '{"client":"‹TERM_1›"}' }));
    expect(JSON.parse(back.text)).toEqual({ client: 'Say "Hi" Ltd' });
  });

  it('does not touch a request without private values or with the layer off', () => {
    const plain = request('nothing private here');
    expect(applyPrivacy(plain, mask).request).toBe(plain);
    const off = applyPrivacy(request('ali@example.com'), { mode: 'off', blockedWords: [] });
    expect(off.request.messages[0]!.content).toBe('ali@example.com');
    expect(off.report.total).toBe(0);
  });

  it('refuses to send in block mode and never puts the value in the error', () => {
    let caught: unknown;
    try {
      applyPrivacy(request('ali@example.com 09121234567'), { mode: 'block', blockedWords: [] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const error = caught as ProviderError;
    expect(error.code).toBe('privacy_blocked');
    expect(error.retryable).toBe(false);
    expect(error.detail).toBe('EMAIL:1,PHONE:1');
    expect(JSON.stringify(error)).not.toContain('example.com');
  });

  it('lets a clean request through in block mode', () => {
    const plain = request('clean');
    expect(applyPrivacy(plain, { mode: 'block', blockedWords: [] }).request).toBe(plain);
  });
});

describe('parsePrivacyPolicy', () => {
  it('falls back to mask for unknown input', () => {
    expect(parsePrivacyPolicy('weird', null)).toEqual({ mode: 'mask', blockedWords: [] });
    expect(parsePrivacyPolicy('block', ['a', ' ', 3])).toEqual({
      mode: 'block',
      blockedWords: ['a'],
    });
  });
});
