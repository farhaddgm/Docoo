import { describe, expect, it } from 'vitest';

import {
  adviseConflict,
  classifyWebSource,
  isLearnedSource,
  LEARNED_TRUST_MIN,
  learnedDomains,
  sourceHost,
  conflictFingerprint,
  MAX_OFFICIAL_DOMAINS,
  normalizeOfficialDomains,
} from './research-sources.js';

describe('classifying a web source', () => {
  it('marks institutions official by the end of the address', () => {
    for (const url of [
      'https://www.cbi.gov.ir/report',
      'https://data.census.gov/table',
      'https://www.ox.ac.uk/research',
      'https://www.mit.edu/x',
      'https://www.unsw.edu.au/x',
      'https://www.nato.int/cps',
      'https://www.army.mil/news',
      'https://sharif.ac.ir/a',
    ]) {
      expect(classifyWebSource(url), url).toBe('official');
    }
  });

  it('marks international and standards bodies official, including their subdomains', () => {
    for (const url of [
      'https://data.worldbank.org/x',
      'https://ec.europa.eu/eurostat',
      'https://www.iso.org/standard',
      'https://www.w3.org/TR',
    ]) {
      expect(classifyWebSource(url), url).toBe('official');
    }
  });

  it('leaves every other page public, and does not be fooled by a look-alike address', () => {
    for (const url of [
      'https://example.com/post',
      'https://gov.example.com/post',
      'https://notworldbank.org/x',
      'https://worldbank.org.evil.test/x',
      'https://edu-deals.com',
      'ftp://files.gov/x',
      'not a url',
    ]) {
      expect(classifyWebSource(url), url).toBe('public');
    }
  });

  it('adds the domains the administrator listed, with their subdomains', () => {
    expect(classifyWebSource('https://blog.acme.test/a', ['acme.test'])).toBe('official');
    expect(classifyWebSource('https://acme.test.evil.com/a', ['acme.test'])).toBe('public');
    expect(classifyWebSource('https://blog.acme.test/a')).toBe('public');
  });

  it('cleans the listed domains', () => {
    expect(
      normalizeOfficialDomains([
        ' https://www.Regulator.example/path?x=1 ',
        '*.agency.test',
        'agency.test',
        'localhost',
        'not a host',
        42,
        '',
      ]),
    ).toEqual(['regulator.example', 'agency.test']);
    expect(normalizeOfficialDomains('x')).toEqual([]);
    const many = Array.from({ length: 80 }, (_, index) => `site${index}.example`);
    expect(normalizeOfficialDomains(many)).toHaveLength(MAX_OFFICIAL_DOMAINS);
  });
});

describe('conflict fingerprint', () => {
  it('is stable for the same conflict however it is spaced, cased or ordered', () => {
    const a = conflictFingerprint('Churn  is rising', ['K2', 'k1']);
    expect(a).toMatch(/^[0-9a-f]{16}$/u);
    expect(conflictFingerprint('churn is rising ', ['K1', 'K2'])).toBe(a);
  });

  it('differs when the description or the sources differ', () => {
    const a = conflictFingerprint('Churn is rising', ['K1', 'K2']);
    expect(conflictFingerprint('Churn is falling', ['K1', 'K2'])).not.toBe(a);
    expect(conflictFingerprint('Churn is rising', ['K1', 'W1'])).not.toBe(a);
  });
});

describe('cleaning the listed domains stays linear', () => {
  it('handles hostile input quickly and still refuses what is not a host', () => {
    const started = Date.now();
    const hostile = [
      '#'.repeat(50_000),
      `a${'.a'.repeat(5_000)}`,
      `${'-'.repeat(50_000)}.test`,
      'x://'.repeat(10_000),
    ];
    expect(normalizeOfficialDomains(hostile)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(500);
    expect(
      normalizeOfficialDomains([
        'https://Sub.Agency.test:8443/path#frag',
        'bad-.test',
        '-bad.test',
      ]),
    ).toEqual(['sub.agency.test']);
  });
});

describe('adviseConflict (ADR-0049)', () => {
  const src = (
    ref: string,
    kind: 'knowledge' | 'official' | 'public',
    foundBy?: string[],
  ): { ref: string; kind: 'knowledge' | 'official' | 'public'; foundBy?: string[] } => ({
    ref,
    kind,
    ...(foundBy ? { foundBy } : {}),
  });

  it('prefers approved knowledge over an official page, and an official page over a public one', () => {
    expect(adviseConflict([src('W1', 'official'), src('K1', 'knowledge')])).toEqual({
      trustedRef: 'K1',
      reason: 'knowledge',
    });
    expect(adviseConflict([src('W1', 'public'), src('W2', 'official')])).toEqual({
      trustedRef: 'W2',
      reason: 'official',
    });
  });

  it('between equals, prefers the page both models found, and only when exactly one was', () => {
    expect(
      adviseConflict([
        src('W1', 'public', ['primary']),
        src('W2', 'public', ['primary', 'second']),
      ]),
    ).toEqual({ trustedRef: 'W2', reason: 'both_models' });
    expect(
      adviseConflict([
        src('W1', 'public', ['primary', 'second']),
        src('W2', 'public', ['primary', 'second']),
      ]),
    ).toBeNull();
  });

  it('gives no advice for a tie, a single source, or a both-models page that is not on the top level', () => {
    expect(adviseConflict([src('W1', 'public'), src('W2', 'public')])).toBeNull();
    expect(adviseConflict([src('W1', 'official')])).toBeNull();
    expect(adviseConflict([])).toBeNull();
    // The lower class cannot win on "both models found it": the official page still leads.
    expect(
      adviseConflict([
        src('W1', 'official', ['primary']),
        src('W2', 'public', ['primary', 'second']),
      ]),
    ).toEqual({ trustedRef: 'W1', reason: 'official' });
  });
});

describe('learned domains (ADR-0050)', () => {
  it('reads the host of a page without www, and nothing from a non-web address', () => {
    expect(sourceHost('https://www.Example.com/a/b?x=1')).toBe('example.com');
    expect(sourceHost('http://news.example.com./x')).toBe('news.example.com');
    expect(sourceHost('ftp://example.com')).toBeNull();
    expect(sourceHost('not a url')).toBeNull();
  });

  it('suggests a host trusted at least twice, as that exact host, most trusted first', () => {
    const result = learnedDomains([
      'https://www.alpha.com/1',
      'https://alpha.com/2',
      'https://beta.org/1',
      'https://gamma.net/1',
      'https://gamma.net/2',
      'https://gamma.net/3',
    ]);
    expect(LEARNED_TRUST_MIN).toBe(2);
    expect(result).toEqual([
      { domain: 'gamma.net', trusted: 3 },
      { domain: 'alpha.com', trusted: 2 },
    ]);
  });

  it('never suggests an official domain, a built-in one or one already on the list, and never widens a host', () => {
    const result = learnedDomains(
      [
        'https://stats.gov.ir/a',
        'https://stats.gov.ir/b',
        'https://regulator.test/a',
        'https://regulator.test/b',
        'https://news.example.com/a',
        'https://news.example.com/b',
      ],
      ['regulator.test'],
    );
    expect(result).toEqual([{ domain: 'news.example.com', trusted: 2 }]);
  });

  it('matches a page under a learned domain, including its subdomains, and only that', () => {
    const learned = new Set(['example.com']);
    expect(isLearnedSource('https://example.com/a', learned)).toBe(true);
    expect(isLearnedSource('https://www.example.com/a', learned)).toBe(true);
    expect(isLearnedSource('https://blog.example.com/a', learned)).toBe(true);
    expect(isLearnedSource('https://notexample.com/a', learned)).toBe(false);
    expect(isLearnedSource('nonsense', learned)).toBe(false);
  });

  it('ranks a learned public page above a plain public one, below an official one', () => {
    const src = (ref: string, kind: 'knowledge' | 'official' | 'public', learned = false) => ({
      ref,
      kind,
      learned,
    });
    expect(adviseConflict([src('W1', 'public'), src('W2', 'public', true)])).toEqual({
      trustedRef: 'W2',
      reason: 'learned',
    });
    expect(adviseConflict([src('W1', 'official'), src('W2', 'public', true)])).toEqual({
      trustedRef: 'W1',
      reason: 'official',
    });
    expect(adviseConflict([src('W1', 'public', true), src('W2', 'public', true)])).toBeNull();
  });
});
