import { describe, expect, it } from 'vitest';

import {
  changedSections,
  changesBody,
  draftOf,
  type Definition,
  type Draft,
} from './[locale]/agents/agent-types';
import { diffLines, diffText, hasChanges } from './[locale]/agents/diff';

const definition: Definition = {
  id: 'a',
  role: 'researcher',
  projectId: null,
  sequence: 1,
  principles: ['Cite the page.', 'Compare cases.'],
  duties: ['Build a plan.'],
  promptTemplate: 'List the findings.',
  tools: ['web_search', 'web_read'],
  modelPolicy: null,
  outputSchemaId: 'research-v1',
  changedSections: [],
  baseVersionId: null,
  reason: 'default',
  createdBy: null,
  createdAt: '2026-10-04T10:00:00.000000Z',
};

describe('line diff', () => {
  it('marks what a version removes and adds and keeps the rest', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
    expect(hasChanges(diffLines(['a'], ['a']))).toBe(false);
    expect(diffLines([], ['x'])).toEqual([{ kind: 'added', text: 'x' }]);
    expect(diffLines(['x'], [])).toEqual([{ kind: 'removed', text: 'x' }]);
    expect(diffLines([], [])).toEqual([]);
  });

  it('treats a moved rule as one removal and one addition', () => {
    const lines = diffLines(['a', 'b', 'c'], ['b', 'c', 'a']);
    expect(lines.filter((line) => line.kind === 'removed')).toEqual([
      { kind: 'removed', text: 'a' },
    ]);
    expect(lines.filter((line) => line.kind === 'added')).toEqual([{ kind: 'added', text: 'a' }]);
  });

  it('diffs a block of text line by line', () => {
    expect(diffText('one\ntwo', 'one\ntwo\nthree')).toEqual([
      { kind: 'same', text: 'one' },
      { kind: 'same', text: 'two' },
      { kind: 'added', text: 'three' },
    ]);
  });
});

describe('what the draft changes', () => {
  const base = draftOf(definition);

  it('copies the definition so editing the draft never touches the version', () => {
    const draft = draftOf(definition);
    draft.principles.push('New');
    expect(definition.principles).toHaveLength(2);
  });

  it('names only the sections that differ and ignores surrounding blanks and tool order', () => {
    expect(changedSections(base, base)).toEqual([]);
    const padded: Draft = {
      ...base,
      principles: base.principles.map((item) => ` ${item} `),
      promptTemplate: `\n${base.promptTemplate}\n`,
      tools: [...base.tools].reverse(),
    };
    expect(changedSections(base, padded)).toEqual([]);
    expect(changedSections(base, { ...base, duties: [...base.duties, 'More.'] })).toEqual([
      'duties',
    ]);
    expect(
      changedSections(base, { ...base, modelPolicy: { connectionId: 'c', model: 'm' } }),
    ).toEqual(['model']);
  });

  it('sends only the changed sections, trimmed, so principles and duties stay independent', () => {
    expect(changesBody(base, base)).toEqual({});
    expect(
      changesBody(base, { ...base, duties: ['  Build a better plan. '], tools: ['web_search'] }),
    ).toEqual({ duties: ['Build a better plan.'], tools: ['web_search'] });
    expect(changesBody({ ...base, modelPolicy: { connectionId: 'c', model: 'm' } }, base)).toEqual({
      modelPolicy: null,
    });
  });
});
