import { describe, expect, it } from 'vitest';
import {
  formatCritiqueResponses,
  groundCritique,
  normalizeForQuote,
  quoteIsGrounded,
  unanswered,
  type CritiqueFinding,
  type CritiqueMaterial,
} from './critique.js';

const material: CritiqueMaterial = {
  title: 'برنامهٔ وفاداری مشتریان',
  summary: 'راه‌اندازی باشگاه مشتریان با امتیاز خرید.',
  assumptions: ['مشتریان فعلی حاضر به ثبت‌نام هستند', 'هزینهٔ جذب مشتری جدید ثابت می‌ماند'],
  evidence: ['بررسی سال گذشته نشان داد ۴۰٪ مشتریان بازمی‌گردند'],
  plan: ['ماه اول: طراحی؛ ماه دوم: راه‌اندازی'],
  risks: ['کاهش حاشیهٔ سود'],
  criteria: ['هزینه و منابع'],
};
const finding = (over: Partial<CritiqueFinding> = {}): CritiqueFinding => ({
  lens: 'assumption',
  title: 'ثبت‌نام فرض شده',
  claim: 'اگر مشتریان ثبت‌نام نکنند طرح بی‌اثر است.',
  basis: [{ kind: 'assumption', quote: 'حاضر به ثبت‌نام هستند' }],
  earlySign: 'نرخ ثبت‌نام در دو هفتهٔ اول زیر ۱۰٪',
  control: 'آزمایش با گروه کوچک',
  severity: 'high',
  ...over,
});

describe('quote grounding', () => {
  it('finds a quote in the right part of the solution, ignoring Arabic letters, spacing and half-spaces', () => {
    expect(quoteIsGrounded({ kind: 'assumption', quote: 'مشتريان  فعلي' }, material)).toBe(true);
    expect(quoteIsGrounded({ kind: 'plan', quote: 'ماه اول: طراحی' }, material)).toBe(true);
    expect(normalizeForQuote('می‌شود  ك')).toBe('می شود ک');
  });
  it('rejects a quote the solution does not contain, one in the wrong part, and a tiny one', () => {
    expect(
      quoteIsGrounded({ kind: 'assumption', quote: 'رقبا قیمت را کم می‌کنند' }, material),
    ).toBe(false);
    expect(quoteIsGrounded({ kind: 'risk', quote: 'حاضر به ثبت‌نام هستند' }, material)).toBe(false);
    expect(quoteIsGrounded({ kind: 'assumption', quote: 'مش' }, material)).toBe(false);
  });
});

describe('groundCritique', () => {
  it('keeps the grounded quotes of a finding and drops a finding with none', () => {
    const result = groundCritique(
      [
        finding({
          basis: [
            { kind: 'assumption', quote: 'حاضر به ثبت‌نام هستند' },
            { kind: 'assumption', quote: 'چیزی که در طرح نیست' },
          ],
        }),
        finding({
          title: 'ساختگی',
          basis: [{ kind: 'risk', quote: 'خطر کاملاً ساختگی و بی‌پایه' }],
        }),
      ],
      material,
    );
    expect(result.dropped).toBe(1);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.basis).toEqual([
      { kind: 'assumption', quote: 'حاضر به ثبت‌نام هستند' },
    ]);
  });
  it('has no quota: a solution with nothing to criticise gives an empty list', () => {
    expect(groundCritique([], material)).toEqual({ findings: [], dropped: 0 });
  });
  it('orders by severity, then lens', () => {
    const base = { basis: [{ kind: 'summary' as const, quote: 'باشگاه مشتریان' }] };
    const ordered = groundCritique(
      [
        finding({ ...base, title: 'c', severity: 'low' }),
        finding({ ...base, title: 'b', severity: 'critical', lens: 'evidence' }),
        finding({ ...base, title: 'a', severity: 'critical', lens: 'premortem' }),
      ],
      material,
    );
    expect(ordered.findings.map((f) => f.title)).toEqual(['a', 'b', 'c']);
  });
});

describe('answers', () => {
  it('requires an answer, and a reason unless accepted, for high and critical findings only', () => {
    const findings = [
      { title: 'a', severity: 'critical' as const },
      { title: 'b', severity: 'high' as const },
      { title: 'c', severity: 'low' as const },
    ];
    expect(unanswered(findings, {})).toEqual(['a', 'b']);
    expect(
      unanswered(findings, {
        a: { answer: 'accept', reason: '' },
        b: { answer: 'reject', reason: 'x' },
      }),
    ).toEqual(['b']);
    expect(
      unanswered(findings, {
        a: { answer: 'mitigate', reason: 'آزمایش کوچک' },
        b: { answer: 'reject', reason: 'شاهد مخالف داریم' },
      }),
    ).toEqual([]);
  });
  it('writes the manager’s own words, cut to the journal limit', () => {
    const text = formatCritiqueResponses(
      [
        {
          title: 'ثبت‌نام فرض شده',
          severity: 'high',
          answer: 'mitigate',
          reason: 'آزمایش با گروه کوچک',
        },
      ],
      'fa',
      1000,
    );
    expect(text).toBe('پاسخ به نقد:\n- ثبت‌نام فرض شده (high): کاهش می‌دهیم — آزمایش با گروه کوچک');
    expect(
      formatCritiqueResponses(
        [{ title: 't', severity: 'low', answer: 'accept', reason: 'x'.repeat(500) }],
        'en',
        80,
      ),
    ).toHaveLength(80);
    expect(formatCritiqueResponses([], 'en', 100)).toBe('');
  });
});
