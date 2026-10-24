import { describe, expect, it } from 'vitest';

import {
  classifyWebSource,
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
