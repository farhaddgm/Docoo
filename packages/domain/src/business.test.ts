import { describe, expect, it } from 'vitest';

import {
  BUSINESS_CONTENT_MAX_CHARS,
  BUSINESS_EXPORT_SCHEMA_VERSION,
  BUSINESS_PROMPT_MAX_CHARS,
  BUSINESS_PROMPT_MIN_CHARS,
  BUSINESS_ROLE_SECTIONS,
  BUSINESS_SECTIONS,
  businessPrompt,
  canonicalBusinessJson,
  checkTerms,
  clampBusinessBudget,
  diffBusinessContent,
  isFactExpired,
  normalizeBusinessExport,
  normalizeTermText,
  type BusinessContent,
} from './business.js';

const exportOf = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  exportedAt: '2026-10-05T08:00:00.000Z',
  business: {
    id: 'biz-1',
    name: 'ویپاد',
    tagline: 'پرداخت آسان',
    industry: 'فین‌تک',
    website: 'https://example.com',
    location: 'تهران',
    language: 'fa',
    status: 'ACTIVE',
    updatedAt: '2026-10-03T08:00:00.000Z',
    gaps: ['نرخ کارمزد تأیید نشد'],
    sources: [{ url: 'https://example.com/a', title: 'A' }, { nope: 1 }],
  },
  sections: [
    {
      key: 'OVERVIEW',
      content: 'ویپاد شعبهٔ دیجیتال است.',
      source: 'ADMIN',
      reviewedAt: '2026-10-01T00:00:00.000Z',
    },
    { key: 'SERVICES', content: 'وام و کارت', source: 'AI', reviewedAt: null },
    { key: 'PERSONAS', content: 'کارمند ۳۰ ساله', source: 'ADMIN' },
    { key: 'BRAND_VOICE', content: 'صمیمی و روشن', source: 'ADMIN' },
    { key: 'GUIDELINES', content: 'ادعای سود قطعی ممنوع.', source: 'ADMIN' },
    { key: 'FUTURE_SECTION', content: 'بخش تازه', source: 'AI' },
  ],
  facts: [
    {
      label: 'سقف تسهیلات',
      value: '۵۰۰ میلیون تومان',
      category: 'PRICING',
      verified: true,
      isActive: true,
    },
    {
      label: 'نرخ ویژه',
      value: '۱۸٪',
      category: 'PRICING',
      verified: false,
      validUntil: '2026-09-01',
      isActive: true,
    },
    { label: 'غیرفعال', value: 'x', isActive: false },
  ],
  terms: [
    { term: 'ویپاد', kind: 'USE', alternatives: ['وی پاد', 'WePod'], isActive: true },
    { term: 'بانک ویپاد', kind: 'AVOID', alternatives: ['شعبهٔ دیجیتال'], isActive: true },
  ],
  notes: [
    {
      text: 'همیشه خطاب را محترمانه بنویس.',
      status: 'APPLIED',
      isActive: true,
      createdAt: '2026-10-02',
    },
    { text: 'هنوز اعمال نشده', status: 'PENDING', isActive: true, createdAt: '2026-10-02' },
  ],
  references: [
    {
      kind: 'URL',
      url: 'https://example.com/about',
      title: 'دربارهٔ ما',
      status: 'READY',
      contentChars: 5000,
      excerpt: 'متن',
    },
  ],
  assets: [
    {
      kind: 'BANNER',
      title: 'بنر',
      analysis: { summary: 'گرم', tones: ['صمیمی', 'روشن'], nested: { x: 1 } },
      analysisStatus: 'READY',
    },
  ],
  audit: {
    score: 71,
    summary: 'نسبتاً کامل',
    strengths: ['لحن روشن'],
    issues: [
      { severity: 'HIGH', status: 'OPEN', type: 'MISSING', target: 'PERSONAS', title: 'پرسونا' },
    ],
  },
  health: {
    score: 42,
    filled: 5,
    total: 15,
    checks: [
      { id: 'CORE_SECTIONS', level: 'todo', count: 2, keys: ['TARGET_MARKET'] },
      { id: 'X', level: 'weird', count: 1 },
    ],
  },
  pendingSuggestions: 2,
  topics: [{ id: 't1', title: 'کمپین', status: 'ACTIVE' }],
  ...overrides,
});

function content(overrides: Record<string, unknown> = {}): BusinessContent {
  const result = normalizeBusinessExport(exportOf(overrides));
  if (!result.ok) throw new Error(result.problem);
  return result.content;
}

describe('normalizing a Contenter export', () => {
  it('keeps what it understands, bounded, and lists every known section in order', () => {
    const c = content();
    expect(c.business).toMatchObject({ externalId: 'biz-1', name: 'ویپاد', language: 'fa' });
    expect(c.business.sources).toEqual([{ url: 'https://example.com/a', title: 'A' }]);
    expect(c.sections.slice(0, BUSINESS_SECTIONS.length).map((s) => s.key)).toEqual(
      BUSINESS_SECTIONS.map((s) => s.key),
    );
    expect(c.sections.find((s) => s.key === 'FAQ')).toMatchObject({
      content: '',
      source: 'ADMIN',
      reviewedAt: null,
    });
    // a section Contenter adds later is kept after the known ones
    expect(c.sections.at(-1)).toMatchObject({ key: 'FUTURE_SECTION', source: 'AI' });
    expect(c.facts).toHaveLength(3);
    expect(c.terms[1]).toMatchObject({ kind: 'AVOID' });
    expect(c.assets[0]!.analysis).toEqual({ summary: 'گرم', tones: ['صمیمی', 'روشن'] });
    expect(c.health!.checks[1]).toMatchObject({ id: 'X', level: 'ok' });
    expect(c.audit!.issues[0]).toMatchObject({ severity: 'HIGH', target: 'PERSONAS' });
  });

  it('refuses what it cannot read and a breaking newer schema', () => {
    expect(normalizeBusinessExport(null)).toEqual({ ok: false, problem: 'not_an_object' });
    expect(normalizeBusinessExport([])).toEqual({ ok: false, problem: 'not_an_object' });
    expect(
      normalizeBusinessExport(exportOf({ schemaVersion: BUSINESS_EXPORT_SCHEMA_VERSION + 1 })),
    ).toEqual({
      ok: false,
      problem: 'unsupported_schema',
    });
    expect(normalizeBusinessExport(exportOf({ schemaVersion: undefined }))).toEqual({
      ok: false,
      problem: 'unsupported_schema',
    });
    expect(normalizeBusinessExport(exportOf({ business: { name: 'x' } }))).toEqual({
      ok: false,
      problem: 'business_missing',
    });
  });

  it('cuts long text and refuses a snapshot that is too large', () => {
    const long = 'ا'.repeat(100_000);
    const c = content({ sections: [{ key: 'OVERVIEW', content: long, source: 'ADMIN' }] });
    expect(c.sections[0]!.content).toHaveLength(30_000);
    const huge = Array.from({ length: 300 }, (_, index) => ({
      label: `f${index}`,
      value: 'ا'.repeat(2000),
    }));
    const sections = Array.from({ length: 100 }, (_, index) => ({
      key: `S${index}`,
      content: 'ا'.repeat(30_000),
      source: 'ADMIN',
    }));
    expect(normalizeBusinessExport(exportOf({ facts: huge, sections }))).toEqual({
      ok: false,
      problem: 'too_large',
    });
    expect(BUSINESS_CONTENT_MAX_CHARS).toBeGreaterThan(0);
  });

  it('gives the same canonical text for the same content whatever the key order', () => {
    expect(canonicalBusinessJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      canonicalBusinessJson({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
    expect(canonicalBusinessJson(content())).toBe(canonicalBusinessJson(content()));
  });
});

describe('what each agent receives', () => {
  const now = new Date('2026-10-05T10:00:00.000Z');

  it('gives each role only its own sections, in Contenter order, and nothing to the Brain', () => {
    const analyst = businessPrompt(content(), { role: 'analyst', now })!;
    expect(analyst.data.sections.map((s) => s.key)).toEqual([
      'OVERVIEW',
      'SERVICES',
      'PERSONAS',
      'GUIDELINES',
    ]);
    const documenter = businessPrompt(content(), { role: 'documenter', now })!;
    expect(documenter.data.sections.map((s) => s.key)).toEqual([
      'OVERVIEW',
      'SERVICES',
      'PERSONAS',
      'BRAND_VOICE',
      'GUIDELINES',
    ]);
    expect(businessPrompt(content(), { role: 'brain', now })).toBeNull();
    expect(BUSINESS_ROLE_SECTIONS.brain).toEqual([]);
  });

  it('marks AI drafts as unconfirmed and leaves out expired and inactive facts', () => {
    const prompt = businessPrompt(content(), { role: 'analyst', now })!;
    expect(prompt.data.sections.find((s) => s.key === 'OVERVIEW')!.confirmed).toBe(true);
    expect(prompt.data.sections.find((s) => s.key === 'SERVICES')!.confirmed).toBe(false);
    expect(prompt.data.keyFacts.map((f) => f.label)).toEqual(['سقف تسهیلات']);
    expect(prompt.rules.join(' ')).toContain('Never state a price');
  });

  it('gives terminology only to the writer and standing notes only when applied', () => {
    expect(businessPrompt(content(), { role: 'analyst', now })!.data.terminology).toBeUndefined();
    const writer = businessPrompt(content(), { role: 'documenter', now })!;
    expect(writer.data.terminology).toEqual([
      { term: 'ویپاد', rule: 'always write exactly', alternatives: ['وی پاد', 'WePod'] },
      { term: 'بانک ویپاد', rule: 'never write', alternatives: ['شعبهٔ دیجیتال'] },
    ]);
    expect(writer.data.adminNotes).toEqual(['همیشه خطاب را محترمانه بنویس.']);
  });

  it('keeps inside the budget, cuts long sections and lists what did not fit', () => {
    const long = 'الف '.repeat(5000);
    const c = content({
      sections: BUSINESS_SECTIONS.map((s) => ({ key: s.key, content: long, source: 'ADMIN' })),
    });
    const prompt = businessPrompt(c, { role: 'documenter', budgetChars: 8000, now })!;
    expect(prompt.summary.sections.every((s) => s.chars <= 6000)).toBe(true);
    expect(prompt.summary.sections[0]).toMatchObject({ key: 'OVERVIEW', truncated: true });
    expect(prompt.summary.omitted.length).toBeGreaterThan(0);
    expect(prompt.data.notIncluded).toEqual(prompt.summary.omitted);
    // the text of the sections stays within the budget (the rest of the data is small)
    expect(prompt.summary.sections.reduce((sum, s) => sum + s.chars, 0)).toBeLessThanOrEqual(8000);
    expect(prompt.summary.chars).toBe(JSON.stringify(prompt.data).length);
  });

  it('is the same for the same inputs and null when there is nothing for the role', () => {
    expect(businessPrompt(content(), { role: 'ideator', now })).toEqual(
      businessPrompt(content(), { role: 'ideator', now }),
    );
    const empty = content({ sections: [], facts: [], terms: [], notes: [] });
    expect(businessPrompt(empty, { role: 'analyst', now })).toBeNull();
  });

  it('clamps the budget to a sane range', () => {
    expect(clampBusinessBudget(10)).toBe(BUSINESS_PROMPT_MIN_CHARS);
    expect(clampBusinessBudget(10_000_000)).toBe(BUSINESS_PROMPT_MAX_CHARS);
    expect(clampBusinessBudget('abc')).toBe(12_000);
    expect(clampBusinessBudget(15_000.4)).toBe(15_000);
  });
});

describe('fact validity', () => {
  it('is compared by day, and a fact without a date never expires', () => {
    const now = new Date('2026-10-05T23:30:00.000Z');
    expect(isFactExpired('2026-10-05', now)).toBe(false);
    expect(isFactExpired('2026-10-04T23:59:00.000Z', now)).toBe(true);
    expect(isFactExpired(null, now)).toBe(false);
    expect(isFactExpired('not a date', now)).toBe(false);
  });
});

describe('brand terminology check', () => {
  const terms = content().terms;

  it('finds wrong spellings and forbidden words, whatever the letters or spacing', () => {
    const issues = checkTerms('اپ «وی‌پاد» و WEPOD و وي پاد عالی است. بانک ویپاد هم هست.', terms);
    expect(issues.map((i) => [i.kind, i.found, i.count])).toEqual([
      ['USE', 'وی پاد', 2],
      ['USE', 'WePod', 1],
      ['AVOID', 'بانک ویپاد', 1],
    ]);
    expect(issues[0]!.replaceWith).toEqual(['ویپاد']);
  });

  it('finds nothing in clean text, matches whole words only and ignores inactive terms', () => {
    expect(checkTerms('ویپاد شعبهٔ دیجیتال است', terms)).toEqual([]);
    expect(checkTerms('سویی پادشاه', terms)).toEqual([]);
    expect(checkTerms('', terms)).toEqual([]);
    expect(
      checkTerms(
        'وی پاد',
        terms.map((t) => ({ ...t, isActive: false })),
      ),
    ).toEqual([]);
  });

  it('normalizes Arabic letters, diacritics and spaces', () => {
    expect(normalizeTermText('وَي‌پاد')).toBe(normalizeTermText('وی پاد'));
    expect(normalizeTermText('  کك  ')).toBe('کک');
  });
});

describe('differences between two snapshots', () => {
  it('names the sections that changed and what else differs', () => {
    const before = content();
    const after = content({
      sections: [
        {
          key: 'OVERVIEW',
          content: 'متن تازه',
          source: 'ADMIN',
          reviewedAt: '2026-10-01T00:00:00.000Z',
        },
        { key: 'SERVICES', content: 'وام و کارت', source: 'AI', reviewedAt: null },
      ],
      terms: [],
    });
    const diff = diffBusinessContent(before, after);
    expect(diff.sections).toEqual(
      expect.arrayContaining(['OVERVIEW', 'PERSONAS', 'BRAND_VOICE', 'GUIDELINES']),
    );
    expect(diff.sections).not.toContain('SERVICES');
    expect(diff).toMatchObject({ terms: true, facts: false, notes: false });
    const first = diffBusinessContent(null, before);
    expect(first.sections).toContain('OVERVIEW');
    expect(first.details).toBe(true);
    expect(diffBusinessContent(before, before)).toMatchObject({
      sections: [],
      facts: false,
      terms: false,
      notes: false,
      details: false,
    });
  });
});
