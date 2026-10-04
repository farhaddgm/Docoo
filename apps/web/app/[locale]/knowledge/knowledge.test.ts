import { describe, expect, it } from 'vitest';

import { isoToLocal, joinList, localToIso, safeHref, scopesPayload } from './knowledge-common';
import { knowledgeMessages } from './knowledge-messages';
import { claimReasonKey, parseConflictAnalysis, parseReason } from './reasons';

/** Every dotted key path of a message table, so two languages can be compared. */
function paths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('knowledge messages', () => {
  it('has the same keys in Persian and English', () => {
    expect(paths(knowledgeMessages('en')).sort()).toEqual(paths(knowledgeMessages('fa')).sort());
  });

  it('words every error code the knowledge and source API can answer with', () => {
    const codes = [
      'KNOWLEDGE_INVALID_REQUEST',
      'KNOWLEDGE_NOT_FOUND',
      'KNOWLEDGE_VERSION_CONFLICT',
      'KNOWLEDGE_STALE',
      'KNOWLEDGE_ALREADY_REVIEWED',
      'KNOWLEDGE_NO_VERSION',
      'KNOWLEDGE_REVIEW_STALE',
      'KNOWLEDGE_OVERRIDE_REASON_REQUIRED',
      'KNOWLEDGE_CONFLICT_RESOLVED',
      'KNOWLEDGE_SOURCE_NOT_READY',
      'KNOWLEDGE_NO_SOURCE',
      'SOURCE_TOO_LARGE',
      'SOURCE_UNSUPPORTED_TYPE',
      'SOURCE_INGESTION_UNAVAILABLE',
      'SOURCE_VERSION_CONFLICT',
    ];
    for (const locale of ['fa', 'en'] as const) {
      for (const code of codes) expect(knowledgeMessages(locale).errors[code], code).toBeTruthy();
    }
  });
});

describe('Brain reasons (the auditor writes English lines)', () => {
  it('reads each line the rule-based auditor writes back into its parts', () => {
    expect(parseReason('credibility: admin_provided source, provenance complete')).toEqual({
      kind: 'credibility',
      sourceType: 'admin_provided',
      complete: true,
      partial: false,
    });
    expect(
      parseReason(
        'credibility: autonomous_research source, provenance incomplete, partial extraction',
      ),
    ).toEqual({
      kind: 'credibility',
      sourceType: 'autonomous_research',
      complete: false,
      partial: true,
    });
    expect(parseReason('relevance: 3/5 scope terms found')).toEqual({
      kind: 'relevance',
      matched: 3,
      terms: 5,
    });
    expect(parseReason('evidence: 2/4 claims supported')).toEqual({
      kind: 'evidence',
      supported: 2,
      total: 4,
    });
    expect(parseReason('recency: validity has ended')).toEqual({ kind: 'recency_ended' });
    expect(parseReason('recency: newest cited source 2.7 years old')).toEqual({
      kind: 'recency_age',
      years: 2.7,
    });
    expect(parseReason('recency: newest cited source 0.0 years old')).toEqual({
      kind: 'recency_age',
      years: 0,
    });
    expect(parseReason('recency: no dated sources')).toEqual({ kind: 'recency_undated' });
    expect(parseReason('bias: 3 absolute or promotional expressions')).toEqual({
      kind: 'bias',
      count: 3,
    });
    expect(parseReason('conflict: 2 open conflicts')).toEqual({ kind: 'conflict', count: 2 });
    expect(parseReason('critical: prompt_injection')).toEqual({
      kind: 'critical',
      flag: 'prompt_injection',
    });
  });

  it('keeps a line it does not know as it was written', () => {
    expect(parseReason('The model found the tone promotional.')).toEqual({
      kind: 'unknown',
      raw: 'The model found the tone promotional.',
    });
    // A near miss must not be mistaken for a known line.
    expect(parseReason('evidence: many claims supported').kind).toBe('unknown');
    expect(parseReason('credibility: x source, provenance complete\nextra').kind).toBe('unknown');
  });

  it('maps the verdict on a claim to a message key', () => {
    expect(claimReasonKey('complete citation')).toBe('complete_citation');
    expect(claimReasonKey('direct administrator provenance')).toBe('admin_provenance');
    expect(claimReasonKey('citation incomplete')).toBe('citation_incomplete');
    expect(claimReasonKey('no citation')).toBe('no_citation');
    expect(claimReasonKey('something else')).toBeNull();
  });

  it('reads the conflict detector analysis', () => {
    expect(
      parseConflictAnalysis('Same subject (similarity 0.82) with different figures: 12 vs 18.'),
    ).toEqual({ kind: 'numeric', similarity: 0.82, first: '12', second: '18' });
    expect(
      parseConflictAnalysis('Same subject (similarity 0.91) where only one claim is negated.'),
    ).toEqual({ kind: 'negation', similarity: 0.91 });
    expect(parseConflictAnalysis('Custom analysis')).toEqual({
      kind: 'unknown',
      raw: 'Custom analysis',
    });
  });
});

describe('knowledge form helpers', () => {
  it('sends each scope once, with a role only where one was chosen', () => {
    expect(
      scopesPayload([
        { type: 'workspace', id: 'w', role: '' },
        { type: 'workspace', id: 'w', role: '' },
        { type: 'project', id: 'p', role: 'researcher' },
        { type: 'project', id: 'p', role: '' },
      ]),
    ).toEqual([
      { type: 'workspace', id: 'w' },
      { type: 'project', id: 'p', role: 'researcher' },
      { type: 'project', id: 'p' },
    ]);
  });

  it('converts between instants and datetime-local text', () => {
    expect(localToIso('')).toBeUndefined();
    expect(localToIso('not a date')).toBeUndefined();
    const iso = localToIso('2026-12-01T09:30');
    expect(iso).toBe(new Date('2026-12-01T09:30').toISOString());
    expect(isoToLocal(iso!)).toBe('2026-12-01T09:30');
    expect(isoToLocal(null)).toBe('');
  });

  it('only links http and https addresses', () => {
    expect(safeHref('https://stats.example.org/a?b=1')).toBe('https://stats.example.org/a?b=1');
    expect(safeHref('http://example.org')).toBe('http://example.org/');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<b>x</b>')).toBeNull();
    expect(safeHref('doi:10.5555/retail.2026')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });

  it('joins a list the way the language writes it', () => {
    expect(joinList('fa', ['الف', 'ب'])).toBe('الف، ب');
    expect(joinList('en', ['a', 'b'])).toBe('a, b');
  });
});
