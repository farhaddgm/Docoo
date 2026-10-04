import { describe, expect, it } from 'vitest';

import { settingsMessages } from './settings-messages';
import {
  boundsProblem,
  boundsToRows,
  parseControlText,
  rowsToBounds,
  sameValue,
  SETTING_GROUPS,
  sourceKind,
  toControlText,
  type ValueSchema,
} from './settings-model';

const integer: ValueSchema = { type: 'integer', minimum: 1, maximum: 10 };

describe('control text to setting value', () => {
  it('parses numbers within the range and says what is wrong otherwise', () => {
    expect(parseControlText(integer, ' 5 ')).toEqual({ ok: true, value: 5 });
    expect(parseControlText(integer, '')).toEqual({ ok: false, problem: { code: 'required' } });
    expect(parseControlText(integer, 'abc')).toEqual({
      ok: false,
      problem: { code: 'not_a_number' },
    });
    expect(parseControlText(integer, '2.5')).toEqual({ ok: false, problem: { code: 'not_whole' } });
    expect(parseControlText(integer, '0')).toEqual({
      ok: false,
      problem: { code: 'too_small', min: 1 },
    });
    expect(parseControlText(integer, '11')).toEqual({
      ok: false,
      problem: { code: 'too_large', max: 10 },
    });
    expect(parseControlText({ type: 'number', minimum: 0, maximum: 1 }, '0.7')).toEqual({
      ok: true,
      value: 0.7,
    });
  });

  it('parses booleans, enums, text and lists', () => {
    expect(parseControlText({ type: 'boolean' }, 'true')).toEqual({ ok: true, value: true });
    expect(parseControlText({ type: 'boolean' }, 'false')).toEqual({ ok: true, value: false });
    const enumSchema: ValueSchema = { type: 'string', enum: ['brief', 'standard'] };
    expect(parseControlText(enumSchema, 'brief')).toEqual({ ok: true, value: 'brief' });
    expect(parseControlText(enumSchema, 'huge')).toEqual({
      ok: false,
      problem: { code: 'not_allowed' },
    });
    expect(parseControlText({ type: 'string', maxLength: 3 }, 'abcd')).toEqual({
      ok: false,
      problem: { code: 'too_long', max: 3 },
    });
    const list: ValueSchema = {
      type: 'array',
      items: { type: 'string', pattern: '^[a-z.]+$' },
      maxItems: 2,
    };
    expect(parseControlText(list, 'a.com\n\n b.org ')).toEqual({
      ok: true,
      value: ['a.com', 'b.org'],
    });
    expect(parseControlText(list, '')).toEqual({ ok: true, value: [] });
    expect(parseControlText(list, 'a\nb\nc')).toEqual({
      ok: false,
      problem: { code: 'too_many', max: 2 },
    });
    expect(parseControlText(list, 'ok\nNOT OK')).toEqual({
      ok: false,
      problem: { code: 'item', line: 2 },
    });
  });

  it('shows a value back as the text a control starts with', () => {
    expect(toControlText(integer, 5)).toBe('5');
    expect(toControlText({ type: 'boolean' }, true)).toBe('true');
    expect(toControlText({ type: 'array', items: { type: 'string' } }, ['a', 'b'])).toBe('a\nb');
    expect(toControlText({ type: 'string' }, null)).toBe('');
  });

  it('compares values by content', () => {
    expect(sameValue([1, 2], [1, 2])).toBe(true);
    expect(sameValue(1, '1')).toBe(false);
  });
});

describe('level bounds editor rules', () => {
  const defaults = [1000, 3000, 5000, 7000, 9000, 11000, 13000, 17000, 22000, 28000];

  it('round-trips ten numbers through five rows', () => {
    const rows = boundsToRows(defaults)!;
    expect(rows).toHaveLength(5);
    expect(rows[1]).toEqual({ min: 5000, max: 7000 });
    expect(rowsToBounds(rows)).toEqual(defaults);
    expect(boundsToRows([1, 2, 3])).toBeNull();
    expect(boundsToRows('x')).toBeNull();
  });

  it('finds the first level that breaks a rule, like the server', () => {
    expect(boundsProblem(boundsToRows(defaults)!)).toBeNull();
    const rows = boundsToRows(defaults)!;
    expect(boundsProblem(rows.map((row, i) => (i === 1 ? { min: 7000, max: 7000 } : row)))).toEqual(
      {
        code: 'min_not_below_max',
        level: 2,
      },
    );
    expect(
      boundsProblem(rows.map((row, i) => (i === 2 ? { min: 6000, max: 11000 } : row))),
    ).toEqual({
      code: 'overlap',
      level: 3,
    });
    expect(
      boundsProblem(rows.map((row, i) => (i === 0 ? { min: Number.NaN, max: 3000 } : row))),
    ).toEqual({
      code: 'not_whole',
      level: 1,
    });
  });
});

describe('where a value comes from', () => {
  it('names the scope, and a value the wizard has not saved yet', () => {
    expect(sourceKind(undefined)).toBe('system');
    expect(sourceKind({ scope: 'system' })).toBe('system');
    expect(sourceKind({ scope: 'topic', scopeId: 't', sequence: 1 })).toBe('topic');
    expect(sourceKind({ scope: 'project', pending: true })).toBe('pending');
  });
});

describe('settings screens messages', () => {
  it('has the same groups, sources and problems in both languages', () => {
    const fa = settingsMessages('fa');
    const en = settingsMessages('en');
    for (const group of SETTING_GROUPS) {
      expect(fa.groups[group.id].title).not.toBe('');
      expect(en.groups[group.id].title).not.toBe('');
    }
    expect(Object.keys(fa.sources).sort()).toEqual(Object.keys(en.sources).sort());
    expect(Object.keys(fa.problems).sort()).toEqual(Object.keys(en.problems).sort());
    expect(Object.keys(fa.errors).sort()).toEqual(Object.keys(en.errors).sort());
  });
});
