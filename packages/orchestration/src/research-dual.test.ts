import { ProviderError, strictSchemaProblems } from '@docoo/providers';
import { describe, expect, it } from 'vitest';

import {
  JUDGE_SCHEMA,
  judgeCanCompare,
  mergeConflicts,
  mergeModelRuns,
  normalizePageUrl,
  parseJudge,
  resolveDualPlan,
  type DualSettings,
  type SideRun,
} from './research-dual.js';
import { judgeDualResearch } from './research-dual-judge.js';
import type { WebPassage, WebRun } from './research.js';
import { webRunFrom } from './web-research.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const primary = { connectionId: A, model: 'gpt-main' };
const settings = (over: Partial<DualSettings> = {}): DualSettings => ({
  enabled: true,
  connectionId: B,
  model: 'claude-x',
  judgeConnectionId: '',
  judgeModel: '',
  ...over,
});

describe('resolveDualPlan', () => {
  it('stays off, silently, when the setting is off', () => {
    expect(resolveDualPlan(primary, settings({ enabled: false }))).toEqual({
      mode: 'off',
      code: null,
    });
  });

  it('says why it stays off when nothing is chosen or the same model would run twice', () => {
    expect(resolveDualPlan(primary, settings({ model: '' }))).toEqual({
      mode: 'off',
      code: 'dual_not_configured',
    });
    expect(resolveDualPlan(primary, settings({ connectionId: '' }))).toMatchObject({
      code: 'dual_not_configured',
    });
    expect(
      resolveDualPlan(primary, settings({ connectionId: A.toUpperCase(), model: ' GPT-main ' })),
    ).toEqual({ mode: 'off', code: 'dual_same_model' });
  });

  it('allows two models of one provider', () => {
    expect(
      resolveDualPlan(primary, settings({ connectionId: A, model: 'gpt-other' })),
    ).toMatchObject({
      mode: 'dual',
      second: { connectionId: A, model: 'gpt-other' },
    });
  });

  it('judges with the researcher’s own model unless a judge is set (both parts)', () => {
    expect(resolveDualPlan(primary, settings())).toMatchObject({ judge: primary });
    expect(resolveDualPlan(primary, settings({ judgeConnectionId: B }))).toMatchObject({
      judge: primary,
    });
    expect(
      resolveDualPlan(primary, settings({ judgeConnectionId: B, judgeModel: 'judge-1' })),
    ).toMatchObject({ judge: { connectionId: B, model: 'judge-1' } });
  });
});

describe('normalizePageUrl', () => {
  it('gives one key to the spellings of one page', () => {
    const key = normalizePageUrl('https://example.test/a/b');
    for (const same of [
      'http://www.Example.test/a/b/',
      'https://example.test/a/b#section',
      'https://example.test:443/a/b?utm_source=x&fbclid=y',
    ]) {
      expect(normalizePageUrl(same)).toBe(key);
    }
    expect(normalizePageUrl('https://example.test/a/b?id=2')).not.toBe(key);
    expect(normalizePageUrl('https://other.test/a/b')).not.toBe(key);
  });

  it('survives an address that is not a URL', () => {
    expect(normalizePageUrl(' Not A Url ')).toBe('not a url');
  });
});

const pages = (urls: string[], text = 'notes') =>
  webRunFrom(
    { queries: ['q'], sources: urls.map((url) => ({ url, title: url, text })) },
    0,
    [],
    100,
  );
const sides = (a: WebRun, b: WebRun): SideRun[] => [
  { side: 'primary', model: 'm1', run: a },
  { side: 'second', model: 'm2', run: b },
];

describe('mergeModelRuns', () => {
  it('lists a page both found once, with both texts, foundBy both and a quote from either verifying', () => {
    const merged = mergeModelRuns(
      sides(
        pages(['https://x.test/p?utm_source=a'], 'first model notes'),
        pages(['http://www.x.test/p/'], 'second model notes'),
      ),
      10,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ ref: 'W1', foundBy: ['primary', 'second'] });
    expect(merged[0]!.text).toContain('first model notes');
    expect(merged[0]!.text).toContain('second model notes');
  });

  it('numbers from the offset, and keeps the pages both found first when it must cut', () => {
    const merged = mergeModelRuns(
      sides(
        pages(['https://a.test/1', 'https://a.test/2', 'https://shared.test/']),
        pages(['https://b.test/1', 'https://shared.test']),
      ),
      3,
      4,
    );
    expect(merged.map((page) => page.ref)).toEqual(['W5', 'W6', 'W7']);
    expect(merged[0]!.url).toBe('https://shared.test/');
    expect(merged[0]!.foundBy).toEqual(['primary', 'second']);
    // The rest alternate, so the second model is not crowded out.
    expect(merged.map((page) => page.foundBy?.join())).toEqual([
      'primary,second',
      'primary',
      'second',
    ]);
  });

  it('works when one model found nothing, and caps the joined text', () => {
    const only = mergeModelRuns(sides(pages([]), pages(['https://b.test/'])), 5);
    expect(only).toHaveLength(1);
    expect(only[0]!.foundBy).toEqual(['second']);
    const long = mergeModelRuns(
      sides(
        pages(['https://c.test/'], 'x'.repeat(6000)),
        pages(['https://c.test/'], 'y'.repeat(6000)),
      ),
      5,
    );
    expect(long[0]!.text.length).toBeLessThanOrEqual(8000);
  });
});

const found = (...entries: [string, ('primary' | 'second')[]][]): WebPassage[] =>
  entries.map(([ref, foundBy]) => ({
    ref,
    url: `https://x.test/${ref}`,
    title: ref,
    text: 't',
    foundBy,
  }));

describe('judgeCanCompare', () => {
  it('needs pages from both models', () => {
    expect(judgeCanCompare(found(['W1', ['primary']], ['W2', ['second']]))).toBe(true);
    expect(judgeCanCompare(found(['W1', ['primary']], ['W2', ['primary']]))).toBe(false);
    expect(judgeCanCompare(found(['W1', ['primary', 'second']]))).toBe(false);
    expect(judgeCanCompare([])).toBe(false);
  });
});

describe('parseJudge', () => {
  const list = found(
    ['W1', ['primary']],
    ['W2', ['second']],
    ['W3', ['primary']],
    ['W4', ['primary', 'second']],
  );

  it('keeps a conflict that names pages of both models and drops what does not hold up', () => {
    const result = parseJudge(
      {
        conflicts: [
          { description: 'real', refs: ['w1', 'W2'] },
          { description: 'same pages again', refs: ['W2', 'W1'] },
          { description: 'one model only', refs: ['W1', 'W3'] },
          { description: 'one page', refs: ['W1'] },
          { description: 'invented ref', refs: ['W1', 'W99'] },
          { description: '   ', refs: ['W1', 'W2'] },
          { description: 'a page both found against one model', refs: ['W4', 'W3'] },
        ],
      },
      list,
    );
    expect(result).toEqual([
      { description: 'real', refs: ['W1', 'W2'] },
      { description: 'a page both found against one model', refs: ['W4', 'W3'] },
    ]);
  });

  it('survives a malformed answer', () => {
    for (const bad of [
      null,
      'x',
      {},
      { conflicts: 'no' },
      { conflicts: [null, 3, { refs: 'W1' }] },
    ]) {
      expect(parseJudge(bad, list)).toEqual([]);
    }
  });

  it('caps the number of conflicts', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      description: `c${i}`,
      refs: i % 2 ? ['W1', 'W2'] : ['W3', 'W2'],
    }));
    expect(parseJudge({ conflicts: many }, list).length).toBeLessThanOrEqual(2);
  });
});

describe('mergeConflicts', () => {
  const own = Array.from({ length: 25 }, (_, i) => ({
    description: `own${i}`,
    refs: [`W${i + 10}`],
  }));

  it('keeps the judge’s conflicts when the researcher’s list is already long', () => {
    const merged = mergeConflicts(own, [{ description: 'judged', refs: ['W1', 'W2'] }], 20);
    expect(merged).toHaveLength(20);
    expect(merged.at(-1)).toEqual({ description: 'judged', refs: ['W1', 'W2'] });
  });

  it('does not repeat a conflict the researcher already reported on the same pages', () => {
    const merged = mergeConflicts(
      [{ description: 'mine', refs: ['W2', 'w1'] }],
      [{ description: 'judged', refs: ['W1', 'W2'] }],
      20,
    );
    expect(merged).toEqual([{ description: 'mine', refs: ['W2', 'w1'] }]);
  });
});

describe('judgeDualResearch', () => {
  const dualWeb = (sources: WebPassage[]): WebRun => ({
    status: 'used',
    code: null,
    queries: ['q'],
    sources,
    dual: {
      primary: { model: 'm1', status: 'used', code: null, pages: 1 },
      second: { model: 'm2', status: 'used', code: null, pages: 1 },
      judge: { model: 'j', status: 'skipped', code: null, conflicts: 0 },
    },
  });
  const both = found(['W1', ['primary']], ['W2', ['second']]);
  const answer = {
    findings: [{ claim: 'c', evidence: [{ ref: 'W1', quote: 'q' }] }],
    gaps: [],
    conflicts: [],
  };
  const base = {
    judge: { connectionId: A, model: 'j' },
    answer,
    language: 'en' as const,
    problem: 'p',
    affordable: () => Promise.resolve(true),
  };

  it('is a no-op for a single-model run', async () => {
    const web: WebRun = { status: 'used', code: null, queries: [], sources: both };
    const result = await judgeDualResearch({
      ...base,
      web,
      invoke: () => Promise.reject(new Error('must not be called')),
    });
    expect(result.web).toBe(web);
    expect(result.answer).toBe(answer);
  });

  it('adds the judge’s conflicts to the answer and records how many', async () => {
    let calls = 0;
    const result = await judgeDualResearch({
      ...base,
      web: dualWeb(both),
      invoke: (_target, request) => {
        calls += 1;
        expect(request.responseSchema.name).toBe('research_judge');
        return Promise.resolve({
          response: {
            finishReason: 'stop',
            json: { conflicts: [{ description: 'differ', refs: ['W1', 'W2'] }] },
          },
        });
      },
    });
    expect(calls).toBe(1);
    expect(result.web.dual?.judge).toMatchObject({ status: 'used', conflicts: 1, model: 'j' });
    expect((result.answer as { conflicts: unknown[] }).conflicts).toEqual([
      { description: 'differ', refs: ['W1', 'W2'] },
    ]);
  });

  it('does not call the judge when one model found nothing, or the budget is spent', async () => {
    const invoke = () => Promise.reject(new Error('must not be called'));
    const one = await judgeDualResearch({
      ...base,
      web: dualWeb(found(['W1', ['primary']], ['W2', ['primary']])),
      invoke,
    });
    expect(one.web.dual?.judge).toMatchObject({ status: 'skipped', code: 'nothing_to_compare' });
    const poor = await judgeDualResearch({
      ...base,
      web: dualWeb(both),
      affordable: () => Promise.resolve(false),
      invoke,
    });
    expect(poor.web.dual?.judge).toMatchObject({ status: 'skipped', code: 'cost_limit_exceeded' });
    expect(poor.answer).toBe(answer);
  });

  it('keeps the researcher’s answer when the judge fails, answers badly or is cut off', async () => {
    const failing = await judgeDualResearch({
      ...base,
      web: dualWeb(both),
      invoke: () => Promise.reject(new ProviderError('transient', 'rate_limited')),
    });
    expect(failing.web.dual?.judge).toMatchObject({ status: 'failed', code: 'rate_limited' });
    expect(failing.answer).toBe(answer);
    const cut = await judgeDualResearch({
      ...base,
      web: dualWeb(both),
      invoke: () => Promise.resolve({ response: { finishReason: 'length', json: null } }),
    });
    expect(cut.web.dual?.judge).toMatchObject({ status: 'failed', code: 'judge_length' });
    const junk = await judgeDualResearch({
      ...base,
      web: dualWeb(both),
      invoke: () =>
        Promise.resolve({ response: { finishReason: 'stop', json: { conflicts: 'x' } } }),
    });
    expect(junk.web.dual?.judge).toMatchObject({ status: 'used', conflicts: 0 });
  });
});

describe('the judge schema', () => {
  it('is accepted by strict structured outputs', () => {
    expect(strictSchemaProblems(JUDGE_SCHEMA as never)).toEqual([]);
  });
});
