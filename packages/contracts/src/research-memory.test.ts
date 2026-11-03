import { describe, expect, it } from 'vitest';

import {
  composeMemory,
  maxConfidentiality,
  memoryProvenance,
  pageHost,
  memoryEligibility,
  memoryFingerprintText,
  type MemoryFinding,
} from './research-memory.js';

const web = (url: string, over: Record<string, unknown> = {}) => ({
  ref: 'W1',
  url,
  title: 'A page',
  quote: 'The market reached 12500 units.',
  verified: true,
  ...over,
});
const finding = (over: Partial<MemoryFinding> = {}): MemoryFinding => ({
  claim: 'The market reached 12,500 units',
  level: 'solid',
  support: 'web',
  evidence: [web('https://a.test/x')],
  ...over,
});

describe('memoryEligibility (ADR-0053)', () => {
  it('lets a verified web finding through, with its pages', () => {
    const result = memoryEligibility(finding(), 2026);
    expect(result).toMatchObject({ ok: true, knowledgeIds: [], validUntil: null });
    expect(result.ok && result.pages).toEqual([
      { url: 'https://a.test/x', title: 'A page', quote: 'The market reached 12500 units.' },
    ]);
  });

  it('refuses what is not verified, disputed, only knowledge, stale or empty, each with its own reason', () => {
    expect(
      memoryEligibility(finding({ evidence: [web('https://a.test', { verified: false })] }), 2026),
    ).toEqual({
      ok: false,
      reason: 'not_verified',
    });
    expect(memoryEligibility(finding({ evidence: [] }), 2026)).toMatchObject({
      reason: 'not_verified',
    });
    expect(memoryEligibility(finding({ level: 'disputed' }), 2026)).toEqual({
      ok: false,
      reason: 'disputed',
    });
    expect(
      memoryEligibility(
        finding({ evidence: [{ ref: 'K1', knowledgeId: 'k-1', verified: true, quote: 'q' }] }),
        2026,
      ),
    ).toEqual({ ok: false, reason: 'knowledge_only' });
    expect(memoryEligibility(finding({ asOf: '2015' }), 2026)).toEqual({
      ok: false,
      reason: 'stale',
    });
    expect(memoryEligibility(finding({ claim: '  ' }), 2026)).toEqual({
      ok: false,
      reason: 'no_claim',
    });
  });

  it('collects the approved knowledge a finding also cites, once each, for the confidentiality floor', () => {
    const result = memoryEligibility(
      finding({
        evidence: [
          web('https://a.test/x'),
          { ref: 'K1', knowledgeId: 'k-1', verified: true, quote: 'q' },
          { ref: 'K1', knowledgeId: 'k-1', verified: true, quote: 'q2' },
          { ref: 'K2', knowledgeId: 'k-2', verified: false, quote: 'q' },
        ],
      }),
      2026,
    );
    expect(result.ok && result.knowledgeIds).toEqual(['k-1']);
  });

  it('lists a page once even if cited twice, and ignores a page with no address', () => {
    const result = memoryEligibility(
      finding({ evidence: [web('https://a.test/x'), web('https://a.test/x'), web('')] }),
      2026,
    );
    expect(result.ok && result.pages).toHaveLength(1);
  });

  it('gives a kept finding an expiry from its own age: current until its limit, ageing until year end', () => {
    const current = memoryEligibility(finding({ asOf: '2025', agesFast: false }), 2026);
    expect(current.ok && current.validUntil).toBe('2028-12-31T23:59:59.000Z');
    const fast = memoryEligibility(finding({ asOf: '2026', agesFast: true }), 2026);
    expect(fast.ok && fast.validUntil).toBe('2027-12-31T23:59:59.000Z');
    const ageing = memoryEligibility(finding({ asOf: '2024', agesFast: true }), 2026);
    expect(ageing.ok && ageing.validUntil).toBe('2026-12-31T23:59:59.000Z');
    const jalali = memoryEligibility(finding({ asOf: '۱۴۰۲', agesFast: false }), 2026);
    expect(jalali.ok && jalali.validUntil).toBe('2026-12-31T23:59:59.000Z');
  });
});

describe('maxConfidentiality and the fingerprint', () => {
  it('never lowers confidentiality', () => {
    expect(maxConfidentiality('internal', 'confidential')).toBe('confidential');
    expect(maxConfidentiality('restricted', 'internal')).toBe('restricted');
    expect(maxConfidentiality('internal', 'internal')).toBe('internal');
  });

  it('is the same for the same claim and pages in any order, and differs when either differs', () => {
    const one = memoryFingerprintText(
      finding({
        claim: ' The  Market reached 12,500 units ',
        evidence: [web('https://a.test'), web('https://b.test')],
      }),
    );
    const two = memoryFingerprintText(
      finding({
        claim: 'the market reached 12,500 units',
        evidence: [web('https://b.test'), web('https://a.test')],
      }),
    );
    expect(one).toBe(two);
    expect(memoryFingerprintText(finding({ claim: 'another claim' }))).not.toBe(one);
    expect(memoryFingerprintText(finding({ evidence: [web('https://c.test')] }))).not.toBe(one);
    // A page that did not verify does not make a different finding.
    expect(
      memoryFingerprintText(
        finding({ evidence: [web('https://a.test'), web('https://z.test', { verified: false })] }),
      ),
    ).toBe(memoryFingerprintText(finding({ evidence: [web('https://a.test')] })));
  });
});

const ACCESSED = '2026-11-02T10:00:00.000Z';

describe('composeMemory', () => {
  const pages = [
    { url: 'https://a.test/x', title: 'A page', quote: 'The market reached 12500 units.' },
  ];

  it('writes the claim, the date, only the supported figures and the sources with their quotes', () => {
    const draft = composeMemory(
      finding({
        asOf: '2024',
        figures: [
          { label: 'Units', value: '12,500', unit: 'units', period: '2024', supported: true },
          { label: 'Invented', value: '87', unit: '%', period: '', supported: false },
        ],
      }),
      pages,
      'en',
      { accessedAt: ACCESSED },
    );
    expect(draft.content).toContain('The market reached 12,500 units');
    expect(draft.content).toContain('About: 2024');
    expect(draft.content).toContain('- Units: 12,500 units (Period: 2024)');
    expect(draft.content).not.toContain('Invented');
    expect(draft.content).toContain('- A page — https://a.test/x');
    expect(draft.content).toContain('«The market reached 12500 units.»');
    expect(draft.claim).toMatchObject({ kind: 'numeric' });
    expect(draft.claim.citations).toEqual([
      {
        sourceRef: 'https://a.test/x',
        title: 'A page',
        publisher: 'a.test',
        publishedAt: '2024-01-01T00:00:00.000Z',
        accessedAt: ACCESSED,
        quote: 'The market reached 12500 units.',
      },
    ]);
    expect(draft.publishedAtIsAsOfYear).toBe(true);
  });

  it('writes in Persian when asked, treats a finding without a supported figure as a statement and bounds the title', () => {
    const draft = composeMemory(finding({ claim: 'x'.repeat(500) }), pages, 'fa', {
      accessedAt: ACCESSED,
    });
    expect(draft.content).toContain('منبع‌ها:');
    expect(draft.claim.kind).toBe('statement');
    expect(draft.title).toHaveLength(300);
    expect(
      composeMemory(finding(), pages, 'en', { title: ' My title ', accessedAt: ACCESSED }).title,
    ).toBe('My title');
  });

  it('leaves the date out when the year is unknown, and falls back to the host for a missing title', () => {
    const draft = composeMemory(
      finding(),
      [{ url: 'https://www.news.example.org/a?b=1', title: '', quote: '' }],
      'en',
      { accessedAt: ACCESSED },
    );
    expect(draft.claim.citations[0]).toEqual({
      sourceRef: 'https://www.news.example.org/a?b=1',
      title: 'news.example.org',
      publisher: 'news.example.org',
      accessedAt: ACCESSED,
      quote: '',
    });
    expect(draft.publishedAtIsAsOfYear).toBe(false);
  });

  it('reads the host of a web address only', () => {
    expect(pageHost('https://www.A.test/x')).toBe('a.test');
    expect(pageHost('ftp://a.test')).toBe('');
    expect(pageHost('nonsense')).toBe('');
  });
});

describe('memoryProvenance', () => {
  const base = {
    claim: 'The market reached 12,500 units',
    accessedAt: ACCESSED,
    projectId: 'p',
    stageRunId: 's',
    outputId: 'o',
    fingerprint: 'f'.repeat(64),
    publishedAtIsAsOfYear: true,
  };

  it('carries the query and the access time the auditor requires', () => {
    const provenance = memoryProvenance({ ...base, queries: [' market size ', '', 'units sold'] });
    expect(provenance['query']).toBe('market size; units sold');
    expect(provenance['accessedAt']).toBe(ACCESSED);
    expect(provenance).toMatchObject({ origin: 'research_memory', publishedAtIsAsOfYear: true });
  });

  it('falls back to the finding when the output kept no queries, and bounds a long list', () => {
    expect(memoryProvenance({ ...base, queries: [] })['query']).toBe(base.claim);
    expect(
      (memoryProvenance({ ...base, queries: ['q'.repeat(5000)] })['query'] as string).length,
    ).toBe(1900);
  });
});
