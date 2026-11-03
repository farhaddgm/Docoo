import { describe, expect, it } from 'vitest';

import { clip, digestOutput, DIGEST_LIMIT, pickOutput } from './output-digest';

describe('digestOutput', () => {
  it('reads the problem definition: the statement, then the lists that matter', () => {
    const blocks = digestOutput('analysis', {
      problemStatement: '  فروش آنلاین کند شده است.  ',
      objectives: ['افزایش فروش', '', 'کاهش ریزش'],
      assumptions: ['بازار ثابت است'],
      unresolved: ['علت افت مشخص نیست'],
      openQuestions: ['سهم کانال‌ها؟'],
      constraints: ['not shown'],
    });
    expect(blocks).toEqual([
      { key: 'problemStatement', text: 'فروش آنلاین کند شده است.' },
      { key: 'objectives', items: ['افزایش فروش', 'کاهش ریزش'], total: 2 },
      { key: 'assumptions', items: ['بازار ثابت است'], total: 1 },
      { key: 'unresolved', items: ['علت افت مشخص نیست', 'سهم کانال‌ها؟'], total: 2 },
    ]);
  });

  it('lists the claims of the research findings and skips the ones with no claim', () => {
    const blocks = digestOutput('research', {
      findings: [{ claim: 'A' }, { claim: '  ' }, { source: 'x' }, { claim: 'B' }],
    });
    expect(blocks).toEqual([{ key: 'findings', items: ['A', 'B'], total: 2 }]);
  });

  it('shows the first entries and counts all of them', () => {
    const ideas = Array.from({ length: DIGEST_LIMIT + 3 }, (_, index) => ({
      title: `T${index}`,
      description: `D${index}`,
    }));
    const [block] = digestOutput('ideation', { ideas });
    expect(block?.items).toHaveLength(DIGEST_LIMIT);
    expect(block?.items?.[0]).toBe('T0 — D0');
    expect(block?.total).toBe(DIGEST_LIMIT + 3);
  });

  it('keeps an entry that has only a title or only a heading', () => {
    expect(digestOutput('ideation', { ideas: [{ title: 'Only' }] })[0]?.items).toEqual(['Only']);
    expect(digestOutput('documentation', { outline: [{ summary: 'Only' }] })[0]?.items).toEqual([
      'Only',
    ]);
  });

  it('writes the evaluation scores with the number format of the page', () => {
    const blocks = digestOutput(
      'evaluation',
      {
        summary: 'خوب',
        scores: [{ criterion: 'هزینه', score: 4 }, { criterion: 'ریسک' }, { score: 3 }],
      },
      (value) => `<${value}>`,
    );
    expect(blocks).toEqual([
      { key: 'summary', text: 'خوب' },
      { key: 'scores', items: ['هزینه: <4>', 'ریسک'], total: 2 },
    ]);
  });

  it('gives nothing for a content that is not what the stage writes', () => {
    expect(digestOutput('analysis', null)).toEqual([]);
    expect(digestOutput('analysis', 'text')).toEqual([]);
    expect(digestOutput('analysis', [])).toEqual([]);
    expect(digestOutput('research', { findings: 'nope' })).toEqual([]);
    expect(digestOutput('evaluation', {})).toEqual([]);
    expect(digestOutput('unknown-stage', { findings: [{ claim: 'A' }] })).toEqual([]);
  });
});

describe('clip', () => {
  it('flattens white space and leaves a short text alone', () => {
    expect(clip('a \n  b', 10)).toBe('a b');
  });

  it('cuts a long text by characters and marks the cut', () => {
    expect(clip('abcdefghij', 5)).toBe('abcd…');
  });

  it('never splits a character made of two code units', () => {
    expect(clip('😀😀😀😀', 3)).toBe('😀😀…');
  });
});

describe('pickOutput', () => {
  const output = (id: string, versionNo: number, current = false) => ({ id, versionNo, current });

  it('prefers the output the stage reports as its latest', () => {
    const outputs = [output('a', 1, true), output('b', 2)];
    expect(pickOutput(outputs, 'b')?.id).toBe('b');
  });

  it('falls back to the current output, then to the newest version', () => {
    expect(pickOutput([output('a', 1), output('b', 2, true)], null)?.id).toBe('b');
    expect(pickOutput([output('a', 1), output('c', 3), output('b', 2)], 'gone')?.id).toBe('c');
  });

  it('has nothing for a stage with no output', () => {
    expect(pickOutput([], 'a')).toBeNull();
  });
});
